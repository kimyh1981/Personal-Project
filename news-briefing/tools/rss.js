/*
 * RSS·Atom 읽기와 아침 브리핑 원고 만들기. 네트워크 없이 동작하는 순수 함수만 둔다 (테스트 대상).
 */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”' };

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

// 태그 안 텍스트: CDATA를 풀고, 엔티티를 풀고, 남은 HTML 태그를 지운다
function text(raw) {
  if (raw == null) return '';
  let s = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  s = decodeEntities(s);
  s = s.replace(/<[^>]+>/g, ' ');
  return decodeEntities(s).replace(/\s+/g, ' ').trim();
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : null;
}

// RSS 2.0의 <item>과 Atom의 <entry>를 모두 읽는다
function parseFeed(xml) {
  const items = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const b of blocks) {
    const title = text(tag(b, 'title'));
    if (!title) continue;
    let link = text(tag(b, 'link'));
    if (!link) {
      const href = b.match(/<link[^>]*href="([^"]+)"/i);
      if (href) link = decodeEntities(href[1]);
    }
    const when = text(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date'));
    const t = when ? Date.parse(when) : NaN;
    items.push({
      title,
      link,
      source: text(tag(b, 'source')),
      publishedAt: Number.isFinite(t) ? new Date(t).toISOString() : null,
    });
  }
  return items;
}

// 사진·영상·부고·인사 같은 기사는 귀로 들어도 소용이 없다
const SKIP = /\[(포토|사진|영상|그래픽|카드뉴스|부고|인사|게시판|운세|오늘의 운세|만평|TV|동영상)\]|^(부고|인사|게시판|오늘의 운세)\b|포토뉴스|\[포토\]/;

// 일본어판·영문판 기사(한글이 거의 없는 제목)도 뺀다
function skip(title) {
  if (/[\u3040-\u30ff]/.test(title)) return true;
  const hangul = (title.match(/[가-힣]/g) || []).length;
  return hangul < 4 || SKIP.test(title);
}

// 구글 뉴스 제목 끝의 " - 언론사"를 떼어 낸다
function splitGoogleSource(title, source) {
  if (source && title.endsWith(' - ' + source)) return title.slice(0, -(source.length + 3)).trim();
  return title.replace(/ - [^-]{1,20}$/, '').trim();
}

// 제목에 흔한 한자 약칭: 음성이 '날 일'처럼 읽지 않게 우리말로 바꾼다
const HANJA = [['與野', '여야'], ['日', '일본'], ['美', '미국'], ['中', '중국'], ['北', '북한'], ['韓', '한국'], ['英', '영국'], ['獨', '독일'], ['佛', '프랑스'], ['露', '러시아'], ['印', '인도'], ['濠', '호주'], ['與', '여당'], ['野', '야당'], ['靑', '청와대'], ['檢', '검찰'], ['軍', '군'], ['銀', '은행'], ['株', '주식'], ['百', '백화점'], ['女', '여성'], ['男', '남성'], ['前', '전'], ['現', '현'], ['新', '신'], ['故', '고']];

// 소리 내어 읽기 좋게 다듬는다: 말머리, (종합), 따옴표, 말줄임표, 기호
function spoken(title) {
  let s = title.normalize('NFKC'); // 호환용 한자(U+F900대)·전각 문자를 보통 글자로
  for (const [h, k] of HANJA) s = s.split(h).join(k);
  s = s.replace(/\[[^\]]{1,12}\]|【[^】]{1,12}】|<[^>]{1,12}>|〈[^〉]{1,12}〉/g, ' ');
  s = s.replace(/\((종합|종합\d*보|\d+보|속보|단독|상보|영상|사진|포토|인터뷰|르포|일문일답)[^)]{0,6}\)/g, ' ');
  s = s.replace(/^\s*(속보|단독)\s*[:|]?\s*/, ' ');
  s = s.replace(/[‘’“”"'`]/g, '');
  s = s.replace(/…|\.{2,}/g, ', ');
  s = s.replace(/↑/g, ' 상승').replace(/↓/g, ' 하락').replace(/[→⇒]/g, ', ');
  s = s.replace(/·/g, ' ').replace(/[|/]/g, ', ').replace(/(\d)\s*~\s*(?=\d)/g, '$1에서 ').replace(/~/g, ', ');
  s = s.replace(/\s*,(?:\s*,)*\s*(?!\d)/g, ', ').replace(/\s+/g, ' ').replace(/^[\s,]+|[\s,]+$/g, '');
  return s;
}

function normalize(title) {
  return spoken(title).replace(/[^0-9a-z가-힣]/gi, '').toLowerCase();
}

function bigrams(s) {
  const out = new Set();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}

// 같은 사건을 여러 신문이 비슷한 제목으로 냈으면 한 번만 읽는다
function similar(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  const A = bigrams(na);
  const B = bigrams(nb);
  let both = 0;
  for (const x of A) if (B.has(x)) both++;
  if (both / (A.size + B.size - both) >= 0.6) return true;
  // 제목이 달라도 같은 사건: 숫자가 든 낱말("14개사")과 다른 긴 낱말("농기자재")을 함께 공유하거나, 긴 낱말을 셋 이상 공유
  const ta = words(a);
  const tb = words(b);
  const shared = ta.filter((x) => tb.some((y) => x === y || (x.length >= 3 && y.includes(x)) || (y.length >= 3 && x.includes(y))));
  const digit = shared.filter((x) => /\d/.test(x) && x.length >= 2);
  const long = shared.filter((x) => !/\d/.test(x) && x.length >= 3);
  return (digit.length >= 1 && long.length >= 1) || long.length >= 2;
}

const PARTICLE = /(에서|으로|에게|까지|부터|이다|에|의|을|를|은|는|이|가|와|과|로|도)$/;

function words(title) {
  return spoken(title).toLowerCase().split(/[^0-9a-z가-힣]+/).map((w) => (w.length > 2 ? w.replace(PARTICLE, '') : w)).filter((w) => w.length >= 2);
}

function fresh(item, now, hours = 36) {
  if (!item.publishedAt) return true;
  const t = Date.parse(item.publishedAt);
  return t <= now + 3600e3 && now - t <= hours * 3600e3;
}

// 출처별로 읽어 온 기사를 섹션 목록으로 고른다. seen은 섹션끼리 겹치는 기사를 거르는 데 쓴다
function pick(section, fetched, now, seen = []) {
  const items = [];
  const hours = section.hours || 36;
  const must = section.must ? new RegExp(section.must) : null; // 검색 결과에 섞여 든 엉뚱한 기사를 거른다
  for (const { source, items: list } of fetched) {
    let taken = 0;
    for (const it of list) {
      if (taken >= (source.take || 3) || items.length >= section.limit) break;
      const title = it.viaGoogle ? splitGoogleSource(it.title, it.source) : it.title;
      if (skip(title) || !fresh(it, now, hours) || !spoken(title) || (must && !must.test(title))) continue;
      if (seen.some((t) => similar(t, title))) continue;
      seen.push(title);
      items.push({ title, spoken: spoken(title), source: source.name.startsWith('구글 뉴스') ? it.source || source.name : source.name, link: it.link, publishedAt: it.publishedAt });
      taken++;
    }
  }
  return items;
}

const DAYS = ['일', '월', '화', '수', '목', '금', '토'];

function koreanDate(now) {
  const kst = new Date(now + 9 * 3600e3);
  return `${kst.getUTCMonth() + 1}월 ${kst.getUTCDate()}일 ${DAYS[kst.getUTCDay()]}요일`;
}

const ORDINAL = ['먼저', '다음은', '이어서', '마지막으로'];

// 차에서 들을 원고. 문장 끝마다 마침표를 넣어 음성이 잠깐 쉬게 한다
function buildScript(sections, now) {
  const lines = [`좋은 아침입니다. ${koreanDate(now)} 아침 뉴스 브리핑입니다.`];
  sections.forEach((sec, i) => {
    const lead = i === sections.length - 1 && sections.length > 1 ? ORDINAL[3] : ORDINAL[Math.min(i, 2)];
    lines.push('');
    lines.push(`${lead} ${sec.title}입니다.`);
    if (!sec.items.length) {
      lines.push('오늘은 새 소식이 없습니다.');
      return;
    }
    if (sec.perSourceLabel) {
      let last = null;
      for (const it of sec.items) {
        if (it.source !== last) lines.push(`${it.source}.`);
        last = it.source;
        lines.push(`${it.spoken}.`);
      }
    } else {
      for (const it of sec.items) lines.push(`${it.spoken}.`);
    }
  });
  lines.push('');
  lines.push('이상으로 오늘 아침 브리핑을 마칩니다. 오늘도 안전 운전하세요.');
  return lines.join('\n') + '\n';
}

module.exports = { decodeEntities, text, parseFeed, skip, splitGoogleSource, spoken, similar, words, fresh, pick, koreanDate, buildScript };
