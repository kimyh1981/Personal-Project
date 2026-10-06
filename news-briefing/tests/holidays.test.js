const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('../tools/holidays.js');
const { collect, speechText } = require('../tools/collect.js');

const at = (ymd, hh = 6) => Date.parse(`${ymd}T${String(hh).padStart(2, '0')}:00:00+09:00`);

test('주말은 재생하지 않는다 (한국 시간 기준)', async () => {
  assert.deepEqual(await h.playDay(at('2026-10-06'), ''), { play: true, ymd: '2026-10-06', reason: '평일', source: '내장 목록' });
  assert.equal((await h.playDay(at('2026-10-10'), '')).reason, '토요일');
  assert.equal((await h.playDay(at('2026-10-11'), '')).reason, '일요일');
  // UTC로는 금요일 밤이지만 한국은 토요일 새벽
  assert.equal((await h.playDay(Date.parse('2026-10-09T21:00:00Z'), '')).play, false);
});

test('내장 목록: 고정 공휴일과 2026년 음력·대체공휴일·선거일', async () => {
  for (const [ymd, name] of [['2026-10-09', '한글날'], ['2026-10-05', '개천절 대체공휴일'], ['2026-09-24', '추석 연휴'], ['2026-06-03', '전국동시지방선거'], ['2026-03-02', '삼일절 대체공휴일'], ['2027-03-01', '삼일절']]) {
    const d = await h.playDay(at(ymd), '');
    assert.deepEqual([d.play, d.reason], [false, name], ymd);
  }
});

const API = (items) => `<response><header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header><body><items>${items}</items></body></response>`;

test('특일 API가 있으면 그 결과를 따른다 (내장 목록에 없는 임시공휴일도)', async () => {
  const xml = API('<item><dateKind>01</dateKind><dateName>임시공휴일</dateName><isHoliday>Y</isHoliday><locdate>20261007</locdate><seq>1</seq></item>');
  let url = '';
  const fetcher = async (u) => { url = u; return new Response(xml); };
  assert.deepEqual(await h.playDay(at('2026-10-07'), 'K+Y/', fetcher), { play: false, ymd: '2026-10-07', reason: '임시공휴일', source: '특일 API' });
  assert.match(url, /serviceKey=K%2BY%2F&solYear=2026&solMonth=10/);
  assert.equal((await h.playDay(at('2026-10-08'), 'k', fetcher)).play, true);
});

test('특일 API가 실패하면 내장 목록으로 판단한다', async () => {
  const bad = async () => new Response('<OpenAPI_ServiceResponse><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg></OpenAPI_ServiceResponse>');
  const d = await h.playDay(at('2026-10-09'), 'k', bad);
  assert.equal(d.play, false);
  assert.match(d.source, /내장 목록 \(특일 API 실패: SERVICE_KEY_IS_NOT_REGISTERED_ERROR\)/);
});

test('briefing.txt: 쉬는 날에는 비워서 자동 재생이 아무것도 읽지 않는다', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('<rss><channel><item><title>오늘의 주요 소식입니다</title><link>x</link></item></channel></rss>'));
  const config = { sections: [{ id: 'a', title: '가', limit: 3, sources: [{ name: '가', url: 'https://a' }] }] };
  const work = await collect(config, at('2026-10-06'));
  assert.match(speechText(work), /오늘의 주요 소식입니다/);
  const off = await collect(config, at('2026-10-09'));
  assert.equal(speechText(off), '');
  assert.match(off.script, /오늘의 주요 소식입니다/, '화면(briefing.json)에서는 쉬는 날에도 들을 수 있다');
  assert.deepEqual([off.autoPlay.play, off.autoPlay.reason], [false, '한글날']);
});
