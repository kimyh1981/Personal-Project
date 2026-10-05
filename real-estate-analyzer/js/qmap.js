/*
 * '내 조건으로 찾기' 지도 보기: 목록의 단지를 서울 지도(고른 구)에 점수 표시로 찍는다.
 * 확대하면 점마다 판정 점수가 보이고, 누르면 단지 이름·가격과 '판정 보기'가 뜬다 → 그 단지 판정으로 이동.
 * 좌표: 내 맞춤 추천·판정에서 확인한 값(rea-my-geo) → 지도용으로 찾은 값(rea-map-geo) → 카카오 키가 있으면 주소로 찾기
 *       → 없으면 구 중심 근처에 대략 표시 (그때는 '대략 위치'라고 알린다).
 * 지도는 Leaflet(vendor/leaflet, BSD-2) + OpenStreetMap 타일. 처음 열 때만 불러온다.
 */
(function () {
  const GEO = window.REA_GEO, E = window.REA;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const MAP_KEY = 'rea-map-geo';
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch (_) { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* 무시 */ } };
  const LABEL_ZOOM = 14; // 이 배율부터 점 대신 점수 표시

  let leaflet = null;
  function loadLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (leaflet) return leaflet;
    leaflet = new Promise((res, rej) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet'; css.href = 'vendor/leaflet/leaflet.css';
      document.head.appendChild(css);
      const s = document.createElement('script');
      s.src = 'vendor/leaflet/leaflet.js';
      s.onload = () => res(window.L);
      s.onerror = () => { leaflet = null; rej(new Error('지도를 불러오지 못했습니다')); };
      document.head.appendChild(s);
    });
    return leaflet;
  }

  // 단지 좌표 [위도, 경도, 정확한가]. 이미 아는 값만 (조회 없이)
  function known(c) {
    const a = load('rea-my-geo', {})[c.id];
    if (a && a.coords) return [a.coords[0], a.coords[1], true];
    const b = load(MAP_KEY, {})[c.id];
    return b ? [b[0], b[1], true] : null;
  }
  // 구 중심 근처 대략 위치 (단지마다 다르게, 같은 단지는 늘 같은 자리)
  function rough(c) {
    const [lat, lng] = GEO.CENTROIDS[c.regionId] || [37.5665, 126.978];
    let h = 0;
    for (const ch of c.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const a = (h % 360) * Math.PI / 180, r = 0.004 + ((h >>> 9) % 100) / 100 * 0.014;
    return [lat + r * Math.sin(a), lng + r * Math.cos(a) * 1.25, false];
  }
  // 카카오 키가 있으면 모르는 좌표를 찾아 저장 (동시 4개). onEach: 하나 찾을 때마다
  async function locate(cs, onEach) {
    const D = window.REA_DIRECT;
    if (!D || !D.keys.get('kakao')) return false;
    const queue = cs.filter((c) => !known(c)), cache = load(MAP_KEY, {});
    const worker = async () => {
      while (queue.length) {
        const c = queue.shift();
        const name = E.region(c.regionId).name.replace(/^서울 /, '서울특별시 ');
        // 빌라·아파트는 지번 주소, 단독주택은 지번이 가려져 있어 동까지
        const q = c.kind === '단독주택' || !c.jibun ? `${name} ${c.dong}` : `${name} ${c.dong} ${c.jibun}`;
        try {
          const g = await (await D.fetch('/api/geo?q=' + encodeURIComponent(q))).json();
          if (g && isFinite(g.lat)) { cache[c.id] = [g.lat, g.lng]; onEach(c, [g.lat, g.lng, true]); }
        } catch (_) { /* 이 단지는 대략 위치로 */ }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    save(MAP_KEY, cache);
    return true;
  }

  let map = null, layer = null, markers = new Map(), current = null;
  function ensureDom() {
    if ($('qmap')) return;
    document.body.insertAdjacentHTML('beforeend', `<div class="qmap" id="qmap" hidden role="dialog" aria-modal="true" aria-label="지도 보기">
      <div class="qmap-head"><div><b id="qmapTitle">지도</b><span class="muted" id="qmapNote"></span></div><button type="button" class="ghost" id="qmapClose">닫기</button></div>
      <div class="qmap-map" id="qmapMap"></div>
    </div>`);
    $('qmapClose').addEventListener('click', close);
    $('qmap').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-qmap-go]');
      if (!b || !current) return;
      const id = b.dataset.qmapGo;
      close();
      current.onPick(id);
    });
  }
  function close() {
    const el = $('qmap');
    if (el) el.hidden = true;
    document.documentElement.classList.remove('qmap-open');
  }
  const icon = (L, it) => L.divIcon({
    className: 'qm-icon',
    html: `<span class="qm-pin" data-tone="${esc(it.tone || 'warning')}"${it.ban ? ' data-ban="1"' : ''}><b>${it.score != null ? it.score : '·'}</b></span>`,
    iconSize: null,
  });
  function popup(it) {
    const c = it.e.c;
    return `<div class="qm-pop"><b>${esc(c.name)}</b><span class="muted">${esc(c.dong)} · 전용 ${c.area}㎡${c.kind && c.kind !== '아파트' ? ` · ${esc(c.kind)}` : ''}</span>
      <span>${esc(it.price)}${it.score != null ? ` · 판정 <b>${it.score}</b>점 ${esc(it.label || '')}` : ''}</span>
      ${it.tier ? `<span class="chip good">${esc(it.tier)}</span>` : ''}${it.ban ? '<span class="chip critical">불가 · 토지거래허가 입주 조건</span>' : ''}
      ${it.rough ? '<span class="muted">대략 위치 (구 중심 근처)</span>' : ''}
      <button type="button" class="primary" data-qmap-go="${esc(c.id)}">판정 보기 ›</button></div>`;
  }

  // items: [{ e, score, tone, label, price, tier, ban }], onPick(id), title
  async function open({ items, onPick, title }) {
    ensureDom();
    current = { onPick };
    $('qmap').hidden = false;
    document.documentElement.classList.add('qmap-open');
    $('qmapTitle').textContent = title || `지도 · ${items.length}곳`;
    $('qmapNote').textContent = ' 불러오는 중…';
    let L;
    try { L = await loadLeaflet(); } catch (err) { $('qmapNote').textContent = ' ' + err.message; return; }
    if (!map) {
      map = L.map('qmapMap', { zoomControl: true, attributionControl: true }).setView([37.5665, 126.978], 11);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
      const sync = () => $('qmapMap').classList.toggle('qm-labels', map.getZoom() >= LABEL_ZOOM);
      map.on('zoomend', sync); sync();
    }
    setTimeout(() => map.invalidateSize(), 0);
    if (layer) layer.remove();
    layer = L.layerGroup().addTo(map);
    markers = new Map();
    let roughN = 0;
    const pts = [];
    for (const it of items) {
      const k = known(it.e.c) || rough(it.e.c);
      it.rough = !k[2];
      if (it.rough) roughN++;
      const m = L.marker([k[0], k[1]], { icon: icon(L, it), riseOnHover: true, title: it.e.c.name }).bindPopup(popup(it), { maxWidth: 260 });
      m.addTo(layer);
      markers.set(it.e.c.id, { m, it });
      pts.push([k[0], k[1]]);
    }
    if (pts.length) map.fitBounds(pts, { padding: [36, 36], maxZoom: 15 });
    const note = () => { $('qmapNote').textContent = roughN ? ` · ${roughN}곳은 대략 위치${window.REA_DIRECT && window.REA_DIRECT.keys.get('kakao') ? ' (찾는 중)' : ' (카카오 키를 넣으면 정확한 위치)'}` : ' · 확대하면 점수가 보이고, 누르면 판정으로'; };
    note();
    // 모르는 좌표는 찾는 대로 옮긴다
    const has = await locate(items.map((x) => x.e.c), (c, k) => {
      const x = markers.get(c.id);
      if (!x || !x.it.rough) return;
      x.it.rough = false; roughN--;
      x.m.setLatLng([k[0], k[1]]).setPopupContent(popup(x.it));
    });
    if (has) $('qmapNote').textContent = roughN ? ` · ${roughN}곳은 주소로 찾지 못해 대략 위치` : ' · 확대하면 점수가 보이고, 누르면 판정으로';
  }

  window.REA_QMAP = { open, close, known };
})();
