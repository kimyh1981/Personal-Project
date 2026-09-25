/*
 * 최적지 추천: 실거래가(매매·전월세)로 단지·평형 후보를 만들고, 사용자 조건으로 한 곳씩 판정한 뒤
 * 목적(거주/투자)별 가중치로 순위를 매긴다. 순수 함수만 둔다 (판정은 analyze 콜백으로 받는다).
 */
(function (root, factory) {
  const node = typeof module !== 'undefined' && module.exports;
  const mod = factory(node ? require('./geo.js') : root.REA_GEO);
  if (node) module.exports = mod;
  else root.REA_RECO = mod;
})(typeof self !== 'undefined' ? self : this, function (GEO) {
  const median = (arr) => {
    if (!arr.length) return null;
    const s = arr.slice().sort((a, b) => a - b), k = Math.floor(s.length / 2);
    return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
  };
  const clamp = (x) => Math.max(0, Math.min(100, Math.round(x)));
  const lerp = (x, x0, y0, x1, y1) => (x <= x0 ? y0 : x >= x1 ? y1 : y0 + ((x - x0) / (x1 - x0)) * (y1 - y0));
  const monthsBefore = (iso, n) => { const d = new Date(iso); d.setMonth(d.getMonth() - n); return d.toISOString().slice(0, 10); };
  const areaBand = (a) => Math.round(a);

  /**
   * 단지·평형 후보 만들기.
   * sales: [{date, area, price, name, dong, jibun, builtYear}], rents: [{date, area, deposit, monthly, name}]
   * opt: { now('YYYY-MM-DD'), months(최근 기간), regionId }
   */
  function aggregate(sales, rents, opt) {
    const now = opt.now || new Date().toISOString().slice(0, 10);
    const cutoff = monthsBefore(now, opt.months || 6);
    const prevCutoff = monthsBefore(now, (opt.months || 6) + 12);
    const groups = new Map();
    for (const t of sales) {
      if (!t.area || !t.price || !t.name) continue;
      const key = `${t.name}|${t.dong || ''}|${areaBand(t.area)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(t);
    }
    const out = [];
    for (const [key, list] of groups) {
      const recent = list.filter((t) => t.date >= cutoff);
      if (!recent.length) continue;
      recent.sort((a, b) => b.date.localeCompare(a.date));
      const older = list.filter((t) => t.date < cutoff && t.date >= prevCutoff);
      const area = recent.reduce((s, t) => s + t.area, 0) / recent.length;
      const price = median(recent.slice(0, 10).map((t) => t.price));
      const olderPerM2 = median(older.map((t) => t.price / t.area));
      const built = median(list.map((t) => t.builtYear).filter(Boolean));
      const name = recent[0].name, dong = recent[0].dong || '';
      const rentPool = (rents || []).filter((r) => r.name === name && r.area && Math.abs(r.area - area) <= 3 && r.date >= monthsBefore(now, 12));
      const jeonseList = rentPool.filter((r) => !r.monthly).map((r) => r.deposit);
      out.push({
        id: `${opt.regionId || ''}|${key}`, regionId: opt.regionId || null, name, dong, jibun: recent[0].jibun || '',
        area: Math.round(area * 10) / 10, price, perM2: price / area, count: recent.length, lastDate: recent[0].date,
        lastPrice: recent[0].price, builtYear: built ? Math.round(built) : null,
        trend: olderPerM2 ? price / area / olderPerM2 - 1 : null,
        jeonse: median(jeonseList.slice(-10)), jeonseCount: jeonseList.length,
      });
    }
    // 같은 지역 안에서 ㎡당 중위가 대비 위치 (가격 적정성)
    const regionMedian = median(out.map((c) => c.perM2));
    for (const c of out) c.vsRegion = regionMedian ? c.perM2 / regionMedian - 1 : null;
    return out;
  }

  // 통근·역·학교 입지 채우기 (단지 좌표가 없으면 시·군·구 중심으로 추정)
  function locate(c, workplace) {
    const from = c.coords || GEO.CENTROIDS[c.regionId] || null;
    c.commuteMin = workplace ? GEO.transitMinutes(from, workplace) : null;
    c.commuteEstimated = !c.coords;
    return c;
  }

  const WEIGHTS = {
    거주: { commute: 0.22, cash: 0.18, afford: 0.12, subway: 0.12, school: 0.1, newness: 0.1, verdict: 0.16 },
    투자: { value: 0.2, jeonse: 0.12, subway: 0.14, liquidity: 0.12, recon: 0.1, afford: 0.1, cash: 0.06, verdict: 0.16 },
  };
  function weightsFor(purpose) {
    if (purpose === '거주+투자') {
      const w = {};
      for (const src of [WEIGHTS.거주, WEIGHTS.투자]) for (const [k, v] of Object.entries(src)) w[k] = (w[k] || 0) + v / 2;
      return w;
    }
    return WEIGHTS[purpose] || WEIGHTS.거주;
  }

  const LABEL = {
    commute: '통근', cash: '매달 남는 돈', afford: '예산 여유', subway: '역세권', school: '초등학교', newness: '연식',
    value: '가격 적정성', jeonse: '전세가율', liquidity: '거래 활발', recon: '재건축 기대', verdict: '종합 판정',
  };
  const man = (x) => {
    const v = Math.round(Math.abs(x) / 1e4), e = Math.floor(v / 1e4), r = v % 1e4;
    return (x < 0 ? '−' : '') + (e && r ? `${e}억 ${r.toLocaleString()}만` : e ? `${e}억` : `${r.toLocaleString()}만`);
  };

  /**
   * a: 해당 후보를 사용자 조건으로 판정한 결과
   *    { score(종합 점수), blocked(bool), blockReason, fundingGap, privateUsed, surplus, net, maxPrice }
   */
  function components(c, a, thisYear) {
    const age = c.builtYear ? thisYear - c.builtYear : null;
    const x = {
      afford: a.maxPrice ? clamp(lerp((a.maxPrice - c.price) / a.maxPrice, 0, 55, 0.2, 100)) : null,
      cash: a.net ? clamp(lerp(a.surplus / a.net, -0.1, 0, 0.3, 100)) : null,
      commute: c.commuteMin != null ? clamp(lerp(c.commuteMin, 25, 100, 70, 15)) : null,
      subway: c.subwayMin != null ? clamp(lerp(c.subwayMin, 5, 100, 20, 20)) : null,
      school: c.schoolMin != null ? clamp(lerp(c.schoolMin, 5, 100, 20, 30)) : null,
      newness: age != null ? clamp(lerp(age, 5, 100, 30, 30)) : null,
      recon: age != null ? (age >= 30 ? 85 : age >= 25 ? 60 : 30) : null,
      value: c.vsRegion != null ? clamp(lerp(c.vsRegion, -0.2, 100, 0.2, 20)) : null,
      jeonse: c.jeonse ? clamp((c.jeonse / c.price) * 140) : null,
      liquidity: clamp(lerp(c.count, 1, 30, 10, 100)),
      verdict: a.score != null ? a.score : null,
    };
    return { x, age };
  }

  function reasonText(key, c, a, age) {
    switch (key) {
      case 'commute': return `직장까지 대중교통 약 ${c.commuteMin}분${c.commuteEstimated ? ' (추정)' : ''}`;
      case 'cash': return `매수 후 매달 ${man(a.surplus)}원 남음`;
      case 'afford': return `매수 가능 한도 ${man(a.maxPrice)}원 대비 ${man(a.maxPrice - c.price)}원 여유`;
      case 'subway': return `${c.stationName ? c.stationName + ' ' : '지하철역 '}도보 약 ${c.subwayMin}분`;
      case 'school': return `초등학교 도보 약 ${c.schoolMin}분`;
      case 'newness': return `${c.builtYear}년 준공 (${age}년차)`;
      case 'recon': return `${c.builtYear}년 준공 ${age}년차 — 재건축 연한 도래`;
      case 'value': return `㎡당 가격이 같은 지역 중위보다 ${Math.abs(Math.round(c.vsRegion * 100))}% ${c.vsRegion < 0 ? '낮음' : '높음'}`;
      case 'jeonse': return `전세 ${man(c.jeonse)}원, 전세가율 ${Math.round((c.jeonse / c.price) * 100)}%`;
      case 'liquidity': return `최근 거래 ${c.count}건`;
      case 'verdict': return `종합 판정 ${a.score}점`;
      default: return LABEL[key];
    }
  }

  /**
   * cands: aggregate()+locate() 결과, analyze(c) → a (위 형식), opt: { purpose, thisYear, limit }
   */
  function rank(cands, analyze, opt) {
    const w = weightsFor(opt.purpose);
    const thisYear = opt.thisYear || new Date().getFullYear();
    const ranked = [], excluded = [];
    for (const c of cands) {
      const a = analyze(c);
      if (a.blocked) { excluded.push({ c, reason: a.blockReason || '조건 차단' }); continue; }
      if (a.fundingGap > 0) { excluded.push({ c, reason: `자기자금 ${man(a.fundingGap)}원 부족` }); continue; }
      const { x, age } = components(c, a, thisYear);
      let sum = 0, wsum = 0;
      const parts = [];
      for (const [k, wk] of Object.entries(w)) {
        if (x[k] == null) continue;
        sum += x[k] * wk; wsum += wk;
        parts.push({ key: k, label: LABEL[k], score: x[k], weight: wk });
      }
      const total = wsum ? Math.round(sum / wsum) : 0;
      const strengths = parts.filter((p) => p.score >= 70).sort((p, q) => q.score * q.weight - p.score * p.weight).slice(0, 4)
        .map((p) => reasonText(p.key, c, a, age));
      const cautions = parts.filter((p) => p.score < 50).sort((p, q) => p.score * p.weight - q.score * q.weight).slice(0, 3)
        .map((p) => reasonText(p.key, c, a, age));
      if (a.privateUsed > 0) cautions.unshift(`개인 차입 ${man(a.privateUsed)}원이 있어야 살 수 있음 (예산 밖)`);
      ranked.push({ c, a, total, parts, strengths, cautions });
    }
    ranked.sort((p, q) => q.total - p.total || p.c.price - q.c.price);
    return { ranked: ranked.slice(0, opt.limit || 20), excluded, considered: cands.length };
  }

  // ── 예시 데이터 (가상의 단지·시세, 화면 확인용) ─────────────────────────
  const TIER = {
    'seoul-강남구': 3000, 'seoul-서초구': 2900, 'seoul-송파구': 2400, 'seoul-용산구': 2400, 'seoul-성동구': 2000, 'seoul-마포구': 1900,
    'seoul-광진구': 1700, 'seoul-동작구': 1700, 'seoul-영등포구': 1650, 'seoul-양천구': 1700, 'seoul-강동구': 1600, 'seoul-종로구': 1500,
    'seoul-중구': 1550, 'seoul-서대문구': 1350, 'seoul-동대문구': 1300, 'seoul-성북구': 1250, 'seoul-강서구': 1300, 'seoul-은평구': 1200,
    'seoul-관악구': 1100, 'seoul-구로구': 1050, 'seoul-금천구': 950, 'seoul-노원구': 1000, 'seoul-도봉구': 850, 'seoul-강북구': 900, 'seoul-중랑구': 950,
    'gg-과천시': 2300, 'gg-성남시 분당구': 1900, 'gg-용인시 수지구': 1300, 'gg-광명시': 1350, 'gg-하남시': 1300, 'gg-안양시 동안구': 1300,
    'gg-수원시 영통구': 1150, 'gg-용인시 기흥구': 1000, 'gg-화성시 동탄구': 1050, 'gg-의왕시': 1000, 'gg-구리시': 1000,
  };
  function demoData(regionIds, seed, labels) {
    let s = seed || 11;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const now = new Date();
    const sales = {}, rents = {};
    for (const rid of regionIds) {
      const base = (TIER[rid] || 800) * 1e4;
      sales[rid] = []; rents[rid] = [];
      for (let k = 0; k < 14; k++) {
        const label = (labels && labels[rid]) || rid.split('-').pop();
        const short = label.split(' ').pop().replace(/(구|시)$/, '') || label;
        const name = `예시 ${short} ${String.fromCharCode(65 + k)}단지`;
        const built = 1988 + Math.floor(rnd() * 36);
        const quality = 0.8 + rnd() * 0.45 + (built > 2012 ? 0.12 : built < 1995 ? 0.05 : 0);
        for (const area of [59.9, 84.9]) {
          const n = 1 + Math.floor(rnd() * 9);
          for (let t = 0; t < n + 3; t++) {
            const d = new Date(now.getFullYear(), now.getMonth() - Math.floor(rnd() * 16), 1 + Math.floor(rnd() * 27));
            const monthsAgo = (now - d) / (30 * 864e5);
            const perM2 = base * quality * (0.95 + rnd() * 0.1) * (1 - 0.003 * monthsAgo); // 월 0.3% 상승 추세
            sales[rid].push({ date: d.toISOString().slice(0, 10), area, price: Math.round((perM2 * area) / 1e6) * 1e6, name, dong: '예시동', builtYear: built });
          }
          for (let t = 0; t < 3; t++) {
            const d = new Date(now.getFullYear(), now.getMonth() - Math.floor(rnd() * 10), 5);
            rents[rid].push({ date: d.toISOString().slice(0, 10), area, deposit: Math.round((base * quality * area * (0.5 + rnd() * 0.15)) / 1e6) * 1e6, monthly: 0, name });
          }
        }
      }
    }
    return { sales, rents };
  }

  return { aggregate, locate, rank, weightsFor, components, demoData, median, LABEL };
});
