#!/usr/bin/env node
/*
 * 서울 주택 시장 스냅샷 (웹 버전 '내 맞춤 추천'용, 매주 갱신). 아파트 + (활용신청돼 있으면) 연립·다세대(빌라)·오피스텔.
 * 개인정보는 들어가지 않는다. 서울 25개 구의 국토부 실거래가로 단지·평형별 후보와 장기 상승률을 만든다.
 *   - 최근 6개월 매매·전월세 → 후보(중위가·전세 중위·거래 건수·준공연도)
 *   - 5년 전·10년 전 같은 시기 3개월 매매 → 단지별·구별 ㎡당 연평균 상승률(CAGR)
 * 사용: DATA_GO_KR_KEY=... node tools/market.js <출력 폴더>
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const P = require('../js/policy.js');
const E = require('../js/engine.js');
const RECO = require('../js/recommend.js');

const API = 'https://apis.data.go.kr/1613000/';
// 주택 종류별 실거래 API. 빌라·오피스텔은 공공데이터포털에서 따로 활용신청해야 하고, 없으면 건너뛴다.
// 응답의 단지명 태그만 다르다(mhouseNm·offiNm) → 아파트 파서가 읽는 aptNm으로 바꿔 같은 파서를 쓴다.
const KINDS = [
  { kind: '아파트', trade: API + 'RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade', rent: API + 'RTMSDataSvcAptRent/getRTMSDataSvcAptRent', history: true },
  { kind: '빌라', trade: API + 'RTMSDataSvcRHTrade/getRTMSDataSvcRHTrade', rent: API + 'RTMSDataSvcRHRent/getRTMSDataSvcRHRent', name: 'mhouseNm', history: false },
  { kind: '오피스텔', trade: API + 'RTMSDataSvcOffiTrade/getRTMSDataSvcOffiTrade', rent: API + 'RTMSDataSvcOffiRent/getRTMSDataSvcOffiRent', name: 'offiNm', history: false },
];
const asApt = (tagName) => (body) => (tagName ? body.replace(new RegExp(`<(/?)${tagName}>`, 'g'), '<$1aptNm>') : body);

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 20000, headers: { 'user-agent': 'Mozilla/5.0 (real-estate-analyzer)' } }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('응답 시간 초과')));
  });
}
async function withRetry(fn, n = 4) {
  let last;
  for (let k = 0; k < n; k++) {
    try { return await fn(); } catch (err) { last = err; if (err.noRetry) break; await new Promise((r) => setTimeout(r, 800 * (k + 1))); }
  }
  throw last;
}
// 한 구·한 달의 전체 거래 (1000건씩 쪽 넘김)
async function month(base, key, lawd, ym, parse) {
  const all = [];
  for (let page = 1; page <= 10; page++) {
    const r = await withRetry(async () => {
      const x = await get(`${base}?serviceKey=${encodeURIComponent(key)}&LAWD_CD=${lawd}&DEAL_YMD=${ym}&numOfRows=1000&pageNo=${page}`);
      if (/SERVICE_KEY_IS_NOT_REGISTERED/.test(x.body)) throw Object.assign(new Error('활용신청 필요'), { unregistered: true, noRetry: true });
      if (x.status >= 400 || !/<response>/.test(x.body)) throw new Error(`HTTP ${x.status} ${x.body.slice(0, 80)}`);
      return parse(x.body);
    });
    all.push(...r.items);
    if (all.length >= r.totalCount || r.items.length < 1000) break;
  }
  return all;
}
const ymOf = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
function monthsBack(from, n, count) {
  const out = [];
  for (let k = 0; k < count; k++) out.push(ymOf(new Date(from.getFullYear(), from.getMonth() - n - k, 1)));
  return out;
}
const median = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };
const cagr = (now, old, years) => (now && old && old > 0 ? Math.pow(now / old, 1 / years) - 1 : null);

async function pool(jobs, size) {
  const out = new Array(jobs.length);
  let i = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (i < jobs.length) { const k = i++; out[k] = await jobs[k](); }
  }));
  return out;
}

async function build(key, now = new Date()) {
  const regions = P.REGIONS.filter((r) => r.id.startsWith('seoul-') && r.lawd);
  const recent = monthsBack(now, 1, 6); // 지난달부터 6개월 (이번 달은 신고가 덜 됨)
  const old5 = monthsBack(now, 60 + 1, 3), old10 = monthsBack(now, 120 + 1, 3);
  const regionsOut = {}, cands = [];
  const kinds = {}; // 종류별 수집 상태: ok | 활용신청 필요
  let calls = 0, failed = 0;
  const perM2 = (list) => median(list.filter((t) => t.area && t.price).map((t) => t.price / t.area));
  for (const K of KINDS) {
    // 빌라·오피스텔은 한 번 시험 호출해 활용신청이 안 돼 있으면 건너뛴다
    if (K.kind !== '아파트') {
      try { await month(K.trade, key, regions[0].lawd, recent[0], (b) => E.parseRtmsXml(asApt(K.name)(b))); calls++; }
      catch (err) { kinds[K.kind] = err.unregistered ? '활용신청 필요' : `조회 실패: ${err.message}`; continue; }
    }
    kinds[K.kind] = 'ok';
    const parseT = (b) => E.parseRtmsXml(asApt(K.name)(b)), parseR = (b) => E.parseRtmsRentXml(asApt(K.name)(b));
    await pool(regions.map((r) => async () => {
      const take = async (base, yms, parse) => {
        const res = [];
        for (const ym of yms) {
          try { res.push(...(await month(base, key, r.lawd, ym, parse))); calls++; } catch (err) { failed++; }
        }
        return res;
      };
      const sales = await take(K.trade, recent, parseT);
      const rents = await take(K.rent, recent, parseR);
      const s5 = await take(K.trade, old5, parseT);
      const s10 = K.history ? await take(K.trade, old10, parseT) : [];
      const nowM2 = perM2(sales);
      const stat = { sales: sales.length, rents: rents.length, perM2: nowM2, cagr5: cagr(nowM2, perM2(s5), 5), cagr10: K.history ? cagr(nowM2, perM2(s10), 10) : null };
      if (K.kind === '아파트') regionsOut[r.id] = { name: r.name, ...stat, byKind: {} };
      else (regionsOut[r.id] ||= { name: r.name, byKind: {} }).byKind[K.kind] = stat;
      const list = RECO.aggregate(sales, rents, { months: 7, regionId: r.id, now: now.toISOString().slice(0, 10) });
      for (const c of list) {
        if (c.price < (K.kind === '아파트' ? 3 : 1.5) * 1e8) continue;
        const same = (t) => t.name === c.name && t.area && Math.abs(t.area - c.area) <= 3;
        const o5 = s5.filter(same), o10 = s10.filter(same);
        const m5 = perM2(o5), m10 = perM2(o10);
        cands.push({
          r: r.id, n: c.name, d: c.dong, j: c.jibun, a: c.area, p: c.price, je: c.jeonse || null, c: c.count, y: c.builtYear,
          t: c.trend != null ? Math.round(c.trend * 1000) / 1000 : null,
          g5: o5.length >= 2 ? Math.round(cagr(c.perM2, m5, 5) * 10000) / 10000 : null,
          g10: o10.length >= 2 ? Math.round(cagr(c.perM2, m10, 10) * 10000) / 10000 : null,
          k: K.kind,
        });
      }
    }), 4);
  }
  return {
    asOf: now.toISOString(), months: recent, history: { y5: old5, y10: old10 }, calls, failed, kinds,
    regions: regionsOut, cols: ['r', 'n', 'd', 'j', 'a', 'p', 'je', 'c', 'y', 't', 'g5', 'g10', 'k'],
    cands: cands.map((c) => [c.r, c.n, c.d, c.j, c.a, c.p, c.je, c.c, c.y, c.t, c.g5, c.g10, c.k]),
  };
}

module.exports = { build, monthsBack, cagr, month, KINDS, asApt };

if (require.main === module) {
  (async () => {
    const key = process.env.DATA_GO_KR_KEY || (() => { try { return require('../config.local.json').dataGoKrKey; } catch (_) { return ''; } })();
    if (!key) { console.log('DATA_GO_KR_KEY 없음: 시장 스냅샷 생략'); process.exit(0); }
    const out = path.resolve(process.argv[2] || 'dist');
    fs.mkdirSync(out, { recursive: true });
    const t0 = Date.now();
    const m = await build(key);
    console.log('주택 종류:', JSON.stringify(m.kinds));
    if (m.cands.length < 500) { console.log(`후보가 너무 적어 저장하지 않음 (${m.cands.length}곳, 실패 ${m.failed}건)`); process.exit(0); }
    fs.writeFileSync(path.join(out, 'market-seoul.json'), JSON.stringify(m));
    console.log(`서울 시장 스냅샷: 후보 ${m.cands.length}곳 · 호출 ${m.calls}건 · 실패 ${m.failed}건 · ${Math.round((Date.now() - t0) / 1000)}초`);
    process.exit(0);
  })();
}
