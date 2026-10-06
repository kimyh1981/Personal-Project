/* 아침 뉴스 브리핑 화면: briefing.json을 보여 주고, 원고를 한 줄씩 한국어 음성으로 읽는다 */
(function () {
  const $ = (id) => document.getElementById(id);
  const synth = window.speechSynthesis;
  const RATES = [0.9, 1.0, 1.15, 1.3];
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* 저장 못 해도 동작에는 지장 없음 */ } },
  };
  let rate = Number(store.get('news.rate')) || 1.0;
  let queue = []; // { text, sec, el }
  let pos = 0;
  let playing = false;
  let voice = null;

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function pickVoice() {
    const ko = synth ? synth.getVoices().filter((v) => /^ko/i.test(v.lang)) : [];
    voice = ko.find((v) => v.localService) || ko[0] || null;
  }

  function kstTime(iso) {
    return new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function render(b) {
    const age = (Date.now() - Date.parse(b.generatedAt)) / 3600e3;
    $('meta').textContent = `${b.dateLabel} · ${kstTime(b.generatedAt)} 수집` + (age > 20 ? ' · 어제 소식일 수 있어요' : '');
    $('list').innerHTML = b.sections.map((s, si) => `<section><h2>${esc(s.title)}</h2>` + (s.items.length
      ? `<ol>${s.items.map((it, ii) => `<li id="i${si}-${ii}"><a href="${esc(it.link)}" target="_blank" rel="noopener">${esc(it.title)}</a><small>${esc(it.source)}</small></li>`).join('')}</ol>`
      : '<p class="empty">새 소식 없음</p>') + '</section>').join('');

    // 원고 줄을 화면의 섹션·기사와 짝지어, 읽는 중인 기사를 표시하고 섹션 단위로 건너뛴다
    let sec = -1;
    queue = b.script.split('\n').map((t) => t.trim()).filter(Boolean).map((text) => {
      const hs = b.sections.findIndex((s, i) => i > sec && text.endsWith(`${s.title}입니다.`));
      if (hs >= 0) sec = hs;
      const s = b.sections[sec];
      const ii = s ? s.items.findIndex((it) => `${it.spoken}.` === text) : -1;
      return { text, sec, el: ii >= 0 ? $(`i${sec}-${ii}`) : null };
    });
  }

  function mark(el) {
    document.querySelectorAll('li.now').forEach((x) => x.classList.remove('now'));
    if (el) { el.classList.add('now'); el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  }

  function setPlaying(on) {
    playing = on;
    $('play').textContent = on ? '⏸ 멈춤' : pos > 0 && pos < queue.length ? '▶ 이어 듣기' : '▶ 듣기';
  }

  function speak() {
    if (!playing) return;
    if (pos >= queue.length) { pos = 0; mark(null); setPlaying(false); return; }
    const line = queue[pos];
    mark(line.el);
    const u = new SpeechSynthesisUtterance(line.text);
    u.lang = 'ko-KR';
    if (voice) u.voice = voice;
    u.rate = rate;
    u.onend = () => { if (playing) { pos++; speak(); } };
    u.onerror = (e) => {
      if (e.error === 'interrupted' || e.error === 'canceled') return;
      setPlaying(false); // 'not-allowed': 화면을 한 번 눌러야 소리를 낼 수 있는 브라우저
    };
    synth.speak(u);
  }

  function play() {
    if (!synth || !queue.length) return;
    synth.cancel();
    setPlaying(true);
    speak();
  }

  function stop() {
    setPlaying(false);
    if (synth) synth.cancel();
  }

  function jump(dir) {
    const cur = queue[pos] ? queue[pos].sec : -1;
    let target;
    if (dir > 0) target = queue.findIndex((q, i) => i > pos && q.sec > cur);
    else {
      const start = queue.findIndex((q) => q.sec === cur);
      const prevSec = start === pos || start < 0 ? cur - 1 : cur;
      target = queue.findIndex((q) => q.sec === prevSec);
    }
    pos = target < 0 ? (dir > 0 ? queue.length : 0) : target;
    if (playing) play(); else { mark(queue[pos] && queue[pos].el); setPlaying(false); }
  }

  $('play').onclick = () => (playing ? stop() : play());
  $('next').onclick = () => jump(1);
  $('back').onclick = () => jump(-1);
  const showRate = () => { $('rate').textContent = `${rate}×`; };
  showRate();
  $('rate').onclick = () => {
    rate = RATES[(RATES.indexOf(rate) + 1) % RATES.length] || 1.0;
    store.set('news.rate', String(rate));
    showRate();
    if (playing) play();
  };
  $('txtUrl').textContent = new URL('briefing.txt', location.href).href;

  if (!synth) $('play').disabled = true;
  else { pickVoice(); synth.onvoiceschanged = pickVoice; }

  fetch('briefing.json', { cache: 'no-store' })
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((b) => {
      render(b);
      if (new URLSearchParams(location.search).has('autoplay')) play();
    })
    .catch(() => { $('meta').textContent = '오늘 브리핑을 아직 만들지 못했어요. 잠시 후 다시 열어 주세요.'; });
})();
