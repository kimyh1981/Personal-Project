const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('앱 매니페스트: 설치 요건과 아이콘 크기', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.ok(m.name && m.short_name.length <= 12);
  assert.equal(m.display, 'standalone');
  assert.ok(m.start_url.startsWith('./'), 'GitHub Pages 하위 경로(/news/)에서도 동작하도록 상대 경로');
  for (const i of m.icons) {
    const png = fs.readFileSync(path.join(root, i.src));
    assert.equal(png.readUInt32BE(16), Number(i.sizes.split('x')[0]), i.src);
  }
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'));
});

test('화면이 참조하는 파일이 모두 있고, 배포 작업이 그 파일들을 news/로 올린다', () => {
  const html = read('index.html');
  const refs = [...html.matchAll(/(?:src|href)="([^"#:]+)"/g)].map((m) => m[1]);
  for (const r of refs) assert.ok(fs.existsSync(path.join(root, r)), r);
  const wf = fs.readFileSync(path.join(root, '..', '.github', 'workflows', 'pages.yml'), 'utf8');
  for (const f of ['index.html', 'manifest.webmanifest', 'js', 'icons']) assert.match(wf, new RegExp(`cp -r [^\\n]*\\b${f.replace('.', '\\.')}\\b[^\\n]*_site/news`), f);
  assert.match(wf, /node tools\/collect\.js \.\.\/_site\/news/);
  assert.match(wf, /cron: '\d+ 20 \* \* \*'/, '한국 시간 새벽 5시대에 브리핑을 만든다');
});
