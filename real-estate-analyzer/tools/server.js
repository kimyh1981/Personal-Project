// 로컬 서버: 정적 파일 제공 + 국토부 아파트 매매 실거래가 API 프록시
// 사용: DATA_GO_KR_KEY=<공공데이터포털 일반 인증키(Decoding)> node tools/server.js
//      (키는 화면에서 입력해도 됩니다) → http://localhost:8080
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, hasKey: !!process.env.DATA_GO_KR_KEY }));
  }
  if (url.pathname === '/api/rtms') {
    const lawd = url.searchParams.get('lawd') || '';
    const ym = url.searchParams.get('ym') || '';
    const key = process.env.DATA_GO_KR_KEY || url.searchParams.get('key') || '';
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
      res.writeHead(r.status, { 'content-type': 'application/xml; charset=utf-8' });
      return res.end(r.body);
    } catch (err) {
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
  server.listen(PORT, () => console.log(`실거주 매수 판단기: http://localhost:${PORT}${process.env.DATA_GO_KR_KEY ? '' : '  (인증키는 화면에서 입력)'}`));
}
module.exports = server;
