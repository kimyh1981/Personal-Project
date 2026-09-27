/*
 * 브이월드 필지 토지이용계획: 응답 해석(서버·브라우저 공용)과 브라우저 직접 조회.
 * 브라우저 조회는 서버(npm start) 없이 웹 주소(GitHub Pages)에서도 쓰기 위한 것이다.
 * 브이월드 인증키의 서비스URL에 웹 주소의 도메인을 등록해야 한다.
 */
(function (root, factory) {
  const vw = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = vw;
  else root.REA_VWORLD = vw;
})(typeof self !== 'undefined' ? self : this, function () {
  const asArray = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
  const SEARCH = 'https://api.vworld.kr/req/search';
  const LAND_USE = 'https://api.vworld.kr/ned/data/getLandUseAttr';

  function parseVworldSearch(json) {
    const r = json && json.response;
    if (!r) throw new Error('브이월드 주소검색 응답 형식 오류');
    if (r.status === 'NOT_FOUND') return [];
    if (r.status !== 'OK') throw new Error(`브이월드 주소검색 오류: ${(r.error && r.error.text) || r.status}`);
    return asArray(r.result && r.result.items).map((it) => ({
      pnu: String(it.id || ''),
      address: (it.address && (it.address.parcel || it.address.road)) || it.title || '',
    })).filter((x) => /^\d{19}$/.test(x.pnu));
  }

  // 지역지구 이름으로 규제 판정
  function classifyZones(names) {
    const has = (re) => names.some((n) => re.test(n));
    return {
      landPermit: has(/토지거래(계약에관한)?허가/),
      speculativeOverheated: has(/투기과열/),
      adjusted: has(/조정대상/),
      redevZone: has(/정비구역|정비예정구역|재정비촉진|재건축|재개발/),
    };
  }

  function parseLandUse(json) {
    const root = json && (json.landUses || json.response || json);
    const fields = asArray(root && (root.field || (root.result && root.result.field)));
    if (!fields.length && json && json.error) throw new Error('브이월드 토지이용계획 오류: ' + JSON.stringify(json.error).slice(0, 120));
    const zones = [...new Set(fields.map((f) => f.prposAreaDstrcCodeNm).filter(Boolean))];
    return { zones, ...classifyZones(zones) };
  }

  const searchUrl = (q, key, domain) => `${SEARCH}?service=search&request=search&version=2.0&size=5&type=address&category=parcel&format=json&query=${encodeURIComponent(q)}&key=${encodeURIComponent(key)}${domain ? '&domain=' + encodeURIComponent(domain) : ''}`;
  const landUseUrl = (pnu, key, domain) => `${LAND_USE}?pnu=${pnu}&format=json&numOfRows=100&pageNo=1&key=${encodeURIComponent(key)}&domain=${encodeURIComponent(domain || '')}`;

  // 브이월드는 브라우저용으로 JSONP(callback)를 지원한다. CORS가 열려 있으면 fetch가 먼저 성공한다.
  let seq = 0;
  function jsonp(url, timeoutMs = 12000) {
    return new Promise((resolve, reject) => {
      const name = `__reaVw${Date.now().toString(36)}${seq++}`;
      const s = document.createElement('script');
      const done = (fn, v) => { clearTimeout(t); delete window[name]; s.remove(); fn(v); };
      const t = setTimeout(() => done(reject, new Error('브이월드 응답 시간 초과 (서비스URL에 이 사이트 도메인이 등록됐는지 확인)')), timeoutMs);
      window[name] = (data) => done(resolve, data);
      s.onerror = () => done(reject, new Error('브이월드에 연결하지 못했습니다'));
      s.src = `${url}&callback=${name}`;
      document.head.appendChild(s);
    });
  }
  async function getBrowser(url) {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (r.ok) return await r.json();
    } catch (_) { /* CORS 차단: JSONP로 재시도 */ }
    return jsonp(url);
  }

  // 브라우저에서 지번 주소 → PNU → 토지이용계획
  async function lookup(address, key, domain) {
    const q = String(address || '').trim();
    if (!key) throw new Error('브이월드 인증키를 입력하세요');
    if (q.length < 4) throw new Error('지번 주소를 입력하세요 (예: 서울 마포구 아현동 777)');
    const hits = parseVworldSearch(await getBrowser(searchUrl(q, key, domain)));
    if (!hits.length) throw new Error('주소를 찾지 못했습니다. 지번 주소로 입력하세요');
    const u = await getBrowser(landUseUrl(hits[0].pnu, key, domain));
    return { ...parseLandUse(u), pnu: hits[0].pnu, address: hits[0].address, fetchedAt: new Date().toISOString(), source: '국토교통부 토지이용계획 (브이월드, 브라우저 직접 조회)' };
  }

  return { parseVworldSearch, classifyZones, parseLandUse, searchUrl, landUseUrl, lookup };
});
