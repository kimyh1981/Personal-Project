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
      const kind = o.k || '아파트';
      return { id: `${o.r}|${o.n}|${o.d}|${Math.round(o.a)}${kind === '아파트' ? '' : '|' + kind}`, regionId: o.r, name: o.n, dong: o.d, jibun: o.j, area: o.a, price: o.p, jeonse: o.je, count: o.c, builtYear: o.y, g5: o.g5, g10: o.g10, kind };
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

  const dongOf = (c) => prepare().dongs.get(T.dongKey(c));
  function evaluate(c, p, f = T.funds(p)) {
    return T.evaluate(c, p, market.regions[c.regionId], f, dongOf(c));
  }
  // extra: 순위에 넣은 내 여유자금 (그만큼 현금을 늘려 평가)
  function evaluateAll(p, list = prepare().all, extra = 0) {
    const f = T.withExtra(T.funds(p), extra);
    return list.map((c) => evaluate(c, p, f));
  }

  // 내 기준의 찾을 지역(구, 비우면 서울 전체)·주택 종류(비우면 아파트)
  const KINDS = ['아파트', '빌라', '단독주택'];
  const kindsOf = (p) => (p.kinds && p.kinds.length ? p.kinds : ['아파트']);
  function scope(p, list = prepare().all) {
    const gus = new Set((p.regions || []).map((g) => 'seoul-' + g)), ks = new Set(kindsOf(p));
    return list.filter((c) => (!gus.size || gus.has(c.regionId)) && ks.has(c.kind));
  }
  // 시장 데이터에 들어 있는 주택 종류와 수집 상태 (빌라·단독주택은 활용신청해야 모인다)
  const kindStatus = () => {
    const have = new Set(prepare().all.map((c) => c.kind));
    return Object.fromEntries(KINDS.map((k) => [k, have.has(k) ? 'ok' : (market && market.kinds && market.kinds[k]) || '수집 전']));
  };

  root.REA_MYMARKET = {
    KINDS, kindsOf, scope, kindStatus,
    load, prepare, evaluate, evaluateAll, loadProfile, hasProfile, dongOf, PROFILE_KEY,
    get market() { return market; },
    get redevSnap() { return redevSnap; },
  };
})(typeof self !== 'undefined' ? self : this);
