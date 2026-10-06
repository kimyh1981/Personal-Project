#!/usr/bin/env node
/*
 * 아침 뉴스 브리핑 수집. 배포 작업이 매일 새벽 이 스크립트로 RSS를 모아
 * news/briefing.json(화면용)과 news/briefing.txt(음성 원고)를 만든다.
 * 사용: node tools/collect.js <출력 폴더>
 */
const fs = require('fs');
const path = require('path');
const rss = require('./rss.js');
const holidays = require('./holidays.js');

const UA = 'Mozilla/5.0 (compatible; news-briefing/1.0; +https://github.com/kimyh1981/Personal-Project)';

function googleUrl(q, when = '1d') {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(`${q} when:${when}`)}&hl=ko&gl=KR&ceid=KR:ko`;
}

// 국내 언론 RSS 일부는 EUC-KR이다: XML 선언이나 Content-Type의 charset을 보고 푼다
function decode(buf, contentType = '') {
  const head = Buffer.from(buf.slice(0, 200)).toString('latin1');
  const cs = (head.match(/encoding=["']([\w-]+)["']/i) || contentType.match(/charset=([\w-]+)/i) || [])[1] || 'utf-8';
  try {
    return new TextDecoder(cs.toLowerCase()).decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml, */*' }, signal: AbortSignal.timeout(15e3), redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return decode(new Uint8Array(await res.arrayBuffer()), res.headers.get('content-type') || '');
}

// 언론사 RSS를 먼저 읽고, 막히거나 비었으면 구글 뉴스 검색으로 대신한다
async function readSource(src, log) {
  const tries = [];
  if (src.url) tries.push(['RSS', src.url]);
  if (src.google) tries.push(['구글', googleUrl(src.google, src.when)]);
  for (const [kind, url] of tries) {
    try {
      const items = rss.parseFeed(await get(url)).map((it) => ({ ...it, viaGoogle: url.startsWith('https://news.google.com/') }));
      if (items.length) {
        log.push(`${src.name}: ${kind} ${items.length}건`);
        return items;
      }
      log.push(`${src.name}: ${kind} 비어 있음`);
    } catch (err) {
      log.push(`${src.name}: ${kind} 실패 (${err.cause?.code || err.message})`);
    }
  }
  return [];
}

// 자동 재생(아이폰 단축어·Tasker)이 읽는 briefing.txt: 주말·공휴일에는 비워 두어 아무것도 읽지 않게 한다
function speechText(b) {
  return b.autoPlay.play ? b.script : '';
}

async function collect(config, now = Date.now(), key = '') {
  const log = [];
  const autoPlay = await holidays.playDay(now, key);
  const fetched = await Promise.all(config.sections.map((sec) => Promise.all(sec.sources.map(async (source) => ({ source, items: await readSource(source, log) })))));
  const seen = [];
  const sections = config.sections.map((sec, i) => ({ id: sec.id, title: sec.title, perSourceLabel: !!sec.perSourceLabel, items: rss.pick(sec, fetched[i], now, seen) }));
  const total = sections.reduce((n, s) => n + s.items.length, 0);
  const script = total ? rss.buildScript(sections, now) : `좋은 아침입니다. ${rss.koreanDate(now)}입니다. 오늘은 뉴스를 가져오지 못했습니다. 안전 운전하세요.\n`;
  return { generatedAt: new Date(now).toISOString(), dateLabel: rss.koreanDate(now), autoPlay, sections, script, log };
}

if (require.main === module) {
  (async () => {
    const out = path.resolve(process.argv[2] || 'dist');
    fs.mkdirSync(out, { recursive: true });
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'feeds.json'), 'utf8'));
    const b = await collect(config, Date.now(), process.env.DATA_GO_KR_KEY || '');
    fs.writeFileSync(path.join(out, 'briefing.json'), JSON.stringify(b, null, 1));
    fs.writeFileSync(path.join(out, 'briefing.txt'), speechText(b));
    console.log(`뉴스 브리핑 ${b.dateLabel}: ` + b.sections.map((s) => `${s.title} ${s.items.length}건`).join(' · '));
    b.log.forEach((l) => console.log('  ' + l));
    console.log(`자동 재생: ${b.autoPlay.play ? '함' : '안 함'} (${b.autoPlay.ymd} ${b.autoPlay.reason}, ${b.autoPlay.source})`);
    console.log(`원고 ${b.script.length}자 (약 ${Math.ceil(b.script.length / 330)}분)`);
    if (b.script.length > 3900) console.log('  경고: 안드로이드 음성 엔진(Tasker Say)은 약 4,000자까지만 읽습니다. feeds.json의 limit을 줄이세요.');
    process.exit(0); // 남은 연결이 있어도 배포를 막지 않는다
  })();
}

module.exports = { collect, decode, googleUrl, speechText };
