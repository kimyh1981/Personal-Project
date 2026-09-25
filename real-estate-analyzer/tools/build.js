// index.html + css + js를 하나의 HTML 파일(dist/real-estate-analyzer.html)로 묶는다.
// --fragment: <html>/<head>/<body> 없이 본문만 출력 (Artifact 게시용)
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const fragment = process.argv.includes('--fragment');

const html = read('index.html');
const css = read('css/style.css');
const scripts = ['js/policy.js', 'js/engine.js', 'js/conditions.js', 'js/charts.js', 'js/app.js'].map(read);
const body = html.slice(html.indexOf('<!--BODY-START-->') + 17, html.indexOf('<!--BODY-END-->'));
const fonts = html.match(/<link rel="stylesheet" href="https:\/\/fonts[^>]+>/)[0];
const title = html.match(/<title>[^<]+<\/title>/)[0];
const inline = scripts.map((s) => `<script>\n${s.replace(/<\/script/gi, '<\\/script')}\n</script>`).join('\n');
const head = `${title}\n<link rel="preconnect" href="https://fonts.googleapis.com">\n${fonts}\n<style>\n${css}\n</style>`;

const out = fragment
  ? `${head}\n${body}\n${inline}\n`
  : `<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${head}\n</head>\n<body>\n${body}\n${inline}\n</body>\n</html>\n`;
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const file = path.join(root, 'dist', fragment ? 'artifact.html' : 'real-estate-analyzer.html');
fs.writeFileSync(file, out);
console.log('wrote', path.relative(root, file), (out.length / 1024).toFixed(1) + 'KB');
