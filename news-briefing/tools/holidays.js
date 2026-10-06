/*
 * 자동 재생하는 날: 월~금, 공휴일(대체공휴일·선거일 포함) 제외.
 * 공휴일은 공공데이터포털 한국천문연구원 특일 정보(getRestDeInfo)로 확인하고,
 * 키가 없거나 조회에 실패하면 아래 목록으로 판단한다.
 */

// 해마다 같은 날짜인 공휴일 (대체공휴일은 해마다 달라 아래 목록과 특일 API에 맡긴다)
const FIXED = { '01-01': '신정', '03-01': '삼일절', '05-05': '어린이날', '06-06': '현충일', '08-15': '광복절', '10-03': '개천절', '10-09': '한글날', '12-25': '성탄절' };

// 음력 공휴일·대체공휴일·선거일. 특일 API 조회가 실패할 때만 쓴다
const KNOWN = {
  '2026-02-16': '설날 연휴', '2026-02-17': '설날', '2026-02-18': '설날 연휴',
  '2026-03-02': '삼일절 대체공휴일',
  '2026-05-24': '부처님오신날', '2026-05-25': '부처님오신날 대체공휴일',
  '2026-06-03': '전국동시지방선거',
  '2026-08-17': '광복절 대체공휴일',
  '2026-09-24': '추석 연휴', '2026-09-25': '추석', '2026-09-26': '추석 연휴',
  '2026-10-05': '개천절 대체공휴일',
};

const API = 'https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo';

// 한국 시간 날짜 'YYYY-MM-DD'와 요일(0=일)
function kstDay(now) {
  const d = new Date(now + 9 * 3600e3);
  return { ymd: d.toISOString().slice(0, 10), dow: d.getUTCDay() };
}

function knownHoliday(ymd) {
  return KNOWN[ymd] || FIXED[ymd.slice(5)] || null;
}

// 특일 API 응답(XML)에서 휴일인 날짜를 모은다: { 'YYYY-MM-DD': '이름' }
function parseRestDays(xml) {
  const out = {};
  for (const item of xml.match(/<item>[\s\S]*?<\/item>/g) || []) {
    const date = (item.match(/<locdate>(\d{8})<\/locdate>/) || [])[1];
    const name = (item.match(/<dateName>([^<]*)<\/dateName>/) || [])[1] || '공휴일';
    const off = (item.match(/<isHoliday>([YN])<\/isHoliday>/) || [])[1];
    if (date && off !== 'N') out[`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}`] = name.trim();
  }
  return out;
}

// 공공데이터포털은 Node 내장 fetch로 연결이 끊기는 경우가 있어 부동산 판단기(tools/market.js)처럼 https 모듈로 읽는다
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const req = require('https').get(url, { timeout: 15000, headers: { 'user-agent': 'Mozilla/5.0 (news-briefing)' } }, (res) => {
      let d = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, text: async () => d }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('응답 시간 초과')));
  });
}

async function fetchRestDays(ymd, key, fetcher = httpsGet) {
  const url = `${API}?serviceKey=${encodeURIComponent(key)}&solYear=${ymd.slice(0, 4)}&solMonth=${ymd.slice(5, 7)}&numOfRows=50`;
  let res;
  for (let k = 0; ; k++) {
    try { res = await fetcher(url); break; } catch (err) {
      if (k >= 2) throw new Error(err.cause?.code || err.code || err.message);
      await new Promise((r) => setTimeout(r, 1000 * (k + 1)));
    }
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  if (!/<resultCode>00<\/resultCode>/.test(xml)) throw new Error((xml.match(/<(?:resultMsg|returnAuthMsg)>([^<]*)</) || [])[1] || '응답 오류');
  return parseRestDays(xml);
}

// 오늘 자동 재생할지: { play, ymd, reason, source }
async function playDay(now, key, fetcher) {
  const { ymd, dow } = kstDay(now);
  if (dow === 0 || dow === 6) return { play: false, ymd, reason: dow === 0 ? '일요일' : '토요일', source: '요일' };
  if (key) {
    try {
      const rest = await fetchRestDays(ymd, key, fetcher);
      return rest[ymd] ? { play: false, ymd, reason: rest[ymd], source: '특일 API' } : { play: true, ymd, reason: '평일', source: '특일 API' };
    } catch (err) {
      const name = knownHoliday(ymd);
      return { play: !name, ymd, reason: name || '평일', source: `내장 목록 (특일 API 실패: ${err.message})` };
    }
  }
  const name = knownHoliday(ymd);
  return { play: !name, ymd, reason: name || '평일', source: '내장 목록' };
}

module.exports = { kstDay, knownHoliday, parseRestDays, fetchRestDays, playDay };
