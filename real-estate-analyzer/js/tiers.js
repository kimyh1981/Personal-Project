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
  const mod = node ? factory(require('./policy.js'), require('./engine.js'), require('./geo.js')) : factory(root.REA_POLICY, root.REA, root.REA_GEO);
  if (node) module.exports = mod;
  else root.REA_TIERS = mod;
})(typeof self !== 'undefined' ? self : this, function (P, E, GEO) {
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
  function growth(c, reg, p) {
    const avg = (a, b) => (a != null && b != null ? (a + b) / 2 : a != null ? a : b);
    const regionG = reg ? avg(reg.cagr5, reg.cagr10) : null;
    const complexG = avg(c.g5, c.g10);
    let g = complexG != null && regionG != null ? 0.5 * complexG + 0.5 * regionG : complexG != null ? complexG : regionG != null ? regionG : 0.03;
    const basis = complexG != null ? '단지·구 과거 상승률' : regionG != null ? '구 과거 상승률' : '기본 3%';
    g = clamp(g + (p.growthAdjust || 0), 0, 0.055); // 과거 급등기(2016~2021)가 섞여 있어 보수적으로
    return { g, basis, complexG, regionG };
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
  function retirement(value60, extra60, p, years) {
    const deflate = Math.pow(1 + p.inflation, years);
    const homeReal = value60 / deflate, extraReal = (extra60 || 0) / deflate;
    const downsize = Math.max(0, homeReal - p.downsizeHome) * p.withdraw / 12;
    const pension = Math.min(homeReal, 17 * EOK) * 0.0022; // 60세 정액형, 공시가 12억(시세 약 17억) 상한 근사
    const fromHome = Math.max(downsize, pension);
    const fromCash = extraReal * p.withdraw / 12;
    return { monthly: fromHome + fromCash, fromHome, fromCash, method: downsize >= pension ? '집 줄여 이사 후 차액 운용' : '주택연금', homeReal, extraReal };
  }

  /**
   * 한 단지 평가. c: { regionId, name, dong, area, price, jeonse, count, builtYear, g5, g10, coords?, subwayMin?, infra? }
   */
  function evaluate(c, p, reg, f) {
    const years = Math.max(1, p.targetAge - p.age);
    const term = years; // 60세까지 다 갚는 조건
    const costs = E.closingCosts({ price: c.price, regionId: c.regionId, homesAfter: 1, temporaryTwo: false, areaOver85: c.area > 85, firstTime: false, publicPrice: c.price * 0.69, vat: true, propertyType: '아파트' }).total;
    const need = c.price + costs - f.cash; // 모자라는 돈 (음수면 남음)
    const bank = bankLimit(c.price, c.regionId, p, term);
    const loan = Math.max(0, Math.min(need, bank.amount));
    const plus = Math.max(0, need - bank.amount);
    const payBank = E.pmt(loan, p.loanRate, term * 12);
    const payPlus = E.pmt(plus, p.plusRate, term * 12);
    const payTotal = payBank + payPlus;
    const gr = growth(c, reg, p);
    const recon = c.builtYear && new Date().getFullYear() - c.builtYear >= 30;
    const gRecon = recon ? Math.min(0.08, gr.g + 0.007) : gr.g; // 재건축 연한: 이주·분담금을 감수하면 +0.7%p
    const leftover = Math.max(0, -need);
    const v60 = c.price * Math.pow(1 + gr.g, years);
    const v60r = c.price * Math.pow(1 + gRecon, years);
    const cash60 = leftover * Math.pow(1 + p.cashReturn, years);
    const ret = retirement(v60, 0, p, years);
    const retRecon = retirement(v60r, 0, p, years);
    const retCash = retirement(v60, cash60, p, years);
    const loc = location(c);
    return {
      c, years, costs, need, bank, loan, plus, payBank, payPlus, payTotal, growth: gr, recon, gRecon, leftover,
      v60, v60r, cash60, ret, retRecon, retCash, loc,
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
  function classify(evals, p) {
    const MIN_LOC = 45;
    const ok = evals.filter((e) => e.loc.score >= MIN_LOC && e.c.area >= p.minArea && e.c.area <= p.maxArea && e.c.count >= 1);
    const payLimit2 = p.pay * p.payPlusRatio;
    const pick = {
      t1: (e) => e.need > 0 && e.plus === 0 && e.payTotal <= p.payMax && e.ratio >= 1,
      t2: (e) => e.plus > 0 && e.payTotal <= payLimit2 && e.ratioRecon >= 1.3,
      t3: (e) => e.need <= 0 && e.ret.monthly + p.postIncome >= p.retireNeed && e.ratio >= 0.5,
      t4: (e) => e.need <= 0 && e.ratio >= 1,
      t5: (e) => e.need > 0 && e.payTotal <= p.payHigh && e.ratioRecon >= 2,
      xa: (e) => e.recon && e.need > 0 && e.plus === 0 && e.payTotal <= p.payMax && e.ratioRecon >= 1.3,
      xb: (e) => e.leftover >= 1 * EOK && e.ratioCash >= 1,
    };
    const valueOf = { t1: (e) => e.ratio, t2: (e) => e.ratioRecon, t3: (e) => e.ratio, t4: (e) => e.ratio, t5: (e) => e.ratioRecon, xa: (e) => e.ratioRecon, xb: (e) => e.ratioCash };
    const score = (id, e) => {
      const v = valueOf[id](e);
      const future = clamp(lerp(v, 0.5, 20, 3, 100), 0, 100);
      const comfort = e.need > 0 ? clamp(lerp(e.payTotal / p.pay, 0.5, 100, id === 't5' ? 3.4 : 1.6, 30), 0, 100) : 80;
      const liquidity = clamp(lerp(e.c.count, 1, 30, 15, 100), 0, 100);
      const thin = e.c.count < 3 ? (e.c.count <= 1 ? 0.85 : 0.93) : 1;
      return Math.round((future * 0.45 + e.loc.score * 0.35 + comfort * 0.1 + liquidity * 0.1) * thin);
    };
    const out = {};
    for (const t of TIERS) {
      const list = ok.filter(pick[t.id]).map((e) => ({ e, score: score(t.id, e), value: valueOf[t.id](e) }));
      list.sort((a, b) => b.score - a.score || b.value - a.value);
      out[t.id] = list;
    }
    // 비어 있는 순위: 조건 중 노후 기준만 빼면 가장 가까운 단지 (얼마나 모자라는지 보여 주기)
    const relaxed = {
      t1: (e) => e.need > 0 && e.plus === 0 && e.payTotal <= p.payMax, t2: (e) => e.plus > 0 && e.payTotal <= payLimit2,
      t3: (e) => e.need <= 0, t4: (e) => e.need <= 0, t5: (e) => e.need > 0 && e.payTotal <= p.payHigh,
      xa: (e) => e.recon && e.need > 0 && e.plus === 0 && e.payTotal <= p.payMax, xb: (e) => e.leftover >= 1 * EOK,
    };
    const nearest = {};
    for (const t of TIERS) {
      if (out[t.id].length) continue;
      let best = null;
      for (const e of ok) if (relaxed[t.id](e) && (!best || valueOf[t.id](e) > valueOf[t.id](best))) best = e;
      nearest[t.id] = best ? { name: best.c.name, regionId: best.c.regionId, price: best.c.price, value: valueOf[t.id](best), monthly: (t.id === 'xb' ? best.retCash : ['t2', 't5', 'xa'].includes(t.id) ? best.retRecon : best.ret).monthly } : null;
    }
    // 5순위는 1~4순위 최고 미래가치보다 30% 이상 높아야 한다
    const best14 = Math.max(0, ...['t1', 't2', 't3', 't4'].flatMap((id) => out[id].slice(0, 5).map((x) => x.value)));
    out.t5 = out.t5.filter((x) => x.value >= best14 * 1.3);
    return { tiers: TIERS.map((t) => ({ ...t, items: out[t.id], nearest: nearest[t.id] || null })), considered: evals.length, kept: ok.length, best14 };
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
    if (e.recon) out.push(`${e.c.builtYear}년 준공 — 재건축 시 이주·분담금 필요`);
    if (e.need > 0 && !e.bank.dsrChecked) out.push('연소득을 넣지 않아 DSR 한도는 확인하지 않음');
    if (e.payTotal > p.pay && e.payTotal <= p.payMax) out.push(`월 상환 ${Math.round(e.payTotal / MAN)}만원 (기본 ${Math.round(p.pay / MAN)}만원 초과, 최대 한도 이내)`);
    if (e.plus > 0) out.push(`은행 대출 한도 밖 ${Math.round(e.plus / MAN).toLocaleString()}만원을 추가 자금(연 ${(p.plusRate * 100).toFixed(1)}%)으로 마련해야 함`);
    if (e.loc.estimated) out.push('입지는 구 중심 기준 추정');
    if (E.region(e.c.regionId).landPermit) out.push('토지거래허가구역: 허가 후 2년 실거주 필요 (전세 낀 매수 불가)');
    return out;
  }

  return { DEFAULTS, TIERS, funds, bankLimit, growth, location, retirement, evaluate, classify, topN, cautions };
});
