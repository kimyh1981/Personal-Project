// 로컬 서버: 정적 파일 제공 + 최신 공공데이터 프록시
//   /api/rtms        국토부 아파트 매매 실거래가
//   /api/landuse     필지 토지이용계획 (토지거래허가·정비구역)
//   /api/redev       서울·경기 정비사업 추진단계
//   /api/regulation  기준일 이후 규제 고시·법령 변경 감지
//   /api/sources     출처별 설정·최근 조회 상태
// 인증키는 환경변수나 config.local.json으로 준다 (config.example.json 참고) → http://localhost:8080
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const live = require('./live-data.js');

const root = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 8080;
const API = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.csv': 'text/csv; charset=utf-8' };

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 15000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject).on('timeout', function () { this.destroy(new Error('시간 초과')); });
  });
}

function sendJson(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}
async function liveRoute(res, fn) {
  try {
    sendJson(res, 200, await fn());
  } catch (err) {
    sendJson(res, err.code === 'NOT_CONFIGURED' ? 412 : 502, { error: err.message, code: err.code || 'UPSTREAM' });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const cfg = live.loadConfig();
  const fresh = url.searchParams.get('fresh') === '1';
  if (url.pathname === '/api/health') return sendJson(res, 200, { ok: true, hasKey: !!cfg.dataGoKrKey, live: true });
  if (url.pathname === '/api/sources') return sendJson(res, 200, { sources: live.sourcesStatus(cfg) });
  if (url.pathname === '/api/landuse') return liveRoute(res, () => live.landUse(cfg, url.searchParams.get('address'), fresh));
  if (url.pathname === '/api/redev') return liveRoute(res, () => live.redevSearch(cfg, url.searchParams.get('sido'), url.searchParams.get('q'), fresh));
  if (url.pathname === '/api/regulation') return liveRoute(res, () => live.regulationCheck(cfg, fresh));
  if (url.pathname === '/api/rtms') {
    const lawd = url.searchParams.get('lawd') || '';
    const ym = url.searchParams.get('ym') || '';
    const key = cfg.dataGoKrKey || url.searchParams.get('key') || '';
    if (!/^\d{5}$/.test(lawd) || !/^\d{6}$/.test(ym)) {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('lawd(5자리)와 ym(YYYYMM)이 필요합니다');
    }
    if (!key) {
      res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('공공데이터포털 인증키가 없습니다');
    }
    const q = `${API}?serviceKey=${encodeURIComponent(key)}&LAWD_CD=${lawd}&DEAL_YMD=${ym}&numOfRows=1000&pageNo=1`;
    try {
      const r = await fetchText(q);
      live.track('rtms', r.status < 400, r.status < 400 ? '' : 'HTTP ' + r.status);
      res.writeHead(r.status, { 'content-type': 'application/xml; charset=utf-8' });
      return res.end(r.body);
    } catch (err) {
      live.track('rtms', false, err.message);
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('국토부 API 호출 실패: ' + err.message);
    }
  }
  const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const file = path.normalize(path.join(root, rel));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`실거주 매수 판단기: http://localhost:${PORT}`);
    for (const s of live.sourcesStatus(live.loadConfig())) console.log(`  ${s.configured ? '✓' : '·'} ${s.name}${s.configured ? '' : `  — 설정 필요: ${s.how}`}`);
  });
}
module.exports = server;
