// 최신 공공데이터 조회: 필지 토지이용계획(토지거래허가·정비구역), 정비사업 추진단계,
// 규제 고시·법령 변경 감지. 모든 결과에 조회 시각과 출처를 붙이고, 캐시는 짧게만 쓴다.
//
// 인증키·주소는 환경변수 또는 config.local.json(깃에 올리지 않음)으로 준다. config.example.json 참고.
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const P = require('../js/policy.js');
const COND = require('../js/conditions.js');

const HOUR = 3600e3;

// ── 설정 ────────────────────────────────────────────────────────────────
function loadConfig() {
  let file = {};
  try { file = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.local.json'), 'utf8')); } catch (_) { /* 선택 사항 */ }
  const env = process.env;
  const pick = (k, envKey, def) => file[k] ?? env[envKey] ?? def;
  const cfg = {
    dataGoKrKey: pick('dataGoKrKey', 'DATA_GO_KR_KEY', ''),
    vworldKey: pick('vworldKey', 'VWORLD_KEY', ''),
    vworldDomain: pick('vworldDomain', 'VWORLD_DOMAIN', 'localhost'),
    seoulKey: pick('seoulKey', 'SEOUL_OPEN_API_KEY', ''),
    // 서울 열린데이터광장 OA-2253 '서울시 재개발 재건축 정비사업 현황' 상세 페이지의 샘플 URL에 있는 서비스명
    seoulRedevService: pick('seoulRedevService', 'SEOUL_REDEV_SERVICE', ''),
    ggKey: pick('ggKey', 'GG_OPEN_API_KEY', ''),
    // 경기데이터드림 '일반 정비 사업 추진 현황' Open API 서비스명
    ggRedevService: pick('ggRedevService', 'GG_REDEV_SERVICE', ''),
    lawOc: pick('lawOc', 'LAW_OC', ''),
    kakaoKey: pick('kakaoKey', 'KAKAO_REST_KEY', ''), // 카카오 로컬 REST API 키 (좌표·주변 역·학교) // 법제처 국가법령정보 공동활용 OC(가입 이메일 ID)
    newsFeeds: [].concat(pick('newsFeeds', 'NEWS_FEEDS', null) || []).flatMap((x) => String(x).split(',')).map((x) => x.trim()).filter(Boolean),
    _defaultFeeds: [
      'https://www.molit.go.kr/USR/NEWS/m_71/rss.jsp',
      'https://www.korea.kr/rss/policy.xml',
    ],
    ttl: { landUse: HOUR, redev: 6 * HOUR, regulation: HOUR, ...(file.ttl || {}) },
  };
  if (!cfg.newsFeeds.length) cfg.newsFeeds = cfg._defaultFeeds;
  return cfg;
}

// ── HTTP ────────────────────────────────────────────────────────────────
function defaultFetch(url, headers) {
  const lib = url.startsWith('https:') ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.get(url, { timeout: 15000, headers: { 'user-agent': 'real-estate-analyzer/1.0', ...(headers || {}) } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('응답 시간 초과')));
  });
}
let fetcher = defaultFetch;
const setFetcher = (f) => { fetcher = f || defaultFetch; };
async function getText(url) {
  const r = await fetcher(url);
  if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
  return r.body;
}
async function getJson(url, headers) {
  const r = await fetcher(url, headers);
  if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
  const body = r.body;
  try { return JSON.parse(body); } catch (_) { throw new Error('JSON이 아닌 응답: ' + body.slice(0, 120)); }
}

// ── 캐시 (짧은 TTL, fresh=1이면 무시) ──────────────────────────────────
const cache = new Map();
const status = new Map(); // 출처별 마지막 성공·실패
async function cached(key, ttl, fresh, fn) {
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < ttl) return { ...hit.value, cached: true };
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}
const clearCache = () => { cache.clear(); status.clear(); };
function track(source, ok, detail) {
  status.set(source, { ok, at: new Date().toISOString(), detail: detail || '' });
}

class NotConfigured extends Error {
  constructor(what) { super(`${what}이(가) 설정되지 않았습니다`); this.code = 'NOT_CONFIGURED'; }
}

// ── 1. 필지 토지이용계획 (브이월드) ────────────────────────────────────
const asArray = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);

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

async function landUse(cfg, address, fresh) {
  if (!cfg.vworldKey) throw new NotConfigured('브이월드 인증키(VWORLD_KEY)');
  const q = String(address || '').trim();
  if (q.length < 4) throw new Error('지번 주소를 입력하세요 (예: 서울 마포구 아현동 777)');
  return cached('landuse:' + q, cfg.ttl.landUse, fresh, async () => {
    try {
      const key = encodeURIComponent(cfg.vworldKey);
      const s = await getJson(`https://api.vworld.kr/req/search?service=search&request=search&version=2.0&size=5&type=address&category=parcel&format=json&query=${encodeURIComponent(q)}&key=${key}`);
      const hits = parseVworldSearch(s);
      if (!hits.length) throw new Error('주소를 찾지 못했습니다. 지번 주소로 입력하세요');
      const u = await getJson(`https://api.vworld.kr/ned/data/getLandUseAttr?pnu=${hits[0].pnu}&format=json&numOfRows=100&pageNo=1&key=${key}&domain=${encodeURIComponent(cfg.vworldDomain)}`);
      const out = { ...parseLandUse(u), pnu: hits[0].pnu, address: hits[0].address, fetchedAt: new Date().toISOString(), source: '국토교통부 토지이용계획 (브이월드)' };
      track('landUse', true);
      return out;
    } catch (err) { track('landUse', false, err.message); throw err; }
  });
}

// ── 2. 정비사업 추진현황 (서울 열린데이터광장 · 경기데이터드림) ──────────
// 열 이름이 데이터셋마다 달라 한글·영문 후보로 찾는다
const FIELD_HINTS = {
  name: [/구역명|사업장명|정비구역명|사업명|단지명|ZONE_?NM|BSNS_?NM|CAFE_?NM/i],
  district: [/자치구|시군|구명|SIGUN|GU_?NM|SGG/i],
  kind: [/사업구분|정비유형|사업유형|사업종류|BSNS_?SE|TYPE/i],
  stage: [/추진단계|진행단계|사업단계|단계|STEP|STAGE|PROGRS/i],
  address: [/위치|소재지|주소|대표지번|LOCATION|ADDR|LOC/i],
  updated: [/기준일|수정일|변경일|데이터기준|UPDT|MODF|REG_?DT/i],
};
function pickField(row, hints) {
  const keys = Object.keys(row);
  for (const re of hints) {
    const k = keys.find((x) => re.test(x));
    if (k && row[k] != null && String(row[k]).trim() !== '') return String(row[k]).trim();
  }
  return '';
}
function normalizeRedevRow(row, sido) {
  const o = {};
  for (const [k, hints] of Object.entries(FIELD_HINTS)) o[k] = pickField(row, hints);
  // 날짜 열이 단계 문구로 오인되지 않게, 단계 문구는 날짜가 아닌 값만 쓴다
  if (COND.parseDate(o.stage)) o.stage = '';
  const timeline = COND.stageTimeline(row, o.stage);
  return { sido, ...o, currentStage: timeline.current, currentStageDate: timeline.currentDate, timeline: timeline.steps, raw: row };
}
function parseSeoulRows(json, service) {
  const s = json && json[service];
  if (!s) {
    const r = json && (json.RESULT || (json[Object.keys(json)[0]] || {}).RESULT);
    throw new Error(`서울 열린데이터광장 오류: ${(r && (r.MESSAGE || r.CODE)) || '응답 형식 오류'}`);
  }
  if (s.RESULT && s.RESULT.CODE && !/INFO-000/.test(s.RESULT.CODE)) throw new Error(`서울 열린데이터광장 ${s.RESULT.CODE}: ${s.RESULT.MESSAGE}`);
  return { total: Number(s.list_total_count) || 0, rows: asArray(s.row) };
}
function parseGgRows(json, service) {
  const s = json && json[service];
  if (!s) {
    const r = json && json.RESULT;
    throw new Error(`경기데이터드림 오류: ${(r && (r.MESSAGE || r.CODE)) || '응답 형식 오류'}`);
  }
  const head = asArray(s[0] && s[0].head);
  const total = Number((head.find((h) => h.list_total_count) || {}).list_total_count) || 0;
  const result = (head.find((h) => h.RESULT) || {}).RESULT;
  if (result && result.CODE && !/INFO-000/.test(result.CODE)) throw new Error(`경기데이터드림 ${result.CODE}: ${result.MESSAGE}`);
  return { total, rows: asArray(s[1] && s[1].row) };
}

async function fetchAllSeoul(cfg) {
  const out = [];
  for (let start = 1; start < 100000; start += 1000) {
    const j = await getJson(`http://openapi.seoul.go.kr:8088/${encodeURIComponent(cfg.seoulKey)}/json/${encodeURIComponent(cfg.seoulRedevService)}/${start}/${start + 999}/`);
    const { total, rows } = parseSeoulRows(j, cfg.seoulRedevService);
    out.push(...rows);
    if (out.length >= total || !rows.length) break;
  }
  return out;
}
async function fetchAllGg(cfg) {
  const out = [];
  for (let page = 1; page < 100; page++) {
    const j = await getJson(`https://openapi.gg.go.kr/${encodeURIComponent(cfg.ggRedevService)}?KEY=${encodeURIComponent(cfg.ggKey)}&Type=json&pIndex=${page}&pSize=1000`);
    const { total, rows } = parseGgRows(j, cfg.ggRedevService);
    out.push(...rows);
    if (out.length >= total || !rows.length) break;
  }
  return out;
}

async function redevList(cfg, sido, fresh) {
  if (sido === '서울') {
    if (!cfg.seoulKey || !cfg.seoulRedevService) throw new NotConfigured('서울 열린데이터광장 인증키·서비스명(SEOUL_OPEN_API_KEY, SEOUL_REDEV_SERVICE)');
  } else if (sido === '경기') {
    if (!cfg.ggKey || !cfg.ggRedevService) throw new NotConfigured('경기데이터드림 인증키·서비스명(GG_OPEN_API_KEY, GG_REDEV_SERVICE)');
  } else throw new Error('정비사업 조회는 서울·경기만 지원합니다');
  return cached('redev:' + sido, cfg.ttl.redev, fresh, async () => {
    const source = sido === '서울' ? 'redevSeoul' : 'redevGyeonggi';
    try {
      const rows = sido === '서울' ? await fetchAllSeoul(cfg) : await fetchAllGg(cfg);
      track(source, true, `${rows.length}건`);
      return { items: rows.map((r) => normalizeRedevRow(r, sido)), fetchedAt: new Date().toISOString(), source: sido === '서울' ? '서울 열린데이터광장 정비사업 현황' : '경기데이터드림 정비사업 추진현황' };
    } catch (err) { track(source, false, err.message); throw err; }
  });
}
async function redevSearch(cfg, sido, q, fresh) {
  const all = await redevList(cfg, sido, fresh);
  const needle = String(q || '').replace(/\s+/g, '');
  const items = all.items.filter((it) => !needle || [it.name, it.address, it.district].some((v) => v.replace(/\s+/g, '').includes(needle)));
  return { ...all, total: all.items.length, items: items.slice(0, 50) };
}

// ── 3. 규제 고시·법령 변경 감지 ─────────────────────────────────────────
const REG_KEYWORDS = /조정대상지역|투기과열지구|토지거래허가|규제지역|주택담보대출|LTV|DSR|전입의무|취득세|양도소득세|종합부동산세|재건축|정비사업|주택시장\s*안정/;
const LAWS = ['지방세법', '소득세법', '종합부동산세법', '주택법', '부동산 거래신고 등에 관한 법률', '도시 및 주거환경정비법', '재건축초과이익 환수에 관한 법률'];

function parseRss(xml) {
  const tag = (s, n) => {
    const m = s.match(new RegExp(`<${n}[^>]*>([\\s\\S]*?)</${n}>`));
    return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').trim() : '';
  };
  return xml.split(/<item[\s>]/).slice(1).map((chunk) => {
    const s = chunk.split('</item>')[0];
    const date = tag(s, 'pubDate') || tag(s, 'dc:date');
    const t = Date.parse(date);
    return { title: tag(s, 'title'), link: tag(s, 'link'), date: isFinite(t) ? new Date(t).toISOString() : null };
  }).filter((x) => x.title);
}

function parseLawSearch(json) {
  const root = json && (json.LawSearch || json.lawSearch);
  if (!root) throw new Error('법제처 응답 형식 오류');
  return asArray(root.law).map((l) => ({
    name: l['법령명한글'] || l.lawNm || '',
    enforced: l['시행일자'] || '',
    promulgated: l['공포일자'] || '',
  }));
}
const ymdToIso = (s) => (/^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null);

/**
 * 기준일(policy.asOf) 이후 규제 관련 보도자료와 시행된 법령 개정을 찾는다.
 * ok=true는 '모든 출처를 확인했고 변경이 없다'는 뜻. 하나라도 확인 못 하면 ok=false.
 */
async function regulationCheck(cfg, fresh, asOf = P.asOf) {
  return cached('regulation:' + asOf, cfg.ttl.regulation, fresh, async () => {
    const since = Date.parse(asOf + 'T00:00:00+09:00');
    const today = new Date().toISOString().slice(0, 10);
    const changes = [], errors = [], checked = [];
    for (const feed of cfg.newsFeeds) {
      try {
        const items = parseRss(await getText(feed));
        checked.push(feed);
        for (const it of items) {
          if (it.date && Date.parse(it.date) >= since && REG_KEYWORDS.test(it.title)) changes.push({ kind: '보도·고시', title: it.title, date: it.date.slice(0, 10), link: it.link });
        }
      } catch (err) { errors.push(`${feed}: ${err.message}`); }
    }
    if (cfg.lawOc) {
      for (const name of LAWS) {
        try {
          const list = parseLawSearch(await getJson(`https://www.law.go.kr/DRF/lawSearch.do?OC=${encodeURIComponent(cfg.lawOc)}&target=law&type=JSON&display=5&query=${encodeURIComponent(name)}`));
          checked.push('법제처:' + name);
          const hit = list.find((l) => l.name === name) || list[0];
          const eff = hit && ymdToIso(hit.enforced);
          if (eff && eff > asOf && eff <= today) changes.push({ kind: '법령 시행', title: `${hit.name} 개정 시행`, date: eff, link: 'https://www.law.go.kr/법령/' + encodeURIComponent(hit.name) });
          else if (eff && eff > today) changes.push({ kind: '법령 시행 예정', title: `${hit.name} 개정 (시행 예정)`, date: eff, link: 'https://www.law.go.kr/법령/' + encodeURIComponent(hit.name), upcoming: true });
        } catch (err) { errors.push(`법제처 ${name}: ${err.message}`); }
      }
    } else errors.push('법제처 OC(LAW_OC) 미설정 — 법령 시행일 확인 생략');
    const ok = errors.length === 0;
    track('regulation', ok, ok ? '' : errors.join(' / '));
    changes.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return { asOf, checkedAt: new Date().toISOString(), ok, checked, changes, errors };
  });
}

// ── 4. 단지 좌표와 주변 역·초등학교 (카카오 로컬) ────────────────────────
const kakao = (cfg, pathQs) => getJson(`https://dapi.kakao.com${pathQs}`, { Authorization: `KakaoAK ${cfg.kakaoKey}` });

/** 주소·단지명 → 좌표. 카카오 키가 없으면 브이월드 주소검색 좌표 */
async function geocode(cfg, query, fresh) {
  const q = String(query || '').trim();
  if (q.length < 3) throw new Error('주소나 단지명을 입력하세요');
  if (!cfg.kakaoKey && !cfg.vworldKey) throw new NotConfigured('카카오 REST 키(KAKAO_REST_KEY) 또는 브이월드 키(VWORLD_KEY)');
  return cached('geo:' + q, 7 * 24 * HOUR, fresh, async () => {
    try {
      let hit = null;
      if (cfg.kakaoKey) {
        const a = await kakao(cfg, `/v2/local/search/address.json?size=1&query=${encodeURIComponent(q)}`);
        hit = asArray(a.documents)[0];
        if (!hit) hit = asArray((await kakao(cfg, `/v2/local/search/keyword.json?size=1&query=${encodeURIComponent(q)}`)).documents)[0];
        if (hit) hit = { lat: Number(hit.y), lng: Number(hit.x), label: hit.address_name || hit.place_name };
      } else {
        const s = await getJson(`https://api.vworld.kr/req/search?service=search&request=search&version=2.0&size=1&type=address&category=parcel&format=json&query=${encodeURIComponent(q)}&key=${encodeURIComponent(cfg.vworldKey)}`);
        const it = asArray(s.response && s.response.result && s.response.result.items)[0];
        if (it && it.point) hit = { lat: Number(it.point.y), lng: Number(it.point.x), label: (it.address && it.address.parcel) || q };
      }
      if (!hit || !isFinite(hit.lat)) throw new Error('위치를 찾지 못했습니다');
      track('geo', true);
      return { ...hit, fetchedAt: new Date().toISOString() };
    } catch (err) { track('geo', false, err.message); throw err; }
  });
}

/** 좌표 주변 가장 가까운 지하철역(SW8)·초등학교(SC4) */
async function nearby(cfg, lat, lng, fresh) {
  if (!cfg.kakaoKey) throw new NotConfigured('카카오 REST 키(KAKAO_REST_KEY)');
  if (!isFinite(lat) || !isFinite(lng)) throw new Error('좌표가 필요합니다');
  const key = `near:${lat.toFixed(4)},${lng.toFixed(4)}`;
  return cached(key, 30 * 24 * HOUR, fresh, async () => {
    try {
      const at = `x=${lng}&y=${lat}&sort=distance`;
      const st = asArray((await kakao(cfg, `/v2/local/search/category.json?category_group_code=SW8&radius=3000&size=3&${at}`)).documents);
      const sc = asArray((await kakao(cfg, `/v2/local/search/category.json?category_group_code=SC4&radius=2000&size=15&${at}`)).documents)
        .filter((d) => /초등학교/.test(d.place_name || ''));
      const pick = (d) => (d ? { name: d.place_name, meters: Number(d.distance) || null } : null);
      track('nearby', true);
      return { station: pick(st[0]), school: pick(sc[0]), fetchedAt: new Date().toISOString() };
    } catch (err) { track('nearby', false, err.message); throw err; }
  });
}

// 출처별 설정·최근 상태
function sourcesStatus(cfg) {
  const s = (id) => status.get(id) || null;
  return [
    { id: 'rtms', name: '국토부 아파트 매매 실거래가', configured: !!cfg.dataGoKrKey, how: 'data.go.kr 인증키 (DATA_GO_KR_KEY, 화면 입력 가능)', last: s('rtms') },
    { id: 'landUse', name: '토지이용계획 (토지거래허가·정비구역, 브이월드)', configured: !!cfg.vworldKey, how: 'vworld.kr 인증키 (VWORLD_KEY)', last: s('landUse') },
    { id: 'redevSeoul', name: '서울 정비사업 현황 (열린데이터광장 OA-2253)', configured: !!(cfg.seoulKey && cfg.seoulRedevService), how: 'SEOUL_OPEN_API_KEY + SEOUL_REDEV_SERVICE', last: s('redevSeoul') },
    { id: 'redevGyeonggi', name: '경기 정비사업 추진현황 (경기데이터드림)', configured: !!(cfg.ggKey && cfg.ggRedevService), how: 'GG_OPEN_API_KEY + GG_REDEV_SERVICE', last: s('redevGyeonggi') },
    { id: 'nearby', name: '단지 좌표·주변 역·초등학교 (카카오 로컬)', configured: !!cfg.kakaoKey, how: 'developers.kakao.com REST API 키 (KAKAO_REST_KEY)', last: s('nearby') || s('geo') },
    { id: 'regulation', name: '규제 고시·법령 변경 감지 (국토부·정책브리핑 RSS, 법제처)', configured: true, how: 'RSS는 키 없음, 법령은 LAW_OC', last: s('regulation') },
  ];
}

module.exports = {
  loadConfig, setFetcher, clearCache, track, NotConfigured,
  landUse, redevSearch, regulationCheck, geocode, nearby, sourcesStatus,
  parseVworldSearch, parseLandUse, classifyZones, parseSeoulRows, parseGgRows, normalizeRedevRow, parseRss, parseLawSearch,
};
