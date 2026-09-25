const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('앱 매니페스트: 설치 요건 (이름, standalone, 192·512 아이콘, maskable)', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.ok(m.name && m.short_name && m.short_name.length <= 12);
  assert.equal(m.display, 'standalone');
  assert.equal(m.start_url.startsWith('./'), true, 'GitHub Pages 하위 경로에서도 동작하도록 상대 경로');
  const sizes = m.icons.map((i) => i.sizes);
  assert.ok(sizes.includes('192x192') && sizes.includes('512x512'));
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'));
  for (const i of m.icons) {
    const png = fs.readFileSync(path.join(root, i.src));
    assert.equal(png.readUInt32BE(16), Number(i.sizes.split('x')[0]), `${i.src} 크기`);
  }
});

test('서비스 워커: 캐시 목록의 파일이 모두 있고, 공공데이터 API는 캐시하지 않는다', () => {
  const sw = read('sw.js');
  const shell = JSON.parse(sw.match(/const SHELL = (\[[\s\S]*?\]);/)[1].replace(/'/g, '"').replace(/,\s*\]/, ']'));
  for (const f of shell) if (f !== './') assert.ok(fs.existsSync(path.join(root, f)), f);
  assert.match(sw, /\/api\/[\s\S]*return;/);
  const html = read('index.html');
  for (const src of html.match(/<script src="([^"]+)"/g).map((x) => x.slice(13, -1))) assert.ok(shell.includes(src), `${src}가 오프라인 캐시에 없음`);
  assert.match(html, /rel="manifest"/);
  assert.match(html, /name="theme-color"/);
});
