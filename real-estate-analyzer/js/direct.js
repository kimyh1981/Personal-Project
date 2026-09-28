/*
 * 서버 없이(웹 주소·앱 설치본) 공공데이터를 브라우저가 직접 조회한다.
 * 로컬 서버(tools/server.js)의 /api/ 경로와 같은 응답을 돌려주므로, 화면 코드는 경로만 부르면 된다.
 * 모두 CORS를 허용하는 곳만 쓴다: 공공데이터포털(실거래가), 카카오 로컬, 서울 정비사업 정보몽땅, 브이월드(JSONP).
 * 인증키는 이 기기의 localStorage에만 저장한다.
 */
(function (root, factory) {
  const node = typeof module !== 'undefined' && module.exports;
  const mod = factory(node ? null : root);
  if (node) module.exports = mod;
  else root.REA_DIRECT = mod;
})(typeof self !== 'undefined' ? self : this, function (win) {
  const RTMS = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade';
  const RTMS_RENT = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent';
  const KAKAO = 'https://dapi.kakao.com';
  const CLEANUP = 'https://cleanup.seoul.go.kr/cleanup/bsnssttus/lsubBsnsSttus.do';
  const KEYS = { dataGoKr: 'rea-api-key', kakao: 'rea-kakao-key', vworld: 'rea-vworld-key' };

  // 서울 정비사업 정보몽땅 사업장 검색 결과 표 → 행 객체 (서버와 공용)
  function parseCleanupList(html) {
    const text = (x) => x.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
    const raw = [...String(html).matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => m[1]);
    const rows = raw.map((r) => [...r.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) => text(c[1])));
    const head = rows.find((r) => r.includes('사업장명') && r.includes('진행단계'));
    if (!head) throw new Error('정비사업 정보몽땅 응답 형식 오류');
    const out = [];
    rows.forEach((r, k) => {
      if (r === head || r.length !== head.length || !r[head.indexOf('사업장명')]) return;
      const o = Object.fromEntries(head.map((h, i) => [h, r[i]]));
      // 공식 출처 링크: 조합 공개 페이지(공지·자료)와 서울 도시계획 지도(정비구역)
      const cafe = raw[k].match(/cafeOpenPopup\('([^']+)'\)/), rec = raw[k].match(/mapOpenPopup\('([^']+)'\)/);
      o.cafe = cafe ? cafe[1] : ''; o.rec = rec ? rec[1] : '';
      out.push(o);
    });
    return out;
  }
  // 카카오 검색 결과 → 앱이 쓰는 모양 (서버와 공용)
  const kakaoPoint = (d) => (d ? { lat: Number(d.y), lng: Number(d.x), label: d.address_name || d.place_name } : null);
  const kakaoPick = (d) => (d ? { name: d.place_name, meters: Number(d.distance) || null } : null);

  const cleanupLinks = (row) => ({
    cafe: row.cafe ? `https://cleanup.seoul.go.kr/cafe/mainIndx.do?cafeUrl=${encodeURIComponent(row.cafe)}` : '',
    map: row.rec ? `https://urban.seoul.go.kr/view/map/mapPopup.html?recordCode=${encodeURIComponent(row.rec)}` : '',
    search: `https://cleanup.seoul.go.kr/cleanup/bsnssttus/lscrMainIndx.do`,
  });

  if (!win) return { parseCleanupList, kakaoPoint, kakaoPick, cleanupLinks };

  const store = {
    get: (k) => { try { return win.localStorage.getItem(KEYS[k]) || ''; } catch (_) { return ''; } },
    set: (k, v) => { try { if (v) win.localStorage.setItem(KEYS[k], v); else win.localStorage.removeItem(KEYS[k]); } catch (_) { /* 무시 */ } },
  };
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
  const fail = (status, msg, code) => json(status, { error: msg, code });

  async function kakao(path) {
    const key = store.get('kakao');
    if (!key) throw Object.assign(new Error('카카오 REST 키를 넣으면 조회합니다'), { status: 401, code: 'NOT_CONFIGURED' });
    const r = await fetch(KAKAO + path, { headers: { Authorization: 'KakaoAK ' + key } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(`카카오 오류: ${j.message || j.msg || r.status}`), { status: 502 });
    return j;
  }
  let redevSnap = null;

  const routes = {
    '/api/health': () => json(200, { ok: true, hasKey: !!store.get('dataGoKr'), live: false, direct: true }),
    '/api/sources': () => json(200, { sources: [
      { id: 'rtms', name: '국토부 아파트 매매·전월세 실거래가', configured: !!store.get('dataGoKr'), how: '공공데이터포털 인증키를 넣으세요', last: null },
      { id: 'nearby', name: '단지 좌표·주변 역·초등학교 (카카오 로컬)', configured: !!store.get('kakao'), how: '카카오 REST API 키를 넣으세요', last: null },
      { id: 'redevSeoul', name: '서울 정비사업 진행단계 (정비사업 정보몽땅)', configured: true, how: '키 없음', last: null },
      { id: 'landUse', name: '토지이용계획 (브이월드)', configured: !!store.get('vworld'), how: '브이월드 인증키를 넣으세요', last: null },
    ] }),
    async '/api/rtms'(q) { return rtms(RTMS, q); },
    async '/api/rtms-rent'(q) { return rtms(RTMS_RENT, q); },
    async '/api/geo'(q) {
      const s = String(q.get('q') || '').trim();
      if (s.length < 3) return fail(400, '주소나 단지명을 입력하세요');
      let hit = (await kakao(`/v2/local/search/address.json?size=1&query=${encodeURIComponent(s)}`)).documents[0];
      if (!hit) hit = (await kakao(`/v2/local/search/keyword.json?size=1&query=${encodeURIComponent(s)}`)).documents[0];
      const p = kakaoPoint(hit);
      if (!p || !isFinite(p.lat)) return fail(404, '위치를 찾지 못했습니다');
      return json(200, { ...p, fetchedAt: new Date().toISOString() });
    },
    async '/api/nearby'(q) {
      const lat = Number(q.get('lat')), lng = Number(q.get('lng'));
      if (!isFinite(lat) || !isFinite(lng)) return fail(400, '좌표가 필요합니다');
      const at = `x=${lng}&y=${lat}&sort=distance`;
      const st = (await kakao(`/v2/local/search/category.json?category_group_code=SW8&radius=3000&size=3&${at}`)).documents;
      const sc = (await kakao(`/v2/local/search/category.json?category_group_code=SC4&radius=2000&size=15&${at}`)).documents
        .filter((d) => /초등학교/.test(d.place_name || ''));
      return json(200, { station: kakaoPick(st[0]), school: kakaoPick(sc[0]), fetchedAt: new Date().toISOString() });
    },
    async '/api/redev'(q) {
      if (q.get('sido') !== '서울') return fail(400, '웹에서는 서울 정비사업만 조회합니다 (경기는 로컬 서버 필요)');
      const needle = String(q.get('q') || '').replace(/\s+/g, '');
      if (needle.length < 2) return fail(400, '서울 정비사업은 단지·구역 이름을 2글자 이상 넣어 검색하세요');
      // 정보몽땅은 CORS 헤더가 중복('*, *')돼 브라우저가 못 읽으므로, 6시간마다 받아둔 전체 목록에서 찾는다
      if (!redevSnap) {
        const r = await fetch('data/redev-seoul.json', { cache: 'no-store' });
        if (!r.ok) return fail(503, '서울 정비사업 목록을 아직 받지 못했습니다 (자동 조회 대기)');
        redevSnap = await r.json();
      }
      const COND = win.REA_COND;
      const items = redevSnap.rows.map((v) => Object.fromEntries(redevSnap.cols.map((c, i) => [c, v[i]])))
        .filter((row) => [row['사업장명'], row['대표지번'], row['자치구']].some((x) => String(x).replace(/\s+/g, '').includes(needle)))
        .slice(0, 50)
        .map((row) => {
          const t = COND.stageTimeline(row, row['진행단계']);
          return { sido: '서울', name: row['사업장명'], district: row['자치구'], kind: row['사업구분'], stage: row['진행단계'], address: [row['자치구'], row['대표지번']].filter(Boolean).join(' '), currentStage: t.current, currentStageDate: t.currentDate, timeline: t.steps, links: cleanupLinks(row) };
        });
      return json(200, { items, total: redevSnap.rows.length, fetchedAt: redevSnap.fetchedAt, source: '서울시 정비사업 정보몽땅 (6시간마다 자동 조회)' });
    },
    async '/api/landuse'(q) {
      const r = await win.REA_VWORLD.lookup(q.get('address'), store.get('vworld'), win.location.hostname);
      return json(200, r);
    },
  };

  async function rtms(base, q) {
    const lawd = q.get('lawd') || '', ym = q.get('ym') || '';
    const key = store.get('dataGoKr') || q.get('key') || '';
    if (!/^\d{5}$/.test(lawd) || !/^\d{6}$/.test(ym)) return new Response('lawd(5자리)와 ym(YYYYMM)이 필요합니다', { status: 400 });
    if (!key) return new Response('공공데이터포털 인증키가 없습니다', { status: 401 });
    const url = `${base}?serviceKey=${encodeURIComponent(key)}&LAWD_CD=${lawd}&DEAL_YMD=${ym}&numOfRows=1000&pageNo=1`;
    // 공공데이터포털은 가끔 오류 응답(허용 헤더 없음)을 줘서 브라우저에 CORS 실패로 보인다. 세 번까지 다시 시도.
    let last;
    for (let k = 0; k < 3; k++) {
      try {
        const r = await fetch(url);
        const text = await r.text();
        if (r.ok) return new Response(text, { status: 200, headers: { 'content-type': 'application/xml; charset=utf-8' } });
        last = new Error(`HTTP ${r.status}`);
      } catch (err) { last = err; }
      await new Promise((res) => setTimeout(res, 700 * (k + 1)));
    }
    return new Response(`공공데이터포털 조회 실패: ${last && last.message}`, { status: 502 });
  }

  // 로컬 서버와 같은 경로를 받아 브라우저에서 처리한다
  async function directFetch(pathQs) {
    const u = new URL(pathQs, 'https://local.invalid/');
    const route = routes[u.pathname];
    if (!route) return fail(404, '웹에서는 지원하지 않는 조회입니다 (로컬 서버 필요)');
    try { return await route(u.searchParams); } catch (err) { return fail(err.status || 502, err.message, err.code); }
  }

  return { fetch: directFetch, keys: store, parseCleanupList, kakaoPoint, kakaoPick, cleanupLinks };
});
