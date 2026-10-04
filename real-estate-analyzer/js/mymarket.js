/*
 * 내 조건으로 서울 단지 평가하기 (내 맞춤 추천·매수 판단기 '내 조건으로 찾기' 공용).
 * 서울 시장 데이터(data/market-seoul.json, 매주)와 정비사업 목록(data/redev-seoul.json, 6시간마다)을 한 번만 받아
 * 단지 목록·같은 동 통계·재건축 가능성을 붙여 두고, 개인 조건(이 기기의 localStorage)으로 평가한다.
 */
(function (root) {
  const T = root.REA_TIERS;
  const PROFILE_KEY = 'rea-my-profile';
  let market = null, redevSnap = null, prepared = null, loading = null;

  function loadProfile() {
    try { return { ...T.DEFAULTS, ...(JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null') || {}) }; } catch (_) { return { ...T.DEFAULTS }; }
  }
  const hasProfile = (p) => !!(p && (p.homes || []).length);

  async function load() {
    if (market) return market;
    if (!loading) loading = (async () => {
      const r = await fetch('data/market-seoul.json', { cache: 'no-store' });
      if (!r.ok) throw new Error('서울 시장 데이터가 아직 없습니다 (매주 자동 수집)');
      const m = await r.json();
      try {
        const q = await fetch('data/redev-seoul.json', { cache: 'no-store' });
        if (q.ok) redevSnap = await q.json();
      } catch (_) { /* 정비사업 단계 없이 계산 */ }
      market = m;
      return m;
    })().catch((err) => { loading = null; throw err; });
    return loading;
  }

  function candidates() {
    const cols = market.cols;
    return market.cands.map((row) => {
      const o = Object.fromEntries(cols.map((c, i) => [c, row[i]]));
      return { id: `${o.r}|${o.n}|${o.d}|${Math.round(o.a)}`, regionId: o.r, name: o.n, dong: o.d, jibun: o.j, area: o.a, price: o.p, jeonse: o.je, count: o.c, builtYear: o.y, g5: o.g5, g10: o.g10 };
    });
  }

  // 단지 목록 + 같은 동 통계 + 30년 넘은 단지의 정비사업 단계·재건축 가능성 (한 번만)
  function prepare() {
    if (prepared) return prepared;
    const all = candidates();
    const dongs = T.dongIndex(all);
    let ri = null;
    if (redevSnap) {
      ri = T.redevIndex(redevSnap);
      const og = T.oldRegisteredByGu(all, ri), yr = new Date().getFullYear();
      for (const c of all) if (c.builtYear && yr - c.builtYear >= 30) c.redev = T.redevChance(c, ri, og);
    }
    prepared = { all, dongs, ri };
    return prepared;
  }

  const dongOf = (c) => prepare().dongs.get(c.regionId + '|' + c.dong);
  function evaluate(c, p, f = T.funds(p)) {
    return T.evaluate(c, p, market.regions[c.regionId], f, dongOf(c));
  }
  function evaluateAll(p, list = prepare().all) {
    const f = T.funds(p);
    return list.map((c) => evaluate(c, p, f));
  }

  root.REA_MYMARKET = {
    load, prepare, evaluate, evaluateAll, loadProfile, hasProfile, dongOf, PROFILE_KEY,
    get market() { return market; },
    get redevSnap() { return redevSnap; },
  };
})(typeof self !== 'undefined' ? self : this);
