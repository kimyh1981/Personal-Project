const test = require('node:test');
const assert = require('node:assert/strict');
const server = require('../tools/server.js');

test('로컬 서버: 헬스체크, 입력 검증, 경로 이탈 차단', async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const h = await (await fetch(base + '/api/health')).json();
    assert.equal(h.ok, true);
    assert.equal((await fetch(base + '/api/rtms?lawd=abc&ym=202601')).status, 400);
    assert.equal((await fetch(base + '/')).status, 200);
    assert.notEqual((await fetch(base + '/..%2f..%2fetc/passwd')).status, 200);
  } finally {
    server.close();
  }
});
