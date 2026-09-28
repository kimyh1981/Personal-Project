/*
 * 내 맞춤 추천: 고정한 내 조건(자산·상환 능력·나이)으로 서울 단지를 5개 순위 기준 + 추가 조합으로 나눈다.
 * 순수 계산만 둔다. 시장 데이터는 data/market-seoul.json(매주 갱신), 개인 조건은 이 기기에만 저장한다.
 *
 *  1순위  자기자금 + 대출(월 상환 기본 한도 이내, 최대 한도까지 허용) · 바로 입주 · 60세에 노후 준비
 *  2순위  자기자금 + 대출 + 추가 자금(월 상환 기본 한도의 150% 이내) · 입주 늦어도 됨 · 노후 + 알파
 *  3순위  대출 없이 · 바로 입주 · 60세 이후 소득이 있을 때 노후 가능
 *  4순위  대출 없이 · 바로 입주 · 집만으로 노후 가능
 *  5순위  대출 + 추가 자금(월 상환 고소득 한도 이내) · 1~4순위보다 훨씬 큰 미래가치
 *  추가 A 1순위 조건 + 재건축 연한 단지: 지금 살면서 재건축 기대까지
 *  추가 B 대출 없이 사고 남는 돈을 굴려 노후에 보태기
 */
(function (root, factory) {
  const node = typeof module !== 'undefined' && module.exports;
  const mod = node ? factory(require('./policy.js'), require('./engine.js'), require('./geo.js'), require('./conditions.js')) : factory(root.REA_POLICY, root.REA, root.REA_GEO, root.REA_COND);
  if (node) module.exports = mod;
  else root.REA_TIERS = mod;
})(typeof self !== 'undefined' ? self : this, function (P, E, GEO, COND) {
  const MAN = 1e4, EOK = 1e8;

  // 개인 값은 비워 둔다 (공개 코드). 개인 설정 링크나 화면 입력으로 채운다.
  const DEFAULTS = {
    name: '',
    age: 45, targetAge: 60,
    homes: [], // [{ name, value, loan, loanRate, jeonse }]
    cgtReserve: 0, // 매도 양도세 예상 (원)
    cashReserve: 3000 * MAN, // 남겨 둘 비상금
    annualIncome: 0, // 세전 연소득 (DSR 확인용, 0이면 미확인)
    pay: 300 * MAN, payMax: 350 * MAN, payPlusRatio: 1.5, payHigh: 1000 * MAN,
    loanRate: 0.04, plusRate: 0.05, // 새 주담대 금리, 추가 자금(개인 차입 등) 금리
    loanTerm: 30, // 대출 만기(년). 60세에 남은 대출은 집을 팔아 한 번에 갚고 후순위 지역으로 옮긴다
    reconShareM2: 300 * MAN, // 재건축 분담금 가정 (전용㎡당, 현재 돈). 84㎡면 약 2.5억
    reconYears: 10, // 재건축 입주까지 가정 (년). 분담금은 이 기간 물가만큼 오른다
    reconChance: 0.6, // 재건축이 60세 전에 끝날 가능성. 오르는 몫에 곱한다
    saveRest: true, // 월 상환 기본 한도에서 실제 상환을 뺀 나머지를 매달 저축해 60세 노후 자금에 더한다
    retireNeed: 350 * MAN, // 노후 월 생활비 (현재 돈 가치)
    postIncome: 300 * MAN, // 60세 이후 월 소득 (3순위 가정)
    inflation: 0.02, growthAdjust: -0.015, cashReturn: 0.03, withdraw: 0.04,
    downsizeHome: 5 * EOK, // 노후에 옮겨 살 집 (현재 돈 가치), 차액을 노후 자금으로
    minArea: 59, maxArea: 200,
  };

  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const lerp = (x, x0, y0, x1, y1) => (x <= x0 ? y0 : x >= x1 ? y1 : y0 + ((x - x0) / (x1 - x0)) * (y1 - y0));

  // 두 채 매도 후 쓸 수 있는 현금
  function funds(p) {
    const homes = p.homes || [];
    const equity = homes.reduce((s, h) => s + (h.value || 0) - (h.loan || 0) - (h.jeonse || 0), 0);
    const sellCosts = homes.reduce((s, h) => s + (h.value ? E.brokerFee(h.value, 'sale', true) : 0), 0);
    const cash = equity - sellCosts - (p.cgtReserve || 0) - (p.cashReserve || 0);
    return { equity, sellCosts, cgt: p.cgtReserve || 0, reserve: p.cashReserve || 0, cash };
  }

  // 은행 주담대 한도 (서울: 규제지역, 매수 시점 무주택 = 두 채 먼저 매도)
  function bankLimit(price, regionId, p, termYears) {
    const r = E.region(regionId);
    const ltv = P.LOAN.ltv[r.regulated ? 'regulated' : r.capital ? 'capital' : 'local'].nohome;
    let cap = Infinity;
    if (r.regulated) cap = P.LOAN.regulatedCaps.find((c) => price <= c.upTo).cap;
    else if (r.capital) cap = P.LOAN.capitalCap;
    let dsr = Infinity, dsrChecked = false;
    if (p.annualIncome > 0) {
      const stress = (r.capital || r.regulated ? P.LOAN.stressRate.capital : P.LOAN.stressRate.local) / 100;
      dsr = E.pv((p.annualIncome * P.LOAN.dsrLimit.bank) / 12, p.loanRate + stress, Math.min(termYears, 30) * 12);
      dsrChecked = true;
    }
    return { amount: Math.max(0, Math.min(price * ltv, cap, dsr)), ltv: price * ltv, cap, dsr, dsrChecked };
  }

  // 미래 상승률: 단지 5·10년 CAGR과 구 CAGR을 섞고 보수적으로 깎는다
  const median = (a) => { if (!a.length) return null; const x = a.slice().sort((m, n) => m - n), k = x.length >> 1; return x.length % 2 ? x[k] : (x[k - 1] + x[k]) / 2; };

  /**
   * 같은 동 통계. 실거래 검증(2021→2026)에서 신축은 같은 동 준신축 ㎡당가에 맞춰지고(오차 중앙값 12%, 편향 ≈0),
   * 5년 뒤 시세는 같은 동 단지 상승률을 적용할 때 가장 잘 맞았다(오차 5%, 구 상승률은 10%).
   * cands: [{ id, regionId, dong, area, price, count, builtYear, g5, g10 }]
   */
  function dongIndex(cands, thisYear = new Date().getFullYear()) {
    const by = new Map();
    for (const c of cands) {
      const k = c.regionId + '|' + c.dong;
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(c);
    }
    const out = new Map();
    for (const [k, list] of by) {
      const gs = list.map((c) => (c.g5 != null && c.g10 != null ? (c.g5 + c.g10) / 2 : c.g5 != null ? c.g5 : c.g10)).filter((x) => x != null);
      const fresh = list.filter((c) => c.builtYear && thisYear - c.builtYear <= 15 && c.area >= 49 && c.area <= 135 && c.count >= 2);
      out.set(k, {
        g: gs.length >= 2 ? median(gs) : null, gN: gs.length,
        newM2: fresh.length >= 2 ? median(fresh.map((c) => c.price / c.area)) : null, newN: new Set(fresh.map((c) => c.name)).size,
      });
    }
    return out;
  }

  function growth(c, reg, p, dong) {
    const avg = (a, b) => (a != null && b != null ? (a + b) / 2 : a != null ? a : b);
    const regionG = reg ? avg(reg.cagr5, reg.cagr10) : null;
    const complexG = avg(c.g5, c.g10);
    const dongG = dong && dong.g != null ? dong.g : null;
    const parts = [[complexG, 0.4], [dongG, 0.4], [regionG, 0.2]].filter((x) => x[0] != null);
    const w = parts.reduce((a, x) => a + x[1], 0);
    let g = w ? parts.reduce((a, x) => a + x[0] * x[1], 0) / w : 0.03;
    const basis = [complexG != null && '단지', dongG != null && '같은 동', regionG != null && '구'].filter(Boolean).join('·') + (w ? ' 과거 상승률' : '기본 3%');
    g = clamp(g + (p.growthAdjust || 0), 0, 0.055); // 과거 급등기(2016~2021)가 섞여 있어 보수적으로
    return { g, basis, complexG, dongG, regionG };
  }

  // ── 정비사업 단계 (서울 정비사업 정보몽땅) ────────────────────────────
  const STAGES = P.RECON.stages; // 12단계
  const STAGE_FIX = { 사업시행자지정: '조합설립인가', '정비계획 수립': '기본계획수립', 분양: '일반분양승인', 조합창립총회: '추진위원회승인', 조합규약작성: '추진위원회승인', 사업계획승인: '사업시행인가', 도시계획심의: '정비구역지정' };
  function normStage(text) {
    const t = String(text || '').trim();
    if (!t) return null;
    if (STAGE_FIX[t]) return STAGE_FIX[t];
    if (/사업계획승인/.test(t)) return '사업시행인가';
    if (/지구단위|건축심의|교통심의/.test(t)) return '정비구역지정';
    return COND ? COND.stageFromText(t) : null;
  }
  const APT_KINDS = /재건축|리모델링/; // 아파트 후보에 맞는 사업 (재개발·가로주택·지역주택 제외)
  const core = (name) => String(name || '').replace(/\s+/g, '').replace(/(재건축|정비사업|주택|조합|추진위원회|아파트|리모델링|소규모)/g, '');

  /**
   * 정비사업 목록(data/redev-seoul.json)으로 사업장 색인과 '주변 사례' 진행 비율을 만든다.
   * 진행 비율: 같은 구(사례가 적으면 서울 전체)에서 그 단계 이상까지 온 재건축 사업 중 준공·해산까지 끝난 비율.
   * 한 시점의 단면이라 오래된 사업일수록 끝났을 가능성이 커지는 편향이 있다 (참고용 추정).
   */
  function redevIndex(snap) {
    const cols = snap.cols, at = (r, k) => r[cols.indexOf(k)] || '';
    const projects = snap.rows.map((r) => {
      const stage = normStage(at(r, '진행단계'));
      const [dong, ...rest] = at(r, '대표지번').split(' ');
      return { gu: at(r, '자치구'), kind: at(r, '사업구분'), name: at(r, '사업장명'), dong, jibun: rest.join(' '), stageText: at(r, '진행단계'), stage, idx: stage ? STAGES.indexOf(stage) : -1, cafe: at(r, 'cafe'), rec: at(r, 'rec') };
    }).filter((x) => APT_KINDS.test(x.kind));
    const done = STAGES.indexOf('준공');
    const stats = (list) => STAGES.map((st, i) => {
      const reached = list.filter((x) => x.idx >= i).length, fin = list.filter((x) => x.idx >= done).length;
      return { reached, done: fin, rate: reached ? fin / reached : null };
    });
    const byGu = new Map();
    for (const x of projects) { if (!byGu.has(x.gu)) byGu.set(x.gu, []); byGu.get(x.gu).push(x); }
    const seoulStats = stats(projects);
    // 구별 사례가 적으면 서울 전체 비율 쪽으로 당긴다 (사례 10곳 분량의 서울 비율을 더해 평균)
    const K = 10;
    const guStats = new Map([...byGu].map(([g, l]) => [g, stats(l).map((x, i) => {
      const base = seoulStats[i].rate ?? 0.3;
      return { ...x, rate: (x.done + K * base) / (x.reached + K), raw: x.rate };
    })]));
    return { projects, byGu, guStats, seoulStats, fetchedAt: snap.fetchedAt };
  }

  // 후보 단지와 정비사업 사업장 짝짓기: 같은 구·같은 동 + 이름 일치
  function matchProject(c, ri) {
    const gu = E.region(c.regionId).name.replace(/^서울 /, '');
    const list = ri.byGu.get(gu) || [];
    const cc = core(c.name);
    const lot = (j) => String(j || '').split('-')[0].replace(/\D/g, '');
    const cl = lot(c.jibun);
    // 1) 같은 동·같은 대표 지번(본번) 2) 같은 동·이름 일치
    return (cl && list.find((x) => x.dong === c.dong && lot(x.jibun) === cl))
      || (cc.length >= 2 && list.find((x) => x.dong === c.dong && (core(x.name).includes(cc) || (core(x.name).length >= 2 && cc.includes(core(x.name))))))
      || null;
  }

  /**
   * 재건축 가능성 추정 (30년 넘은 단지): 등록된 사업이면 그 단계의 주변 사례 완료 비율과 단계별 입주까지 기간,
   * 등록 전이면 '같은 구 30년 넘은 단지 중 사업 등록 비율 × 추진위 단계 완료 비율'.
   */
  function redevChance(c, ri, oldInGu) {
    const gu = E.region(c.regionId).name.replace(/^서울 /, '');
    const st = ri.guStats.get(gu) || ri.seoulStats;
    const scope = st === ri.seoulStats ? '서울' : `${gu}(서울 비율로 보정)`;
    const pr = matchProject(c, ri);
    if (pr && pr.idx >= STAGES.indexOf('준공')) return { project: pr, done: true };
    if (pr && pr.idx > 0) {
      const s = st[pr.idx];
      return { project: pr, stage: pr.stage, chance: clamp(s.rate ?? 0.3, 0.03, 0.95), years: P.RECON.yearsToMoveIn[pr.stage] ?? 10, scope, reached: s.reached, doneN: s.done };
    }
    const reg = oldInGu && oldInGu.get(gu);
    const startRate = reg && reg.total ? reg.registered / reg.total : 0.3;
    const s = st[STAGES.indexOf('추진위원회승인')];
    return { project: pr, stage: null, chance: clamp(startRate * (s.rate ?? 0.3), 0.03, 0.95), years: P.RECON.yearsToMoveIn['기본계획수립'], scope, startRate, reached: s.reached, doneN: s.done };
  }
  // 구별 '30년 넘은 단지 중 정비사업 등록 비율'
  function oldRegisteredByGu(cands, ri, thisYear = new Date().getFullYear()) {
    const out = new Map(), seen = new Set();
    for (const c of cands) {
      if (!c.builtYear || thisYear - c.builtYear < 30) continue;
      const k = c.regionId + '|' + c.dong + '|' + c.name;
      if (seen.has(k)) continue; seen.add(k);
      const gu = E.region(c.regionId).name.replace(/^서울 /, '');
      if (!out.has(gu)) out.set(gu, { total: 0, registered: 0 });
      const o = out.get(gu); o.total++; if (matchProject(c, ri)) o.registered++;
    }
    return out;
  }

  // 재건축 뒤 시세: 같은 동 신축(15년 이내) ㎡당가 × 면적, 분담금은 입주까지 물가만큼 오른다
  const NOT_REBUILDABLE = /타워|주상복합|오피스텔|빌딩|파크텔|스카이|트윈/;
  // 단지별 가정: 직접 고친 값 > 정비사업 단계·주변 사례 추정 > 내 기준 기본값
  function reconAssume(c, p) {
    const ov = (p.reconOverrides || {})[c.id] || {};
    const rx = c.redev || {};
    return {
      chance: ov.chance ?? rx.chance ?? p.reconChance ?? 0.6,
      years: ov.years ?? rx.years ?? p.reconYears ?? 10,
      shareM2: ov.shareM2 ?? p.reconShareM2 ?? 0,
      source: ov.chance != null || ov.years != null || ov.shareM2 != null ? '직접 입력' : rx.chance != null ? '정비사업 단계·주변 사례' : '내 기준 기본값',
    };
  }
  function rebuild(c, p, dong, g, years) {
    if (!dong || !dong.newM2) return null;
    if (NOT_REBUILDABLE.test(c.name || '') || (c.count || 0) < 3) return null; // 주상복합·소규모 단지는 재건축 가치를 넣지 않는다
    if (c.redev && c.redev.done) return null;
    const A = reconAssume(c, p);
    if (A.years > years) return null; // 60세 전에 입주하지 못하면 넣지 않는다
    const raw = dong.newM2 * c.area; // 지금 신축이라면
    const nowNew = Math.min(raw, c.price * 2); // 격차가 2배를 넘으면 다른 상품끼리 비교했을 가능성이 커 2배로 자른다
    const share = (A.shareM2 || 0) * c.area * Math.pow(1 + p.inflation, Math.min(A.years, years));
    const v60 = nowNew * Math.pow(1 + g, years) - share;
    return { nowNew, capped: raw > nowNew, share, chance: A.chance, years: A.years, assumeSource: A.source, v60, low: v60 - nowNew * Math.pow(1 + g, years) * 0.15, high: v60 + nowNew * Math.pow(1 + g, years) * 0.15, peers: dong.newN, premium: nowNew / c.price - 1 };
  }

  // 입지 점수 (교통·상권·인프라): 좌표·주변 시설을 조회했으면 그것으로, 아니면 구 중심 추정
  function location(c) {
    const at = c.coords || GEO.CENTROIDS[c.regionId];
    const hubs = GEO.WORKPLACES.filter((w) => ['gbd', 'cbd', 'ybd'].includes(w.id));
    const commute = at ? Math.min(...hubs.map((w) => GEO.transitMinutes(at, w.at))) : null;
    const parts = [];
    if (commute != null) parts.push(['업무지구 통근', lerp(commute, 20, 100, 70, 10), 0.35]);
    if (c.subwayMin != null) parts.push(['역세권', lerp(c.subwayMin, 5, 100, 20, 15), 0.3]);
    if (c.infra) {
      const { mart = 0, hospital = 0, school = null } = c.infra;
      parts.push(['상권·생활', clamp(35 + mart * 20 + Math.min(hospital, 20) * 2, 0, 100), 0.25]);
      if (school != null) parts.push(['초등학교', lerp(school, 5, 100, 20, 30), 0.1]);
    }
    const w = parts.reduce((s, x) => s + x[2], 0);
    let score = w ? Math.round(parts.reduce((s, x) => s + x[1] * x[2], 0) / w) : 50;
    // 좌표·역·상권을 확인하지 않은 추정치는 중간값 쪽으로 당긴다 (구 중심 통근만으로 순위가 쏠리지 않게)
    if (!c.coords || !c.infra) score = Math.round(score * 0.5 + 15);
    return { score, commute, parts, estimated: !c.coords || !c.infra };
  }

  // 60세 시점 노후 월소득 (현재 돈 가치): 집을 줄여 옮기고 차액을 인출률로 쓰거나, 주택연금 중 큰 값
  // debt60: 60세에 남은 대출. 집을 팔아 먼저 갚는다 (주택연금이면 연금 대상 가치에서 뺀다)
  function retirement(value60, extra60, p, years, debt60 = 0) {
    const deflate = Math.pow(1 + p.inflation, years);
    const homeReal = value60 / deflate, extraReal = (extra60 || 0) / deflate, debtReal = debt60 / deflate;
    const downsize = Math.max(0, homeReal - debtReal - p.downsizeHome) * p.withdraw / 12;
    const pension = Math.max(0, Math.min(homeReal, 17 * EOK) - debtReal) * 0.0022; // 60세 정액형, 공시가 12억(시세 약 17억) 상한 근사
    const fromHome = Math.max(downsize, pension);
    const fromCash = extraReal * p.withdraw / 12;
    return { monthly: fromHome + fromCash, fromHome, fromCash, method: downsize >= pension ? '팔아서 대출 갚고 작은 집으로 이사, 차액 운용' : '주택연금', homeReal, extraReal, debtReal };
  }
  // 원리금균등 대출의 n개월 뒤 잔액
  function balanceAfter(principal, rate, termMonths, paidMonths) {
    if (principal <= 0) return 0;
    if (paidMonths >= termMonths) return 0;
    const i = rate / 12, m = E.pmt(principal, rate, termMonths);
    if (!i) return principal - m * paidMonths;
    const g = Math.pow(1 + i, paidMonths);
    return Math.max(0, principal * g - m * (g - 1) / i);
  }

  /**
   * 한 단지 평가. c: { regionId, name, dong, area, price, jeonse, count, builtYear, g5, g10, coords?, subwayMin?, infra? }
   */
  function evaluate(c, p, reg, f, dong) {
    const years = Math.max(1, p.targetAge - p.age);
    const term = Math.max(years, p.loanTerm || years); // 만기가 60세보다 길면 남은 대출은 60세에 집을 팔아 갚는다
    const costs = E.closingCosts({ price: c.price, regionId: c.regionId, homesAfter: 1, temporaryTwo: false, areaOver85: c.area > 85, firstTime: false, publicPrice: c.price * 0.69, vat: true, propertyType: '아파트' }).total;
    const need = c.price + costs - f.cash; // 모자라는 돈 (음수면 남음)
    const bank = bankLimit(c.price, c.regionId, p, term);
    const loan = Math.max(0, Math.min(need, bank.amount));
    const plus = Math.max(0, need - bank.amount);
    const payBank = E.pmt(loan, p.loanRate, term * 12);
    const payPlus = E.pmt(plus, p.plusRate, term * 12);
    const payTotal = payBank + payPlus;
    const gr = growth(c, reg, p, dong);
    const recon = c.builtYear && new Date().getFullYear() - c.builtYear >= 30;
    // 재건축 연한: 같은 동 신축 시세로 재건축 뒤 가치를 잡고 분담금을 뺀다. 같은 동에 신축이 없으면 +0.7%p로 대신
    const rb = recon ? rebuild(c, p, dong, gr.g, Math.max(1, p.targetAge - p.age)) : null;
    const gRecon = recon && !rb && (!dong || dong.newM2 == null) ? Math.min(0.08, gr.g + 0.007) : gr.g; // 같은 동 신축 정보가 없을 때만 +0.7%p
    const leftover = Math.max(0, -need);
    const v60 = c.price * Math.pow(1 + gr.g, years);
    const v60plain = c.price * Math.pow(1 + gRecon, years);
    // 재건축으로 오르는 몫은 성사 가능성만큼만 인정 (손해면 재건축에 기대지 않고 그대로 둔다)
    const v60r = rb ? v60plain + rb.chance * Math.max(0, rb.v60 - v60plain) : v60plain;
    // 월 상환 여유분 저축: (기본 한도 − 실제 상환)을 매달 모아 60세에 쓴다
    const saveMonthly = p.saveRest ? Math.max(0, p.pay - payTotal) : 0;
    const mi = p.cashReturn / 12, nm = years * 12;
    const save60 = saveMonthly > 0 ? (mi ? saveMonthly * (Math.pow(1 + mi, nm) - 1) / mi : saveMonthly * nm) : 0;
    const cash60 = leftover * Math.pow(1 + p.cashReturn, years);
    const debt60 = balanceAfter(loan, p.loanRate, term * 12, years * 12) + balanceAfter(plus, p.plusRate, term * 12, years * 12);
    const ret = retirement(v60, save60, p, years, debt60);
    const retRecon = retirement(v60r, save60, p, years, debt60);
    const retCash = retirement(v60, cash60 + save60, p, years, debt60);
    const retHome = retirement(v60, 0, p, years, debt60); // 저축 없이 집만으로 (4순위)
    const loc = location(c);
    return {
      c, years, term, debt60, saveMonthly, save60, costs, need, bank, loan, plus, payBank, payPlus, payTotal, growth: gr, recon, gRecon, rebuild: rb, leftover,
      v60, v60r, cash60, ret, retRecon, retCash, loc,
      retHome, ratioHome: retHome.monthly / p.retireNeed,
      ratio: ret.monthly / p.retireNeed, ratioRecon: retRecon.monthly / p.retireNeed, ratioCash: retCash.monthly / p.retireNeed,
    };
  }

  const TIERS = [
    { id: 't1', rank: '1순위', title: '대출 상환 능력 안에서 · 바로 입주 · 60세 노후 준비', short: '대출만 · 바로 입주 · 노후 준비' },
    { id: 't2', rank: '2순위', title: '대출 + 추가 자금 · 입주는 늦어도 · 노후 + 알파', short: '대출+추가 자금 · 미래가치 큼' },
    { id: 't3', rank: '3순위', title: '대출 없이 · 바로 입주 · 60세 이후 소득이 있으면 노후 가능', short: '대출 없이 · 노후 일부' },
    { id: 't4', rank: '4순위', title: '대출 없이 · 바로 입주 · 집만으로 노후 가능', short: '대출 없이 · 노후 준비' },
    { id: 't5', rank: '5순위', title: '대출 + 추가 자금(월 상환 고소득 한도) · 미래가치 최상', short: '고소득 가정 · 미래가치 최상' },
    { id: 'xa', rank: '추가 A', title: '1순위 조건 + 재건축 연한 단지: 지금 살면서 재건축 기대까지', short: '살면서 재건축 기대' },
    { id: 'xb', rank: '추가 B', title: '대출 없이 사고 남는 돈을 굴려 노후에 보태기', short: '남는 돈 운용' },
  ];

  // 순위별 조건과 점수. 입지 점수 45점 미만은 모든 순위에서 뺀다 (교통·상권·인프라는 기본 조건)
  /**
   * 순위 규칙. 기본값은 요청한 1~5순위 정의이고, 사용자가 화면에서 바꾼 항목(p.tierRules[id])만 덮어쓴다.
   *  loan: none(대출 없이) | bank(은행 대출만) | plus(은행 + 추가 자금) | need(대출 필요, 방식 무관) | any
   *  pay: 월 상환 한도(원), minPct: 노후 목표 대비 %, recon: 재건축 기대 반영, homeOnly: 저축 빼고 집만으로,
   *  postIncome: 60세 이후 소득을 더해 노후 판단, cash: 남는 돈 운용 포함, onlyOld: 30년 넘은 단지만, vsBest: 1~4순위 최고 대비 배수
   */
  function defaultRules(p) {
    return {
      t1: { loan: 'bank', pay: p.payMax, minPct: 100, recon: false },
      t2: { loan: 'plus', pay: p.pay * p.payPlusRatio, minPct: 130, recon: true },
      t3: { loan: 'none', pay: null, minPct: 50, recon: false, postIncome: true },
      t4: { loan: 'none', pay: null, minPct: 100, recon: false, homeOnly: true },
      t5: { loan: 'need', pay: p.payHigh, minPct: 200, recon: true, vsBest: 1.3 },
      xa: { loan: 'bank', pay: p.payMax, minPct: 130, recon: true, onlyOld: true },
      xb: { loan: 'none', pay: null, minPct: 100, recon: false, cash: true, leftoverMin: 1 * EOK },
    };
  }
  function rulesFor(p) {
    const d = defaultRules(p), ov = p.tierRules || {};
    return Object.fromEntries(Object.entries(d).map(([id, r]) => {
      const o = ov[id] || {};
      const m = { ...r };
      for (const k of ['loan', 'pay', 'minPct', 'recon']) if (o[k] !== undefined && o[k] !== null && o[k] !== '') m[k] = o[k];
      m.comment = o.comment || '';
      m.custom = ['loan', 'pay', 'minPct', 'recon'].some((k) => o[k] !== undefined && o[k] !== null && o[k] !== '');
      return [id, m];
    }));
  }
  const LOAN_OK = {
    none: (e) => e.need <= 0, bank: (e) => e.need > 0 && e.plus === 0, plus: (e) => e.plus > 0, need: (e) => e.need > 0, any: () => true,
  };
  const retFor = (r, e) => (r.recon ? e.retRecon : r.cash ? e.retCash : r.homeOnly ? e.retHome : e.ret);
  const valueFor = (r, e) => retFor(r, e).monthly / e.pRetireNeed;

  // 순위별 조건과 점수. 입지 점수 45점 미만은 모든 순위에서 뺀다 (교통·상권·인프라는 기본 조건)
  function classify(evals, p) {
    const MIN_LOC = 45;
    const R = rulesFor(p);
    const ok = evals.filter((e) => e.loc.score >= MIN_LOC && e.c.area >= p.minArea && e.c.area <= p.maxArea && e.c.count >= 1);
    ok.forEach((e) => { e.pRetireNeed = p.retireNeed; });
    const base = (r, e) => (LOAN_OK[r.loan] || LOAN_OK.any)(e) && (r.pay == null || e.payTotal <= r.pay)
      && (!r.onlyOld || e.recon) && (!r.leftoverMin || e.leftover >= r.leftoverMin);
    const pass = (r, e) => base(r, e) && valueFor(r, e) * 100 >= r.minPct && (!r.postIncome || retFor(r, e).monthly + p.postIncome >= p.retireNeed);
    const score = (r, e) => {
      const v = valueFor(r, e);
      const future = clamp(lerp(v, 0.5, 20, 3, 100), 0, 100);
      const hiPay = r.pay != null && r.pay > p.payMax * 2;
      const comfort = e.need > 0 ? clamp(lerp(e.payTotal / p.pay, 0.5, 100, hiPay ? 3.4 : 1.6, 30), 0, 100) : 80;
      const liquidity = clamp(lerp(e.c.count, 1, 30, 15, 100), 0, 100);
      const thin = e.c.count < 3 ? (e.c.count <= 1 ? 0.85 : 0.93) : 1;
      return Math.round((future * 0.45 + e.loc.score * 0.35 + comfort * 0.1 + liquidity * 0.1) * thin);
    };
    const out = {};
    for (const t of TIERS) {
      const r = R[t.id];
      const list = ok.filter((e) => pass(r, e)).map((e) => ({ e, score: score(r, e), value: valueFor(r, e) }));
      list.sort((a, b) => b.score - a.score || b.value - a.value);
      out[t.id] = list;
    }
    // 비어 있는 순위: 노후 기준만 빼면 가장 가까운 단지 (얼마나 모자라는지 보여 주기)
    const nearest = {};
    for (const t of TIERS) {
      if (out[t.id].length) continue;
      const r = R[t.id];
      let best = null;
      for (const e of ok) if (base(r, e) && (!best || valueFor(r, e) > valueFor(r, best))) best = e;
      nearest[t.id] = best ? { name: best.c.name, regionId: best.c.regionId, price: best.c.price, value: valueFor(r, best), monthly: retFor(r, best).monthly } : null;
    }
    // vsBest: 1~4순위 최고 미래가치보다 그 배수 이상 (기본 5순위 1.3배)
    const best14 = Math.max(0, ...['t1', 't2', 't3', 't4'].flatMap((id) => out[id].slice(0, 5).map((x) => x.value)));
    for (const t of TIERS) if (R[t.id].vsBest) out[t.id] = out[t.id].filter((x) => x.value >= best14 * R[t.id].vsBest);
    return { tiers: TIERS.map((t) => ({ ...t, rule: R[t.id], items: out[t.id], nearest: nearest[t.id] || null })), considered: evals.length, kept: ok.length, best14 };
  }

  // 한 단지를 여러 순위에 넣지 않도록: 위 순위에 이미 뽑힌 단지는 아래에서 빼고 상위 n개
  function topN(result, n) {
    const used = new Set();
    return result.tiers.map((t) => {
      const items = [];
      for (const x of t.items) {
        if (items.length >= n) break;
        if (used.has(x.e.c.id)) continue;
        items.push(x); used.add(x.e.c.id);
      }
      return { ...t, items };
    });
  }

  function cautions(e, p) {
    const out = [];
    if (e.c.count < 3) out.push(`최근 거래 ${e.c.count}건뿐이라 시세를 믿기 어려움`);
    if (e.recon) out.push(e.rebuild
      ? `${e.c.builtYear}년 준공 — 재건축 시 이주 필요, 분담금 약 ${Math.round(e.rebuild.share / MAN).toLocaleString()}만원 · 입주까지 ${e.rebuild.years}년 · 성사 가능성 ${Math.round(e.rebuild.chance * 100)}% (${e.rebuild.assumeSource})`
      : `${e.c.builtYear}년 준공 — 재건축 가치는 넣지 않거나(주상복합·소규모·입주가 60세 이후) 대략 반영`);
    if (e.rebuild && e.rebuild.capped) out.push('같은 동 신축과 격차가 커서 재건축 뒤 시세를 현재가의 2배로 제한 (다른 상품일 가능성)');
    if (e.need > 0 && !e.bank.dsrChecked) out.push('연소득을 넣지 않아 DSR 한도는 확인하지 않음');
    if (e.payTotal > p.pay && e.payTotal <= p.payMax) out.push(`월 상환 ${Math.round(e.payTotal / MAN)}만원 (기본 ${Math.round(p.pay / MAN)}만원 초과, 최대 한도 이내)`);
    if (e.debt60 > 0) out.push(`${p.targetAge}세에 남는 대출 약 ${Math.round(e.debt60 / MAN).toLocaleString()}만원은 집을 팔아 갚는 계획 (시세가 오르지 않으면 부담)`);
    if (e.plus > 0) out.push(`은행 대출 한도 밖 ${Math.round(e.plus / MAN).toLocaleString()}만원을 추가 자금(연 ${(p.plusRate * 100).toFixed(1)}%)으로 마련해야 함`);
    if (e.loc.estimated) out.push('입지는 구 중심 기준 추정');
    if (E.region(e.c.regionId).landPermit) out.push('토지거래허가구역: 허가 후 2년 실거주 필요 (전세 낀 매수 불가)');
    return out;
  }

  return { DEFAULTS, TIERS, defaultRules, rulesFor, retFor, funds, bankLimit, dongIndex, rebuild, reconAssume, normStage, redevIndex, matchProject, redevChance, oldRegisteredByGu, growth, location, retirement, balanceAfter, evaluate, classify, topN, cautions };
});
