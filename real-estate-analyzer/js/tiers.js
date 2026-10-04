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
    extraFunds: 0, // 추가 동원 가능 자금 (예금·가족 지원 등). 서울 매수에 쓸 현금에 더한다
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
    // 거주 계획: now(바로 입주) | defer(세입자 두고 deferMonths 뒤 입주). 법상 미룰 수 없으면 바로 입주로 계산하고 이유를 보여 준다
    residence: 'now', deferMonths: 24,
    tempHousing: 0, // 입주를 미루는 동안 따로 살 집의 전세금 (입주할 때 돌려받는다)
    buyDate: '', // 매수 시기 'YYYY-MM' (비우면 이번 달)
    nohomeSince: '', // 계속 무주택 시작일 (집을 보유 중이면 비운다). 실거주 유예 자격 판단
    permitAfter: 'extend', // 토지거래허가 지정 기간(2026-12-31) 뒤: extend(연장 가정) | lift(해제 가정)
    rateType: 'periodic', // 주담대 금리 유형: 스트레스 DSR 반영비율이 낮아 한도가 큰 주기형을 기본으로
  };
  const thisMonth = () => new Date().toISOString().slice(0, 7);

  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const lerp = (x, x0, y0, x1, y1) => (x <= x0 ? y0 : x >= x1 ? y1 : y0 + ((x - x0) / (x1 - x0)) * (y1 - y0));

  // 두 채 매도 후 쓸 수 있는 현금. temp: 입주를 미루는 동안 살 집 전세금 (그동안만 묶이고 입주할 때 돌아온다)
  function funds(p) {
    const homes = p.homes || [];
    const equity = homes.reduce((s, h) => s + (h.value || 0) - (h.loan || 0) - (h.jeonse || 0), 0);
    const sellCosts = homes.reduce((s, h) => s + (h.value ? E.brokerFee(h.value, 'sale', true) : 0), 0);
    const add = Math.max(0, p.extraFunds || 0); // 추가로 동원할 수 있는 내 자금 (예금·가족 지원 등, 갚지 않는 돈)
    const cash = equity - sellCosts - (p.cgtReserve || 0) - (p.cashReserve || 0) + add;
    const temp = p.tempHousing || 0;
    return { equity, sellCosts, cgt: p.cgtReserve || 0, reserve: p.cashReserve || 0, add, cash, temp, cashDefer: cash - temp, extra: 0 };
  }
  // 순위별 내 여유자금(추가로 동원할 내 돈)을 더한 자금
  const withExtra = (f, extra) => (extra > 0 ? { ...f, extra, cash: f.cash + extra, cashDefer: f.cashDefer + extra } : f);

  /**
   * 은행 주담대 한도 (서울: 규제지역, 매수 시점 무주택 = 두 채 먼저 매도).
   * min(LTV, 주택가격별 한도 6·4·2억, 스트레스 DSR). 스트레스 금리는 수도권 하한 3%p × 금리 유형별 반영비율,
   * 만기는 수도권 상한 30년. 어느 것이 한도를 정했는지(by)도 돌려준다.
   */
  function bankLimit(price, regionId, p, termYears) {
    const r = E.region(regionId);
    const ltvRate = P.LOAN.ltv[r.regulated ? 'regulated' : r.capital ? 'capital' : 'local'].nohome;
    let cap = Infinity;
    if (r.regulated) cap = P.LOAN.regulatedCaps.find((c) => price <= c.upTo).cap;
    else if (r.capital) cap = P.LOAN.capitalCap;
    const rateType = P.LOAN.stressWeight[p.rateType] != null ? p.rateType : 'periodic';
    const maxTerm = r.capital || r.regulated ? P.LOAN.capitalMaxTermYears : 40;
    const stress = ((r.capital || r.regulated ? P.LOAN.stressRate.capital : P.LOAN.stressRate.local) / 100) * P.LOAN.stressWeight[rateType];
    let dsr = Infinity, dsrChecked = false;
    if (p.annualIncome > 0) {
      dsr = E.pv((p.annualIncome * P.LOAN.dsrLimit.bank) / 12, p.loanRate + stress, Math.min(termYears, maxTerm) * 12);
      dsrChecked = true;
    }
    const ltv = price * ltvRate;
    const amount = Math.max(0, Math.min(ltv, cap, dsr));
    const by = amount === ltv ? `LTV ${Math.round(ltvRate * 100)}%` : amount === cap ? `주택가격별 한도 ${cap / EOK}억` : '스트레스 DSR 40%';
    return { amount, ltv, ltvRate, cap, dsr, dsrChecked, rateType, stress, by };
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

  const manw = (x) => `${Math.round(x / MAN).toLocaleString()}만원`;
  /**
   * 자금 계획. 바로 입주(now) 또는 세입자를 두고 deferMonths 뒤 입주(defer).
   * defer는 법이 허용할 때만: 토지거래허가 대상이면 실거주 유예 자격(2026-05-12부터 계속 무주택)이 있어야 하고,
   * 허가 대상이 아니어도 수도권·규제지역 주담대는 6개월 전입의무가 있어 매수 때 대출 없이 전세보증금으로 산다.
   * 입주할 때 돌려줄 전세금은 [따로 살던 집 전세금 + 남은 현금 + 미루는 동안 모은 돈]으로 내고, 모자라면
   * 전세퇴거자금 대출(수도권·규제지역 1억 한도, LTV·DSR 안)과 추가 자금으로 채운다.
   */
  function plan(c, p, f, bank, costs, term) {
    const now = (why, rule, forced) => {
      const need = c.price + costs - f.cash;
      return { mode: 'now', need, loan: Math.max(0, Math.min(need, bank.amount)), loanLate: 0, plus: Math.max(0, need - bank.amount), startMonths: 0, why: why || '', rule: rule || null, forced: !!forced };
    };
    if (p.residence !== 'defer') return now();
    const rr = COND.residenceRule({ regionId: c.regionId, buyDate: p.buyDate || thisMonth(), nohomeSince: p.nohomeSince, tenant: true, permitAfter: p.permitAfter });
    if (!rr.deferOK) return now(rr.why, rr, true);
    const J = c.jeonse || 0;
    if (!J) return now('같은 평형 전세 시세가 없어 세입자를 두고 사는 계획은 계산하지 못했습니다.', rr, true);
    const M = Math.max(1, Math.round(p.deferMonths || 24));
    // 매수 때 은행 대출: 허가 대상 주택은 전입의무가 면제되지만 세입자 보증금이 먼저 잡혀 LTV에서 빠진다
    const loanNow = rr.loanMoveIn ? 0 : Math.max(0, Math.min(bank.amount, bank.ltv - J));
    const cashNow = c.price + costs - J - loanNow;
    if (cashNow > f.cashDefer) return now(`세입자를 두고 ${M}개월 뒤 입주하려면 지금 현금이 ${manw(cashNow - f.cashDefer)} 더 필요해 바로 입주로 계산했습니다.`, rr, true);
    const left = f.cashDefer - cashNow;
    const payNow = E.pmt(loanNow, p.loanRate, term * 12);
    const saved = Math.max(0, p.pay - payNow) * M;
    const fundsAt = f.temp + left * Math.pow(1 + p.cashReturn, M / 12) + saved;
    const need = J - fundsAt;
    const r = E.region(c.regionId);
    const capR = r.capital || r.regulated ? P.RESIDENCE.jeonseReturnCap : Infinity;
    const loanLate = Math.max(0, Math.min(need, capR, bank.ltv - loanNow, bank.dsr - loanNow, bank.cap - loanNow));
    const plus = Math.max(0, need - loanLate);
    return { mode: 'defer', need, loan: loanNow + loanLate, loanNow, loanLate, plus, startMonths: M, cashNow, left, saved, fundsAt, J, capR, why: rr.why, rule: rr, forced: false };
  }

  /**
   * 한 단지 평가. c: { regionId, name, dong, area, price, jeonse, count, builtYear, g5, g10, coords?, subwayMin?, infra? }
   */
  function evaluate(c, p, reg, f, dong) {
    const years = Math.max(1, p.targetAge - p.age);
    const term = Math.max(years, p.loanTerm || years); // 만기가 60세보다 길면 남은 대출은 60세에 집을 팔아 갚는다
    const costs = E.closingCosts({ price: c.price, regionId: c.regionId, homesAfter: 1, temporaryTwo: false, areaOver85: c.area > 85, firstTime: false, publicPrice: c.price * 0.69, vat: true, propertyType: '아파트' }).total;
    const bank = bankLimit(c.price, c.regionId, p, term);
    const pl = plan(c, p, f, bank, costs, term);
    const { need, loan, plus } = pl;
    const M = pl.startMonths; // 대출·추가 자금 상환이 시작되기까지 (입주를 미루면 그 뒤부터)
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
    // 월 상환 여유분 저축: (기본 한도 − 실제 상환)을 매달 모아 60세에 쓴다 (입주를 미룬 기간은 전세금 반환에 이미 썼다)
    const saveMonthly = p.saveRest ? Math.max(0, p.pay - payTotal) : 0;
    const mi = p.cashReturn / 12, nm = Math.max(0, years * 12 - M);
    const save60 = saveMonthly > 0 ? (mi ? saveMonthly * (Math.pow(1 + mi, nm) - 1) / mi : saveMonthly * nm) : 0;
    const cash60 = leftover * Math.pow(1 + p.cashReturn, Math.max(0, years - M / 12));
    const debt60 = pl.mode === 'defer'
      ? balanceAfter(pl.loanNow, p.loanRate, term * 12, years * 12) + balanceAfter(pl.loanLate, p.loanRate, term * 12, nm) + balanceAfter(plus, p.plusRate, term * 12, nm)
      : balanceAfter(loan, p.loanRate, term * 12, years * 12) + balanceAfter(plus, p.plusRate, term * 12, years * 12);
    const ret = retirement(v60, save60, p, years, debt60);
    const retRecon = retirement(v60r, save60, p, years, debt60);
    const retCash = retirement(v60, cash60 + save60, p, years, debt60);
    const retHome = retirement(v60, 0, p, years, debt60); // 저축 없이 집만으로 (4순위)
    const loc = location(c);
    return {
      c, years, term, debt60, saveMonthly, save60, costs, need, bank, loan, plus, payBank, payPlus, payTotal, plan: pl, extraCash: f.extra || 0, growth: gr, recon, gRecon, rebuild: rb, leftover,
      v60, v60r, cash60, ret, retRecon, retCash, loc,
      retHome, ratioHome: retHome.monthly / p.retireNeed,
      ratio: ret.monthly / p.retireNeed, ratioRecon: retRecon.monthly / p.retireNeed, ratioCash: retCash.monthly / p.retireNeed,
    };
  }

  // ── 메모 글 → 조건 ─────────────────────────────────────────────────
  // 순위 메모에 적은 말에서 지역(구·동·권역), 가격, 면적(평형), 연식, 역세권을 읽는다. 읽지 못한 말은 메모로만 남는다.
  const SEOUL_GU = P.REGIONS.filter((r) => r.group === '서울').map((r) => r.name.replace(/^서울 /, ''));
  const GU_GROUPS = [
    [/강남\s*4\s*구/, ['강남구', '서초구', '송파구', '강동구'], '강남4구'],
    [/강남\s*3\s*구|강남권/, ['강남구', '서초구', '송파구'], '강남3구'],
    [/마용성광/, ['마포구', '용산구', '성동구', '광진구'], '마용성광'],
    [/마용성/, ['마포구', '용산구', '성동구'], '마용성'],
    [/노도강/, ['노원구', '도봉구', '강북구'], '노도강'],
    [/금관구/, ['금천구', '관악구', '구로구'], '금관구'],
    [/도심권/, ['종로구', '중구', '용산구'], '도심권'],
  ];
  const PYEONG_PER_M2 = 0.393; // 전용㎡ → 공급 평형 (84㎡ ≈ 33평형)
  const num = (x) => parseFloat(String(x).replace(/,/g, ''));
  function parseMemo(text, dongNames = []) {
    let t = String(text || '');
    const out = { gus: [], dongs: [], labels: [] };
    if (!t.trim()) return out;
    const add = (k, v) => { if (!out[k].includes(v)) out[k].push(v); };
    // 권역 → 구 (권역 이름은 지운 뒤 개별 구를 찾는다: '강남3구'의 '강남'이 강남구만으로 읽히지 않게)
    for (const [re, gus, label] of GU_GROUPS) if (re.test(t)) { gus.forEach((g) => add('gus', g)); out.labels.push(label); t = t.replace(new RegExp(re.source, 'g'), ' '); }
    for (const g of SEOUL_GU) {
      const short = g.replace(/구$/, '');
      const re = g === '중구' ? /(^|[^가-힣])중구/ : new RegExp(`${short}(구)?(?![가-힣]*동)`);
      if (re.test(t) && !(g === '강서구' && /강서[가-힣]*동/.test(t))) { add('gus', g); }
    }
    // 동: '대치동'처럼 '동'까지 쓰거나, 동 이름 뒤에 역·쪽·일대·근처가 오면
    for (const d of dongNames) {
      if (!d || d.length < 2) continue;
      const stem = d.replace(/동$/, '');
      if (t.includes(d) || (stem.length >= 2 && new RegExp(`${stem}(역|쪽|일대|근처|권)`).test(t))) add('dongs', d);
    }
    // 동 이름 안의 구 이름('서초동'의 서초)으로 잘못 잡힌 구는 뺀다
    out.gus = out.gus.filter((g) => {
      const short = g.replace(/구$/, '');
      const stripped = out.dongs.reduce((x, d) => x.split(d).join(' '), t);
      return g === '중구' || new RegExp(short).test(stripped) || out.labels.some((l) => GU_GROUPS.find((x) => x[2] === l)[1].includes(g));
    });
    // 가격
    let m;
    if ((m = t.match(/(\d+(?:\.\d+)?)\s*(?:억)?\s*[~∼\-]\s*(\d+(?:\.\d+)?)\s*억/))) { out.minPrice = num(m[1]) * EOK; out.maxPrice = num(m[2]) * EOK; }
    else {
      if ((m = t.match(/(\d+(?:\.\d+)?)\s*억\s*원?\s*(이하|미만|까지|이내|아래|안쪽)/))) out.maxPrice = num(m[1]) * EOK;
      if ((m = t.match(/(\d+(?:\.\d+)?)\s*억\s*원?\s*(이상|초과|넘는|부터|넘게)/))) out.minPrice = num(m[1]) * EOK;
    }
    // 면적: 평형(공급) 또는 전용㎡
    if ((m = t.match(/(\d{2})\s*평\s*(형)?\s*대/))) { const a = num(m[1]); out.minArea = Math.round(a / PYEONG_PER_M2); out.maxArea = Math.round((a + 10) / PYEONG_PER_M2) - 1; }
    else if ((m = t.match(/(\d{2})\s*평\s*(형)?\s*(이상|넘는)/))) out.minArea = Math.round(num(m[1]) / PYEONG_PER_M2);
    else if ((m = t.match(/(\d{2})\s*평/))) { const a = num(m[1]); out.minArea = Math.round((a - 1.5) / PYEONG_PER_M2); out.maxArea = Math.round((a + 1.5) / PYEONG_PER_M2); }
    if ((m = t.match(/(\d{2,3}(?:\.\d+)?)\s*(?:㎡|m2|m²|제곱미터)\s*(이상)?/))) {
      const a = num(m[1]);
      if (m[2]) { out.minArea = a; delete out.maxArea; } else { out.minArea = a - 3; out.maxArea = a + 3; }
    }
    // 연식
    if (/준신축/.test(t)) out.maxAge = 15;
    else if (/신축/.test(t)) out.maxAge = 10;
    if ((m = t.match(/(?:준공|연식|지은\s*지)\s*(\d{1,2})\s*년\s*(?:이내|이하|안)/) || t.match(/(\d{1,2})\s*년\s*(?:이내|이하|안)\s*(?:신축|준공|단지|아파트)/))) out.maxAge = num(m[1]);
    if (/구축/.test(t)) out.minAge = 20;
    if (/재건축\s*(단지|대상|아파트|연한)|(30|삼십)\s*년\s*(이상|넘은|넘는)/.test(t)) out.minAge = 30;
    // 역세권
    if ((m = t.match(/역\s*(?:까지\s*)?(?:도보\s*)?(\d{1,2})\s*분/))) out.maxSubway = num(m[1]);
    else if (/역세권/.test(t)) out.maxSubway = 10;
    // 보이는 이름표
    const L = out.labels;
    const groupGus = new Set(out.labels.flatMap((l) => GU_GROUPS.find((x) => x[2] === l)[1]));
    out.gus.filter((g) => !groupGus.has(g)).forEach((g) => L.push(g));
    out.dongs.forEach((d) => L.push(d));
    if (out.minPrice != null && out.maxPrice != null) L.push(`${out.minPrice / EOK}~${out.maxPrice / EOK}억`);
    else if (out.maxPrice != null) L.push(`${out.maxPrice / EOK}억 이하`);
    else if (out.minPrice != null) L.push(`${out.minPrice / EOK}억 이상`);
    if (out.minArea != null || out.maxArea != null) L.push(`전용 ${out.minArea != null ? out.minArea : ''}~${out.maxArea != null ? out.maxArea : ''}㎡`);
    if (out.maxAge != null) L.push(`준공 ${out.maxAge}년 이내`);
    if (out.minAge != null) L.push(`준공 ${out.minAge}년 이상`);
    if (out.maxSubway != null) L.push(`역 도보 ${out.maxSubway}분 이내`);
    return out;
  }
  const hasRegion = (fl) => fl.gus.length + fl.dongs.length > 0;
  const guOf = (c) => E.region(c.regionId).name.replace(/^서울 /, '');
  // ignoreRegion: 지역만 빼고 나머지 조건으로 (추천이 없을 때 가능한 지역을 찾는 데 쓴다)
  function memoOk(e, fl, ignoreRegion, year = new Date().getFullYear()) {
    const c = e.c;
    if (!ignoreRegion && hasRegion(fl)) {
      const inGu = fl.gus.includes(guOf(c)), inDong = fl.dongs.includes(c.dong);
      if (!(inGu || inDong)) return false;
    }
    if (fl.maxPrice != null && c.price > fl.maxPrice) return false;
    if (fl.minPrice != null && c.price < fl.minPrice) return false;
    if (fl.minArea != null && c.area < fl.minArea) return false;
    if (fl.maxArea != null && c.area > fl.maxArea) return false;
    const age = c.builtYear ? year - c.builtYear : null;
    if (fl.maxAge != null && (age == null || age > fl.maxAge)) return false;
    if (fl.minAge != null && (age == null || age < fl.minAge)) return false;
    if (fl.maxSubway != null && (c.subwayMin == null || c.subwayMin > fl.maxSubway)) return false;
    return true;
  }
  // 지역 조건으로 추천이 없을 때: 같은 조건(지역 제외)으로 추천이 나오는 구와 그 안의 동
  function regionAlternatives(list) {
    const by = new Map();
    for (const e of list) {
      const g = guOf(e.c);
      if (!by.has(g)) by.set(g, { gu: g, n: 0, dongs: new Map() });
      const o = by.get(g); o.n++; o.dongs.set(e.c.dong, (o.dongs.get(e.c.dong) || 0) + 1);
    }
    return [...by.values()].sort((a, b) => b.n - a.n).slice(0, 8)
      .map((o) => ({ gu: o.gu, n: o.n, dongs: [...o.dongs].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([d, n]) => ({ dong: d, n })) }));
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
      const m = { ...r, id };
      for (const k of ['loan', 'pay', 'minPct', 'recon', 'extra']) if (o[k] !== undefined && o[k] !== null && o[k] !== '') m[k] = o[k];
      m.comment = o.comment || '';
      m.extra = Math.max(0, Number(m.extra) || 0); // 이 순위에만 더하는 내 여유자금 (갚지 않는 내 돈)
      m.custom = ['loan', 'pay', 'minPct', 'recon', 'extra'].some((k) => o[k] !== undefined && o[k] !== null && o[k] !== '');
      return [id, m];
    }));
  }
  // 대출 방식: 은행 대출(loan)·추가 자금(plus)을 실제로 쓰는지로 판단 (입주를 미루는 계획의 전세퇴거자금 대출 포함)
  const LOAN_OK = {
    none: (e) => e.loan + e.plus <= 0, bank: (e) => e.loan > 0 && e.plus === 0, plus: (e) => e.plus > 0, need: (e) => e.loan + e.plus > 0, any: () => true,
  };
  const retFor = (r, e) => (r.recon ? e.retRecon : r.cash ? e.retCash : r.homeOnly ? e.retHome : e.ret);
  const valueFor = (r, e) => retFor(r, e).monthly / e.pRetireNeed;

  // 순위별 조건과 점수. 입지 점수 45점 미만은 모든 순위에서 뺀다 (교통·상권·인프라는 기본 조건)
  /**
   * reeval(extra): 순위에 내 여유자금을 넣었을 때 그만큼 현금을 늘려 다시 평가한 목록 (없으면 여유자금은 무시)
   */
  function classify(evals, p, reeval) {
    const MIN_LOC = 45;
    const R = rulesFor(p);
    // locEstimatedOk: 지역을 직접 고른 경우(내 조건으로 찾기) 구 중심 추정 입지는 빼지 않는다 (실제로 확인한 입지만 기준 적용)
    const locOk = (e) => e.loc.score >= MIN_LOC || (p.locEstimatedOk && e.loc.estimated);
    const keep = (list) => {
      const out = list.filter((e) => locOk(e) && e.c.area >= p.minArea && e.c.area <= p.maxArea && e.c.count >= 1);
      out.forEach((e) => { e.pRetireNeed = p.retireNeed; });
      return out;
    };
    const ok = keep(evals);
    const okCache = new Map([[0, ok]]);
    const okFor = (r) => {
      const x = reeval ? r.extra || 0 : 0;
      if (!okCache.has(x)) okCache.set(x, keep(reeval(x)));
      return okCache.get(x);
    };
    const dongNames = [...new Set(evals.map((e) => e.c.dong))];
    const FL = Object.fromEntries(TIERS.map((t) => [t.id, parseMemo(R[t.id].comment, dongNames)]));
    const money = (r, e) => (LOAN_OK[r.loan] || LOAN_OK.any)(e) && (r.pay == null || e.payTotal <= r.pay)
      && (!r.onlyOld || e.recon) && (!r.leftoverMin || e.leftover >= r.leftoverMin);
    const base = (r, e) => money(r, e) && memoOk(e, FL[r.id]);
    const goal = (r, e) => valueFor(r, e) * 100 >= r.minPct && (!r.postIncome || retFor(r, e).monthly + p.postIncome >= p.retireNeed);
    const pass = (r, e) => base(r, e) && goal(r, e);
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
      const list = okFor(r).filter((e) => pass(r, e)).map((e) => ({ e, score: score(r, e), value: valueFor(r, e) }));
      list.sort((a, b) => b.score - a.score || b.value - a.value);
      out[t.id] = list;
    }
    // 비어 있는 순위: 노후 기준만 빼면 가장 가까운 단지 (얼마나 모자라는지 보여 주기)
    const nearest = {};
    for (const t of TIERS) {
      if (out[t.id].length) continue;
      const r = R[t.id];
      let best = null;
      for (const e of okFor(r)) if (base(r, e) && (!best || valueFor(r, e) > valueFor(r, best))) best = e;
      nearest[t.id] = best ? { name: best.c.name, regionId: best.c.regionId, price: best.c.price, value: valueFor(r, best), monthly: retFor(r, best).monthly } : null;
    }
    // vsBest: 1~4순위 최고 미래가치보다 그 배수 이상 (기본 5순위 1.3배)
    const best14 = Math.max(0, ...['t1', 't2', 't3', 't4'].flatMap((id) => out[id].slice(0, 5).map((x) => x.value)));
    for (const t of TIERS) if (R[t.id].vsBest) out[t.id] = out[t.id].filter((x) => x.value >= best14 * R[t.id].vsBest);
    // 메모의 지역 조건으로 추천이 없으면, 지역만 빼고 같은 조건으로 추천이 나오는 구·동을 안내한다
    const alt = {};
    for (const t of TIERS) {
      const fl = FL[t.id];
      if (out[t.id].length || !hasRegion(fl)) continue;
      const r = R[t.id];
      const vs = r.vsBest ? best14 * r.vsBest : 0;
      alt[t.id] = regionAlternatives(okFor(r).filter((e) => money(r, e) && memoOk(e, fl, true) && goal(r, e) && valueFor(r, e) >= vs));
    }
    return { tiers: TIERS.map((t) => ({ ...t, rule: R[t.id], memo: FL[t.id], items: out[t.id], nearest: nearest[t.id] || null, regionAlt: alt[t.id] || null })), considered: evals.length, kept: ok.length, best14 };
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
    if (e.loan + e.plus > 0 && !e.bank.dsrChecked) out.push('연소득을 넣지 않아 DSR 한도는 확인하지 않음');
    if (e.payTotal > p.pay && e.payTotal <= p.payMax) out.push(`월 상환 ${Math.round(e.payTotal / MAN)}만원 (기본 ${Math.round(p.pay / MAN)}만원 초과, 최대 한도 이내)`);
    if (e.debt60 > 0) out.push(`${p.targetAge}세에 남는 대출 약 ${Math.round(e.debt60 / MAN).toLocaleString()}만원은 집을 팔아 갚는 계획 (시세가 오르지 않으면 부담)`);
    if (e.plus > 0 && (!e.plan || e.plan.mode !== 'defer')) out.push(`은행 대출 한도 밖 ${Math.round(e.plus / MAN).toLocaleString()}만원을 추가 자금(연 ${(p.plusRate * 100).toFixed(1)}%)으로 마련해야 함`);
    if (e.loc.estimated) out.push('입지는 구 중심 기준 추정');
    const pl = e.plan || {};
    if (e.extraCash > 0) out.push(`이 순위는 내 여유자금 ${e.extraCash >= EOK ? `${+(e.extraCash / EOK).toFixed(2)}억원` : `${Math.round(e.extraCash / MAN).toLocaleString()}만원`}을 더해 계산 (갚지 않는 내 돈으로 봄)`);
    if (pl.mode === 'defer') out.push(pl.rule && pl.rule.lifted ? `토지거래허가 해제 가정 (${P.RESIDENCE.landPermitUntil} 뒤, 연장 여부 미정) — 연장되면 이 계획은 불가` : pl.why);
    else if (pl.forced) out.push(`나중에 입주 불가 → 바로 입주로 계산: ${pl.why}`);
    else if (E.region(e.c.regionId).landPermit) out.push(`토지거래허가구역: 허가 후 ${P.RESIDENCE.registerMonths}개월 안에 입주, ${P.RESIDENCE.stayYears}년 실거주`);
    if (pl.mode === 'defer' && pl.plus > 0) out.push(`입주 때 전세금을 돌려주려면 전세퇴거자금 대출(${Math.round(P.RESIDENCE.jeonseReturnCap / EOK)}억 한도) 밖 ${Math.round(pl.plus / MAN).toLocaleString()}만원이 더 필요`);
    return out;
  }

  return { DEFAULTS, TIERS, withExtra, parseMemo, memoOk, plan, defaultRules, rulesFor, retFor, funds, bankLimit, dongIndex, rebuild, reconAssume, normStage, redevIndex, matchProject, redevChance, oldRegisteredByGu, growth, location, retirement, balanceAfter, evaluate, classify, topN, cautions };
});
