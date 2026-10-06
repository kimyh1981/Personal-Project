const test = require('node:test');
const assert = require('node:assert/strict');
const { collect, decode, googleUrl } = require('../tools/collect.js');

const NOW = Date.parse('2026-10-05T21:00:00Z');
const item = (t, d = 'Mon, 05 Oct 2026 20:00:00 GMT') => `<item><title>${t}</title><link>https://x/${encodeURIComponent(t)}</link><pubDate>${d}</pubDate></item>`;
const feed = (...titles) => `<?xml version="1.0" encoding="UTF-8"?><rss><channel>${titles.map((t) => item(t)).join('')}</channel></rss>`;

test('EUC-KR RSS도 한글로 푼다', () => {
  const xml = '<?xml version="1.0" encoding="EUC-KR"?><rss><title>';
  const euc = Buffer.concat([Buffer.from(xml), Buffer.from([0xb3, 0xf3, 0xbe, 0xf7]), Buffer.from('</title></rss>')]); // 농업
  assert.match(decode(new Uint8Array(euc)), /<title>농업<\/title>/);
  assert.match(decode(new Uint8Array(Buffer.from('<rss>비료</rss>'))), /비료/);
});

test('언론사 RSS가 막히면 구글 뉴스로 대신하고, 섹션끼리 겹치는 기사는 한 번만 읽는다', async (t) => {
  const pages = {
    'https://paper.kr/rss': null, // 403
    [googleUrl('site:paper.kr')]: feed('국회, 예산안 처리 - 신문사'),
    'https://farm.kr/rss': feed('[포토] 들녘', '벼 수확 한창', '쌀값 반등'),
    [googleUrl('비료')]: feed('비료 가격 안정 대책', '국회, 예산안 처리'),
  };
  t.mock.method(globalThis, 'fetch', async (url) => {
    const body = pages[url];
    if (body === undefined) throw new Error('예상 못한 주소 ' + url);
    if (body === null) return new Response('forbidden', { status: 403 });
    return new Response(body, { headers: { 'content-type': 'application/rss+xml' } });
  });
  const config = { sections: [
    { id: 'papers', title: '주요 신문 헤드라인', perSourceLabel: true, limit: 5, sources: [{ name: '신문사', url: 'https://paper.kr/rss', google: 'site:paper.kr', take: 2 }] },
    { id: 'farm', title: '농업 신문 헤드라인', perSourceLabel: true, limit: 5, sources: [{ name: '농업신문', url: 'https://farm.kr/rss', take: 1 }] },
    { id: 'fertilizer', title: '비료 관련 뉴스', limit: 5, sources: [{ name: '구글 뉴스', google: '비료', take: 5 }] },
  ] };
  const b = await collect(config, NOW);
  assert.deepEqual(b.sections.map((s) => s.items.map((i) => i.title)), [['국회, 예산안 처리'], ['벼 수확 한창'], ['비료 가격 안정 대책']]);
  assert.equal(b.sections[0].items[0].source, '신문사');
  assert.ok(b.log.includes('신문사: RSS 실패 (HTTP 403)'));
  assert.ok(b.log.includes('신문사: 구글 1건'));
  assert.match(b.script, /^좋은 아침입니다\. 10월 6일 화요일/);
  assert.match(b.script, /농업신문\.\n벼 수확 한창\./);
});

test('하나도 못 가져오면 그 사실을 말해 준다', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('offline'); });
  const b = await collect({ sections: [{ id: 'a', title: '가', limit: 3, sources: [{ name: '가', url: 'https://a' }] }] }, NOW);
  assert.match(b.script, /뉴스를 가져오지 못했습니다/);
});
