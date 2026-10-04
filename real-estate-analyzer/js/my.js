/*
 * 내 맞춤 추천 화면. 개인 조건은 localStorage에만 두고, 서울 시장 데이터(data/market-seoul.json)로 순위를 계산한다.
 * 처음 설정: my.html#setup=<base64url JSON> 링크로 열면 조건을 저장하고 주소에서 지운다 (서버로 전송되지 않음).
 */
(function () {
  const E = window.REA, P = window.REA_POLICY, T = window.REA_TIERS, GEO = window.REA_GEO, COND = window.REA_COND;
  const $ = (id) => document.getElementById(id);
  const MAN = 1e4, EOK = 1e8;
  const KEY = 'rea-my-profile', LAST = 'rea-my-last', GEOC = 'rea-my-geo';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const won = (x) => {
    if (x == null || !isFinite(x)) return '—';
    const v = Math.round(Math.abs(x) / MAN), e = Math.floor(v / 1e4), r = v % 1e4;
    return (x < 0 ? '−' : '') + (e && r ? `${e}억 ${r.toLocaleString()}만` : e ? `${e}억` : `${r.toLocaleString()}만`) + '원';
  };
  const manw = (x) => `${Math.round(x / MAN).toLocaleString()}만원`;
  const pct = (x, d = 1) => (x == null ? '—' : `${(x * 100).toFixed(d)}%`);
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch (_) { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* 무시 */ } };

  // ── 개인 설정 링크 ───────────────────────────────────────────────────
  // 설정 코드: 개인 설정 링크 전체나 setup= 뒤의 코드
  function decodeSetup(text) {
    const m = String(text || '').match(/setup=([A-Za-z0-9_-]+)/) || String(text || '').trim().match(/^([A-Za-z0-9_-]{40,})$/);
    if (!m) return null;
    try { return JSON.parse(decodeURIComponent(escape(atob(m[1].replace(/-/g, '+').replace(/_/g, '/'))))); } catch (_) { return null; }
  }
  function readSetupHash() {
    const p = decodeSetup(location.hash);
    if (p) history.replaceState(null, '', location.pathname); // 주소에서 지운다
    return p;
  }
  // 설치된 앱은 브라우저와 저장 공간이 달라, 링크 대신 앱 안에서 붙여넣을 수 있게 한다
  function setupPasteHtml() {
    return `<div class="setup-paste">
      <label class="f wide">개인 설정 링크 붙여넣기 <span class="unit">받은 링크 전체를 붙여넣으세요</span><textarea id="setupPaste" rows="3" placeholder="https://kimyh1981.github.io/Personal-Project/my.html#setup=..."></textarea></label>
      <div class="row"><button type="button" class="primary" id="setupApply">내 기준 불러오기</button><span class="muted" id="setupMsg"></span></div>
    </div>`;
  }
  document.addEventListener('click', (e) => {
    if (e.target.id !== 'setupApply') return;
    const p = decodeSetup($('setupPaste').value);
    if (!p) { $('setupMsg').textContent = '링크를 읽지 못했습니다. 링크 전체를 그대로 붙여넣어 주세요.'; return; }
    profile = { ...T.DEFAULTS, ...keepLocal(profile), ...p }; save(KEY, profile);
    renderForm(); run(true);
  });
  // 설정 링크에 없는 순위 메모·조건과 단지별 재건축 가정은 이 기기에 있던 것을 지킨다
  const keepLocal = (p) => Object.fromEntries(['tierRules', 'reconOverrides'].filter((k) => p && p[k]).map((k) => [k, p[k]]));
  let profile = { ...T.DEFAULTS, ...(load(KEY, {})) };
  const fromLink = readSetupHash();
  if (fromLink) { profile = { ...T.DEFAULTS, ...keepLocal(profile), ...fromLink }; save(KEY, profile); }
  const hasProfile = () => (profile.homes || []).length > 0;

  // ── 입력 폼 (화면은 만원·%, 저장은 원·비율) ────────────────────────────
  const FIELDS = [
    ['cgtReserve', 'won'], ['cashReserve', 'won'], ['pay', 'won'], ['payMax', 'won'], ['payPlusRatio', 'num'], ['payHigh', 'won'],
    ['annualIncome', 'won'], ['loanTerm', 'num'], ['loanRate', 'pct'], ['plusRate', 'pct'], ['name', 'text'], ['age', 'num'], ['targetAge', 'num'],
    ['retireNeed', 'won'], ['tempHousing', 'won'], ['deferMonths', 'num'], ['buyDate', 'text'], ['nohomeSince', 'text'], ['residence', 'text'], ['permitAfter', 'text'], ['rateType', 'text'], ['reconShareM2', 'won'], ['reconYears', 'num'], ['reconChance', 'pct'], ['postIncome', 'won'], ['downsizeHome', 'won'], ['growthAdjust', 'pct'], ['minArea', 'num'],
  ];
  const toView = (v, t) => (t === 'won' ? (v ? Math.round(v / MAN) : '') : t === 'pct' ? +(v * 100).toFixed(2) : v ?? '');
  const fromView = (s, t) => (t === 'text' ? s : t === 'won' ? (Number(s) || 0) * MAN : t === 'pct' ? (Number(s) || 0) / 100 : Number(s) || 0);
  function renderForm() {
    for (const [k, t] of FIELDS) { const el = $('p_' + k); if (el) el.value = toView(profile[k], t); }
    $('p_saveRest').checked = profile.saveRest !== false;
    const homes = (profile.homes || []).length ? profile.homes : [{ name: '', value: 0, loan: 0, loanRate: 0.03, jeonse: 0 }];
    $('homesWrap').innerHTML = homes.map((h, i) => `
      <label class="f">주택 ${i + 1} 이름<input data-h="${i}" data-k="name" type="text" value="${esc(h.name)}"></label>
      <label class="f">시세 <span class="unit">만원</span><input data-h="${i}" data-k="value" type="number" step="100" value="${h.value ? h.value / MAN : ''}"></label>
      <label class="f">대출 잔액 <span class="unit">만원</span><input data-h="${i}" data-k="loan" type="number" step="100" value="${h.loan ? h.loan / MAN : ''}"></label>
      <label class="f">전세 보증금 <span class="unit">만원 · 돌려줄 돈</span><input data-h="${i}" data-k="jeonse" type="number" step="100" value="${h.jeonse ? h.jeonse / MAN : ''}"></label>`).join('')
      + '<div class="row"><button type="button" class="ghost" id="addHome">주택 추가</button></div>';
  }
  $('myProfile').addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.h != null) {
      const i = Number(el.dataset.h), k = el.dataset.k;
      profile.homes = (profile.homes || []).slice();
      while (profile.homes.length <= i) profile.homes.push({ name: '', value: 0, loan: 0, loanRate: 0.03, jeonse: 0 });
      profile.homes[i] = { ...profile.homes[i], [k]: k === 'name' ? el.value : (Number(el.value) || 0) * MAN };
    } else {
      const f = FIELDS.find(([k]) => 'p_' + k === el.id);
      if (f) profile[f[0]] = fromView(el.value, f[1]);
      if (f && f[0] === 'cgtReserve') profile.cgtConfirmed = true; // 0원도 직접 확인한 값
      if (el.id === 'p_saveRest') profile.saveRest = el.checked;
    }
    save(KEY, profile);
    run(false);
  });
  $('myProfile').addEventListener('click', (e) => {
    if (e.target.id !== 'addHome') return;
    profile.homes = [...(profile.homes || []), { name: '', value: 0, loan: 0, loanRate: 0.03, jeonse: 0 }];
    renderForm();
  });

  // ── 시장 데이터 ─────────────────────────────────────────────────────
  const M = window.REA_MYMARKET;
  let market = null;

  // ── 카카오로 좌표·역·학교·상권 (카카오 REST 키가 있으면, 30일 캐시) ─────────
  async function kakao(path) {
    const key = (() => { try { return localStorage.getItem('rea-kakao-key') || ''; } catch (_) { return ''; } })();
    if (!key) throw new Error('no-key');
    const r = await fetch('https://dapi.kakao.com' + path, { headers: { Authorization: 'KakaoAK ' + key } });
    if (!r.ok) throw new Error('kakao ' + r.status);
    return r.json();
  }
  async function enrich(list, status) {
    const cache = load(GEOC, {});
    const fresh = (x) => x && Date.now() - x.at < 30 * 86400e3;
    let hasKey = true, k = 0;
    const queue = list.filter((c) => !fresh(cache[c.id]));
    const worker = async () => {
      while (queue.length && hasKey) {
        const c = queue.shift();
        try {
          const reg = E.region(c.regionId);
          const q = `${reg.name.replace(/^서울 /, '서울특별시 ')} ${c.dong} ${c.jibun || ''}`.trim();
          let d = (await kakao(`/v2/local/search/address.json?size=1&query=${encodeURIComponent(q)}`)).documents[0];
          if (!d) d = (await kakao(`/v2/local/search/keyword.json?size=1&query=${encodeURIComponent(reg.name + ' ' + c.name)}`)).documents[0];
          if (!d) { cache[c.id] = { at: Date.now(), none: true }; continue; }
          const at = `x=${d.x}&y=${d.y}&sort=distance`;
          const [st, sc, mt, hp] = await Promise.all([
            kakao(`/v2/local/search/category.json?category_group_code=SW8&radius=3000&size=1&${at}`),
            kakao(`/v2/local/search/category.json?category_group_code=SC4&radius=2000&size=15&${at}`),
            kakao(`/v2/local/search/category.json?category_group_code=MT1&radius=1500&size=1&${at}`),
            kakao(`/v2/local/search/category.json?category_group_code=HP8&radius=1000&size=1&${at}`),
          ]);
          const school = sc.documents.find((x) => /초등학교/.test(x.place_name));
          cache[c.id] = {
            at: Date.now(), coords: [Number(d.y), Number(d.x)],
            station: st.documents[0] ? { name: st.documents[0].place_name, m: Number(st.documents[0].distance) } : null,
            schoolM: school ? Number(school.distance) : null,
            mart: mt.meta.total_count, hospital: hp.meta.total_count,
          };
        } catch (err) { if (err.message === 'no-key') hasKey = false; }
        status(`입지 확인 중 ${++k} / ${list.length}`);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    save(GEOC, cache);
    for (const c of list) {
      const g = cache[c.id];
      if (!g || g.none) continue;
      c.coords = g.coords;
      if (g.station) { c.subwayMin = GEO.walkMinutes(g.station.m); c.stationName = g.station.name; }
      c.infra = { mart: g.mart, hospital: g.hospital, school: g.schoolM != null ? GEO.walkMinutes(g.schoolM) : null };
    }
    return hasKey;
  }

  // ── 계산·표시 ───────────────────────────────────────────────────────
  let busy = false, pending = null;
  async function run(withEnrich = true) {
    // 계산 중에 조건이 또 바뀌면 끝난 뒤 최신 조건으로 한 번 더 계산한다
    if (busy) { pending = pending || withEnrich; return; }
    busy = true;
    const status = (t) => { $('myStatus').innerHTML = t; };
    try {
      if (!hasProfile()) { renderEmpty(); return; }
      if (!market) { status('<p class="muted">서울 시장 데이터를 불러오는 중…</p>'); market = await M.load(); }
      const f = T.funds(profile);
      // 30년 넘은 단지에는 정비사업 단계와 주변 사례로 재건축 가능성·입주까지 기간이 붙어 있다
      const all = M.prepare().all;
      let evals = M.evaluateAll(profile, all);
      let res = T.classify(evals, profile, (x) => M.evaluateAll(profile, all, x));
      let enriched = false;
      if (withEnrich) {
        // 순위별 상위 후보만 입지를 확인한 뒤 다시 매긴다. 순위가 바뀌어 새로 올라온 후보가 있어 두 번 돈다
        for (let round = 0; round < 2; round++) {
          const short = [...new Set(T.topN(res, 8).flatMap((t) => t.items.map((x) => x.e.c)))];
          enriched = await enrich(short, (t) => status(`<p class="muted">${round ? '새로 올라온 후보 ' : ''}${esc(t)}</p>`));
          evals = M.evaluateAll(profile, all);
          res = T.classify(evals, profile, (x) => M.evaluateAll(profile, all, x));
          if (!enriched) break;
        }
      }
      const tiers = T.topN(res, 5);
      const planStats = { defer: 0, forced: 0, why: '' };
      for (const e of evals) { if (e.plan.mode === 'defer') planStats.defer++; else if (e.plan.forced) { planStats.forced++; planStats.why = planStats.why || e.plan.why; } }
      render(f, res, tiers, enriched, planStats);
      renderRules(res, T.topN(res, 10));
    } catch (err) {
      status(`<p>${esc(err.message)}</p>`);
    } finally {
      busy = false;
      if (pending !== null) { const w = pending; pending = null; run(w); }
    }
  }

  function renderEmpty() {
    $('myTitle').textContent = '내 맞춤 추천';
    $('myStatus').innerHTML = `<h3>내 기준이 아직 없습니다</h3>
      <p class="muted">이 기기(또는 설치된 앱)에는 조건이 저장돼 있지 않습니다. 받으신 <b>개인 설정 링크</b>를 아래에 붙여넣으면 한 번에 채워집니다. 또는 아래 '내 기준'을 직접 채우세요.</p>
      ${setupPasteHtml()}`;
    $('myTiers').innerHTML = ''; $('tierNav').innerHTML = ''; $('tierRules').hidden = true;
    $('myProfileCard').open = true;
  }

  function changeBadge(tierId, cid, rank, last) {
    if (!last || !last.tiers || !last.tiers[tierId]) return '';
    const prev = last.tiers[tierId].indexOf(cid);
    if (prev < 0) return '<span class="chip good">신규</span>';
    if (prev > rank) return `<span class="chip good">▲${prev - rank}</span>`;
    if (prev < rank) return `<span class="chip warning">▼${rank - prev}</span>`;
    return '';
  }

  // 거주 계획·대출 기준 설명 (매수 시기 기준 서울 아파트)
  function residenceHtml(f, planStats) {
    const p = profile, RS = P.RESIDENCE;
    const buy = p.buyDate || new Date().toISOString().slice(0, 7);
    const defer = p.residence === 'defer';
    const rr = COND.residenceRule({ regionId: 'seoul-강남구', buyDate: buy, nohomeSince: p.nohomeSince, tenant: defer, permitAfter: p.permitAfter });
    const b = T.bankLimit(10 * EOK, 'seoul-강남구', p, Math.max(p.targetAge - p.age, p.loanTerm || 30));
    const plan = defer ? `세입자 두고 ${p.deferMonths}개월 뒤 입주` : '바로 입주';
    let verdict = '';
    if (defer) {
      verdict = rr.deferOK
        ? `<p><span class="chip good">가능</span> ${esc(rr.why)}</p><p class="muted">수도권·규제지역 주담대는 6개월 안에 전입해야 해서, 나중에 입주하려면 매수 때 대출 없이 세입자 전세보증금을 안고 삽니다. 입주할 때 돌려줄 전세금은 그동안 살 집 전세금 + 남은 현금 + 그동안 모은 돈(월 ${manw(p.pay)})으로 내고, 모자라면 전세퇴거자금 대출(수도권 1주택자 ${won(RS.jeonseReturnCap)} 한도)과 추가 자금으로 채웁니다.</p>`
        : `<p><span class="chip critical">불가</span> ${esc(rr.why)}</p>
           <p class="muted">그래서 모든 단지를 <b>바로 입주</b>로 계산했습니다 (그동안 살 집 전세금 ${won(f.temp)}은 필요 없다고 보고 매수 자금에 넣음). 나중에 입주가 가능해지는 경우: 서울 아파트 토지거래허가가 ${RS.landPermitUntil}에 끝나 해제된 뒤 매수 — 아래 '내 기준'에서 매수 시기를 2027년 이후로, 허가 기간 뒤를 '해제된다고 보기'로 바꾸면 계산합니다 (연장 여부는 아직 정해지지 않음).</p>`;
      if (rr.deferOK && planStats) verdict += `<p class="muted">이번 주 후보 중 ${planStats.defer.toLocaleString()}곳은 나중에 입주로, ${planStats.forced.toLocaleString()}곳은 바로 입주로 계산했습니다 (전세 시세가 없거나 지금 현금이 모자란 곳).</p>`;
    } else if (rr.permit) verdict = `<p class="muted">${esc(rr.why)}</p>`;
    return `<div class="residence-box">
      <h4>거주 계획 · ${esc(plan)} · 매수 ${esc(buy)}</h4>
      ${verdict}
      <p class="muted">대출 한도: 무주택(두 채 매도 후) LTV ${Math.round(b.ltvRate * 100)}% · 주택가격별 한도 15억 이하 6억 / 25억 이하 4억 / 초과 2억 · 스트레스 DSR 40% (${esc(P.LOAN.rateTypeLabel[b.rateType])}, 스트레스 금리 +${(b.stress * 100).toFixed(1)}%p${b.dsrChecked ? `, 연소득 ${won(p.annualIncome)} → DSR 한도 약 ${won(b.dsr)}` : ', 연소득을 넣으면 확인'}). 셋 중 가장 작은 값이 한도입니다.</p>
      <p class="links">출처: ${RS.sources.map((x) => `<a href="${x.url}" target="_blank" rel="noopener">${esc(x.label)}</a>`).join(' · ')}</p>
    </div>`;
  }

  function render(f, res, tiers, enriched, planStats) {
    const p = profile;
    $('myTitle').textContent = p.name ? `${p.name} 님 맞춤 추천` : '내 맞춤 추천';
    const years = p.targetAge - p.age;
    const week = market.asOf.slice(0, 10);
    const last = load(LAST, null);
    const prevWeek = last && last.week !== week ? last : load(LAST + '-prev', null);
    $('myStatus').innerHTML = `
      <h3>이번 주 기준 · 서울 시장 ${esc(week)} 수집</h3>
      <div class="tbl-wrap"><table><tbody>
        <tr><td>두 채 순자산 (시세 − 대출 − 전세)</td><td class="n">${won(f.equity)}</td></tr>
        <tr><td>− 매도 중개보수 · 양도세 예상 · 비상금</td><td class="n">${won(-(f.sellCosts + f.cgt + f.reserve))}</td></tr>
        <tr><td><b>서울 매수에 쓸 현금</b>${f.temp ? ' (바로 입주)' : ''}</td><td class="n"><b>${won(f.cash)}</b></td></tr>
        ${f.temp ? `<tr><td>나중에 입주: 그동안 살 집 전세금 ${won(f.temp)}을 빼고 지금 쓸 현금</td><td class="n">${won(f.cashDefer)}</td></tr>` : ''}
        <tr><td>월 상환 기본 / 최대 / 2순위 / 5순위</td><td class="n">${manw(p.pay)} / ${manw(p.payMax)} / ${manw(p.pay * p.payPlusRatio)} / ${manw(p.payHigh)}</td></tr>
        <tr><td>노후 목표 (${p.targetAge}세, ${years}년 뒤)</td><td class="n">월 ${manw(p.retireNeed)} (현재 가치)</td></tr>
      </tbody></table></div>
      ${residenceHtml(f, planStats)}
      <p class="muted">서울 단지·평형 ${res.considered.toLocaleString()}곳 중 면적·입지 기본 조건을 통과한 ${res.kept.toLocaleString()}곳을 평가 · ${enriched ? '상위 후보는 카카오 지도로 역·학교·상권 확인' : '카카오 REST 키가 없어 입지는 구 중심 추정 (매수 판단기 실거래가 탭에서 키 입력)'}${prevWeek ? ` · 지난 기록(${esc(prevWeek.week)}) 대비 변동 표시` : ''}</p>
      ${p.cgtReserve || p.cgtConfirmed ? '' : '<p class="demo-note"><span class="chip warning">확인</span> 매도 양도세 예상이 0원입니다. 취득가를 알면 \'내 기준\'에 넣어 주세요. 2주택 매도는 먼저 파는 집에 양도세가 나올 수 있습니다.</p>'}`;

    $('tierNav').innerHTML = tiers.map((t) => `<a href="#${t.id}" class="pill">${esc(t.rank)} <b>${t.items.length}</b></a>`).join('');
    $('myTiers').innerHTML = tiers.map((t) => `
      <section class="tier" id="${t.id}">
        <h2><span class="tier-rank">${esc(t.rank)}</span> ${esc(t.title)}</h2>
        ${t.items.length ? t.items.map((x, k) => card(t, x, k, prevWeek)).join('') : emptyCard(t)}
      </section>`).join('') + otherCombos(f);

    // 이번 주 결과 기록 (다음 주 비교용)
    const snap = { week, tiers: Object.fromEntries(tiers.map((t) => [t.id, t.items.map((x) => x.e.c.id)])) };
    if (!last || last.week !== week) { if (last) save(LAST + '-prev', last); save(LAST, snap); } else save(LAST, snap);
  }

  // 메모의 지역으로 추천이 없을 때: 같은 조건으로 추천이 나오는 구·동
  function regionAltHtml(t) {
    if (!t.regionAlt) return '';
    const where = [...t.memo.gus, ...t.memo.dongs].join('·');
    if (!t.regionAlt.length) return `<div class="region-alt"><p><b>${esc(where)}</b>에서는 이 조건으로 추천할 곳이 없고, 지역을 빼도 이번 주에는 없습니다.</p></div>`;
    return `<div class="region-alt"><p><b>${esc(where)}</b>에서는 이번 주 이 조건으로 추천할 곳이 없습니다. 같은 조건으로 추천이 나오는 곳:</p>
      <ul class="plain">${t.regionAlt.map((g) => `<li><b>${esc(g.gu)}</b> ${g.n}곳 — ${g.dongs.map((d) => `${esc(d.dong)} ${d.n}`).join(', ')}</li>`).join('')}</ul>
      <p class="muted">메모의 지역을 바꾸거나, 그대로 두면 이 지역에서 조건에 맞는 곳이 나올 때 추천합니다 (매주 다시 계산).</p></div>`;
  }

  function emptyCard(t) {
    const n = t.nearest;
    if (t.regionAlt) return `<div class="card">${regionAltHtml(t)}</div>`;
    return `<div class="card"><p>이번 주 조건에 맞는 곳이 없습니다.</p>
      ${n ? `<p class="muted">노후 기준만 빼면 가장 가까운 곳: ${esc(E.region(n.regionId).name)} ${esc(n.name)} (${won(n.price)}) — 노후 월소득 ${manw(n.monthly)}, 목표의 ${Math.round(n.value * 100)}%</p>` : '<p class="muted">자금·상환 조건을 만족하는 단지 자체가 없습니다.</p>'}
    </div>`;
  }

  // 검토했지만 순위에서 뺀 조합 (내 자금으로 계산)
  function otherCombos(f) {
    const p = profile, homes = p.homes || [];
    if (homes.length < 2) return '';
    const keep = homes[homes.length - 1], sell = homes.slice(0, -1);
    const cashSellOne = sell.reduce((s, h) => s + h.value - h.loan - (h.jeonse || 0) - E.brokerFee(h.value, 'sale', true), 0) - p.cashReserve;
    const maxKeep = cashSellOne / (1 + 0.08 + 0.004 + 0.012); // 2주택 취득세 8%·지방교육세·중개·등기, 규제지역 2주택 대출 0
    return `<div class="card"><h3>검토했지만 뺀 조합</h3><ul class="plain">
      <li><b>${esc(keep.name || '한 채')} 유지 + 서울 1채 (2주택)</b>: 서울은 규제지역이라 2주택자 주담대가 0원이고 취득세가 8%로 무거워, 쓸 수 있는 현금 ${won(cashSellOne)}로 살 수 있는 서울 집이 약 ${won(maxKeep)} 이하입니다. 1순위보다 입지·미래가치가 낮아 뺐습니다.</li>
      <li><b>서울 전세 낀 매수 (나중에 입주)</b>: 서울 아파트는 토지거래허가구역(${P.RESIDENCE.landPermitUntil}까지)이라 허가 후 ${P.RESIDENCE.registerMonths}개월 안에 입주해야 합니다. 세입자 있는 집의 입주 유예는 ${P.RESIDENCE.defer.nohomeSince}부터 계속 무주택인 사람만 받을 수 있어, 지금 집을 가진 상태에서는 해당되지 않습니다. 허가가 해제된 뒤라면 매수 때 대출 없이 전세보증금을 안고 사는 방식으로 가능합니다 ('거주 계획'에서 계산).</li>
      <li><b>서울 먼저 사고 나중에 팔기 (일시적 2주택)</b>: 처분 조건부 대출도 LTV 40%라 한도는 같고, 기한 안에 못 팔면 대출 회수·양도세 위험이 있습니다. 순위는 같고 매도 순서만 다릅니다.</li>
    </ul></div>`;
  }

  // 정비사업 단계·주변 사례·공식 출처 링크와 단지별 가정 고치기
  function redevBlock(c, e, used) {
    const r = c.redev, pr = r.project, ov = (profile.reconOverrides || {})[c.id] || {};
    const A = T.reconAssume(c, profile);
    const cafe = pr && pr.cafe ? `https://cleanup.seoul.go.kr/cafe/mainIndx.do?cafeUrl=${encodeURIComponent(pr.cafe)}` : '';
    const map = pr && pr.rec ? `https://urban.seoul.go.kr/view/map/mapPopup.html?recordCode=${encodeURIComponent(pr.rec)}` : '';
    const search = 'https://cleanup.seoul.go.kr/cleanup/bsnssttus/lscrMainIndx.do';
    const fact = pr
      ? `<b>정비사업 정보몽땅:</b> ${esc(pr.name)} · <b>${esc(pr.stageText || '단계 미상')}</b>${r.done ? ' (사업 완료)' : ''}`
      : '<b>정비사업 정보몽땅:</b> 이 단지로 등록된 재건축 사업이 없습니다 (사업 시작 전이거나 이름·지번이 달라 못 찾았을 수 있음)';
    const basis = r.done ? '' : pr
      ? `주변 사례: ${esc(r.scope)} 재건축 ${r.reached}곳이 이 단계까지 왔고 그중 ${r.doneN}곳이 준공·해산까지 끝남 → 서울 전체 비율로 보정해 성사 가능성 약 ${Math.round(r.chance * 100)}% · 이 단계부터 입주까지 보통 ${r.years}년`
      : `주변 사례: ${esc(r.scope)} 30년 넘은 단지 중 정비사업에 등록된 비율 ${Math.round((r.startRate || 0) * 100)}% × 추진위 단계 이후 완료 비율 → 성사 가능성 약 ${Math.round(r.chance * 100)}% · 입주까지 보통 ${r.years}년`;
    return `<div class="redev-box">
      <p>${fact}</p>
      ${basis ? `<p class="muted">${basis}</p>` : ''}
      ${used ? '' : '<p class="muted">이 순위는 바로 입주 기준이라 재건축 가치를 넣지 않습니다. 고친 값은 2순위·5순위·추가 A 계산에 반영됩니다.</p>'}
      <p class="links">사실 확인: ${cafe ? `<a href="${cafe}" target="_blank" rel="noopener">조합 공개 페이지(공지·총회·분담금 자료)</a> · ` : ''}${map ? `<a href="${map}" target="_blank" rel="noopener">서울 도시계획 지도(정비구역)</a> · ` : ''}<a href="${search}" target="_blank" rel="noopener">정비사업 정보몽땅에서 검색</a></p>
      <details class="redev-edit"${ov.chance != null || ov.years != null || ov.shareM2 != null ? ' open' : ''}>
        <summary>이 단지 가정 고치기 <span class="muted">(지금: ${esc(A.source)} · 가능성 ${Math.round(A.chance * 100)}% · 입주까지 ${A.years}년 · 분담금 ㎡당 ${Math.round(A.shareM2 / MAN)}만원)</span></summary>
        <div class="redev-form" data-cid="${esc(c.id)}">
          <label>성사 가능성 %<input type="number" step="5" data-ov="chance" value="${ov.chance != null ? Math.round(ov.chance * 100) : ''}" placeholder="${Math.round(A.chance * 100)}"></label>
          <label>입주까지 년<input type="number" step="1" data-ov="years" value="${ov.years ?? ''}" placeholder="${A.years}"></label>
          <label>분담금 만원/㎡<input type="number" step="50" data-ov="shareM2" value="${ov.shareM2 != null ? Math.round(ov.shareM2 / MAN) : ''}" placeholder="${Math.round(A.shareM2 / MAN)}"></label>
          <button type="button" class="ghost" data-ov-reset>되돌리기</button>
        </div>
        <p class="muted">조합 공개 페이지의 총회 자료·관리처분계획에서 분담금과 일정을 확인해 넣으면 이 단지 계산에 바로 반영됩니다. 비우면 추정값을 씁니다.</p>
      </details>
    </div>`;
  }
  $('myTiers').addEventListener('change', (e) => {
    const el = e.target.closest('[data-ov]'); if (!el) return;
    const cid = el.closest('[data-cid]').dataset.cid, k = el.dataset.ov, v = el.value.trim();
    const all = { ...(profile.reconOverrides || {}) }, o = { ...(all[cid] || {}) };
    if (v === '') delete o[k]; else o[k] = k === 'chance' ? Math.max(0, Math.min(100, Number(v))) / 100 : k === 'shareM2' ? Number(v) * MAN : Number(v);
    if (Object.keys(o).length) all[cid] = o; else delete all[cid];
    profile.reconOverrides = all; save(KEY, profile); run(false);
  });
  $('myTiers').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ov-reset]'); if (!b) return;
    const cid = b.closest('[data-cid]').dataset.cid, all = { ...(profile.reconOverrides || {}) };
    delete all[cid]; profile.reconOverrides = all; save(KEY, profile); run(false);
  });

  // ── 나의 순위 조건: 메모(내가 적은 문장)와 실제 계산에 쓰는 조건 ─────────────
  const LOAN_LABEL = { none: '대출 없이', bank: '은행 대출만', plus: '은행 + 추가 자금', need: '대출 필요 (방식 무관)', any: '상관없음' };
  let openRank = null; // 순위를 누르면 바로 아래에 그 순위 추천 목록
  function miniList(t) {
    if (!t.items.length) return regionAltHtml(t) || '<p class="muted">이번 주 이 조건에 맞는 곳이 없습니다.</p>';
    return `<ol class="mini-reco">${t.items.map((x, k) => {
      const e = x.e, c = x.e.c;
      return `<li><a href="#${t.id}" data-goto="${t.id}"><span class="rank">${k + 1}</span><span class="mr-name"><b>${esc(c.name)}</b> <span class="muted">${esc(E.region(c.regionId).name.replace(/^서울 /, ''))} ${esc(c.dong)} · 전용 ${c.area}㎡</span></span>
        <span class="mr-num">${won(c.price)} · ${e.loan + e.plus > 0 ? `월 ${manw(e.payTotal)}` : '대출 없음'} · 노후 ${Math.round(x.value * 100)}% · ${x.score}점</span></a></li>`;
    }).join('')}</ol>`;
  }
  function renderRules(res, tiers10) {
    const R = T.rulesFor(profile);
    const box = $('tierRules');
    box.hidden = false;
    box.innerHTML = `<h3>나의 순위 조건</h3>
      <p class="muted">'내 여유자금'에 추가로 동원할 수 있는 내 돈(예금·가족 지원 등, 갚지 않는 돈)을 넣으면 그 순위만 그만큼 현금을 늘려 다시 찾습니다. 순위마다 메모에 원하는 조건을 적으면 지역(구·동·강남3구 등)·가격(15억 이하)·평형(30평대)·연식(신축·준공 15년 이내)·역세권을 읽어 추천 조건으로 씁니다. 아래 칸으로 대출 방식·월 상환·노후 목표를 바꿉니다. 순위 버튼을 누르면 그 순위 추천이 바로 아래에 나옵니다.</p>
      ${T.TIERS.map((t) => {
        const r = R[t.id], full = res.tiers.find((x) => x.id === t.id) || { items: [], memo: { labels: [] } };
        const shown = (tiers10 || []).find((x) => x.id === t.id) || full;
        const n = full.items.length, open = openRank === t.id;
        return `<div class="rule-row${open ? ' open' : ''}" data-rule="${t.id}">
          <button type="button" class="rule-rank${r.custom ? ' custom' : ''}" data-rank-toggle aria-expanded="${open}">${esc(t.rank)}<small>${n.toLocaleString()}</small></button>
          <div class="rule-body">
            <textarea data-rk="comment" rows="2" placeholder="${esc(t.title)}">${esc(r.comment)}</textarea>
            ${full.memo.labels.length ? `<div class="memo-chips"><span class="muted">메모에서 읽은 조건</span>${full.memo.labels.map((l) => `<span class="chip">${esc(l)}</span>`).join('')}</div>` : ''}
            <div class="rule-ctl">
              <label>대출<select data-rk="loan">${Object.entries(LOAN_LABEL).map(([k, v]) => `<option value="${k}"${r.loan === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
              <label>월 상환 한도 (만원)<input type="number" step="10" min="0" data-rk="pay" value="${r.pay == null ? '' : Math.round(r.pay / MAN)}" placeholder="제한 없음"></label>
              <label>노후 목표 (%)<input type="number" step="10" min="0" max="1000" data-rk="minPct" value="${r.minPct}"></label>
              <label>내 여유자금 (만원)<input type="number" step="500" min="0" data-rk="extra" value="${r.extra ? Math.round(r.extra / MAN) : ''}" placeholder="없음"></label>
              <span class="chk"><input type="checkbox" data-rk="recon"${r.recon ? ' checked' : ''} id="rc-${t.id}"><label for="rc-${t.id}" style="display:inline;color:inherit;font-size:13px">재건축 기대 반영</label></span>
              ${r.custom ? '<button type="button" class="reset" data-rule-reset>기본값</button>' : ''}
            </div>
            <span class="rule-count">이번 주 조건에 맞는 곳 ${n.toLocaleString()}곳${full.regionAlt ? ' · 지역 조건 때문에 없음' : ''}</span>
          </div>
          <div class="rule-list"${open ? '' : ' hidden'}>${open ? miniList(shown) : ''}</div>
        </div>`;
      }).join('')}`;
    lastRules = { res, tiers10 };
  }
  let lastRules = null;
  // 메모 칸은 글 길이에 맞춰 높이를 늘린다
  const grow = (ta) => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 2 + 'px'; };
  $('tierRules').addEventListener('input', (e) => { if (e.target.matches('textarea')) grow(e.target); });
  new MutationObserver(() => $('tierRules').querySelectorAll('textarea').forEach(grow)).observe($('tierRules'), { childList: true });
  // 값 검증: 범위 밖은 보정 (정밀한 계산이 깨지지 않게)
  function ruleValue(k, el) {
    if (k === 'comment') return el.value.slice(0, 500);
    if (k === 'loan') return LOAN_LABEL[el.value] ? el.value : undefined;
    if (k === 'recon') return el.checked;
    const v = el.value.trim();
    if (v === '') return k === 'pay' ? null : undefined;
    const n = Number(v);
    if (!isFinite(n)) return undefined;
    if (k === 'pay') return Math.max(0, Math.min(1e4, n)) * MAN; // 월 1억원 이하
    if (k === 'minPct') return Math.max(0, Math.min(1000, n));
    if (k === 'extra') return n > 0 ? Math.min(1e6, n) * MAN : undefined; // 100억원 이하, 0이면 없음
    return undefined;
  }
  $('tierRules').addEventListener('change', (e) => {
    const el = e.target.closest('[data-rk]'); if (!el) return;
    const id = el.closest('[data-rule]').dataset.rule, k = el.dataset.rk;
    const all = { ...(profile.tierRules || {}) }, o = { ...(all[id] || {}) };
    const v = ruleValue(k, el);
    if (v === undefined) delete o[k]; else o[k] = v;
    all[id] = o; profile.tierRules = all; save(KEY, profile);
    run(true); // 조건이나 메모(지역·가격 등)가 바뀌면 전체 재평가 + 새 후보 입지 확인
  });
  $('tierRules').addEventListener('click', (e) => {
    const tg = e.target.closest('[data-rank-toggle]');
    if (tg) {
      const id = tg.closest('[data-rule]').dataset.rule;
      openRank = openRank === id ? null : id;
      if (lastRules) renderRules(lastRules.res, lastRules.tiers10);
      return;
    }
    if (!e.target.closest('[data-rule-reset]')) return;
    const id = e.target.closest('[data-rule]').dataset.rule;
    const all = { ...(profile.tierRules || {}) }, keep = all[id] && all[id].comment ? { comment: all[id].comment } : null;
    if (keep) all[id] = keep; else delete all[id];
    profile.tierRules = all; save(KEY, profile); run(true);
  });

  function card(t, x, k, prevWeek) {
    const e = x.e, c = e.c, p = profile, reg = E.region(c.regionId);
    const age = c.builtYear ? new Date().getFullYear() - c.builtYear : null;
    const useRecon = !!t.rule.recon;
    const v60 = useRecon ? e.v60r : e.v60;
    const ret = T.retFor(t.rule, e);
    const ratio = x.value;
    const cautions = T.cautions(e, p);
    const map = `https://map.kakao.com/?q=${encodeURIComponent(reg.name + ' ' + c.name)}`;
    return `<div class="card reco-card">
      <div class="reco-head">
        <span class="rank">${k + 1}</span>
        <div class="reco-title"><h3>${esc(c.name)} <span class="unit">전용 ${c.area}㎡ (${Math.round(c.area / 3.3058 * 1.3)}평형대)</span> ${changeBadge(t.id, c.id, k, prevWeek)}</h3>
          <p class="muted">${esc(reg.name)} ${esc(c.dong)}${c.builtYear ? ` · ${c.builtYear}년 준공 (${age}년차)` : ''} · 최근 6개월 거래 ${c.count}건</p></div>
        <span class="reco-score" data-tone="${x.score >= 70 ? 'good' : x.score >= 55 ? 'warning' : 'critical'}"><b>${x.score}</b>점수</span>
      </div>
      <div class="tbl-wrap"><table><tbody>
        <tr><td>실거래 중위</td><td class="n">${won(c.price)}${c.jeonse ? ` · 전세 ${won(c.jeonse)}` : ''}</td></tr>
        <tr><td>취득 비용 (세금·중개·등기)</td><td class="n">${won(e.costs)}</td></tr>
        ${e.extraCash > 0 ? `<tr><td>이 순위에 더한 내 여유자금</td><td class="n">${won(e.extraCash)}</td></tr>` : ''}
        ${e.plan.mode === 'defer' ? `<tr><td>거주 계획: 세입자 두고 ${e.plan.startMonths}개월 뒤 입주</td><td class="n">지금 현금 ${won(e.plan.cashNow)} (전세 ${won(e.plan.J)} 안고 매수${e.plan.loanNow ? ` · 대출 ${won(e.plan.loanNow)}` : ''})</td></tr>
        <tr><td>입주 때 전세금 ${won(e.plan.J)} 돌려주기</td><td class="n">모은 돈 ${won(Math.min(e.plan.fundsAt, e.plan.J))}${e.plan.loanLate ? ` + 전세퇴거자금 대출 ${won(e.plan.loanLate)}` : ''}${e.plus ? ` + 추가 자금 ${won(e.plus)}` : ''}</td></tr>` : ''}
        ${e.loan + e.plus > 0 ? `<tr><td>${e.plan.mode === 'defer' ? '대출 합계 / 추가 자금' : '은행 대출 / 추가 자금'}</td><td class="n">${won(e.loan)}${e.plus ? ` / ${won(e.plus)}` : ''}${e.plan.mode === 'now' && e.loan ? ` <span class="muted">(한도 ${won(e.bank.amount)} · ${esc(e.bank.by)})</span>` : ''}</td></tr>
        <tr><td>월 상환 (${e.term}년 만기${e.plan.mode === 'defer' ? ', 입주 뒤부터' : ''})</td><td class="n">${manw(e.payTotal)}</td></tr>
        ${e.debt60 > 0 ? `<tr><td>${p.targetAge}세에 남는 대출 (집 팔아 상환)</td><td class="n">${won(e.debt60)}</td></tr>` : ''}` : `<tr><td>대출 없이 남는 돈</td><td class="n">${won(e.leftover)}</td></tr>`}
        ${e.saveMonthly > 0 ? `<tr><td>상환 여유분 저축 (월 ${manw(e.saveMonthly)}, 연 ${pct(p.cashReturn, 1)})</td><td class="n">${p.targetAge}세 ${won(e.save60)}</td></tr>` : ''}
        <tr><td>예상 연 상승률 (${esc(e.growth.basis)}${useRecon && e.recon && !e.rebuild ? ' + 재건축 0.7%p' : ''})</td><td class="n">${pct(useRecon ? e.gRecon : e.growth.g)}</td></tr>
        ${useRecon && e.rebuild ? `<tr><td>재건축 뒤 (같은 동 신축 ${e.rebuild.peers}곳 ㎡당가 기준)</td><td class="n">지금 신축이면 ${won(e.rebuild.nowNew)} (현재가 대비 ${e.rebuild.premium >= 0 ? '+' : ''}${Math.round(e.rebuild.premium * 100)}%) · 분담금 −${won(e.rebuild.share)} · 성사 가능성 ${Math.round(e.rebuild.chance * 100)}% 반영</td></tr>
        <tr><td>${p.targetAge}세 재건축 뒤 예상 범위 (±15%)</td><td class="n">${won(e.rebuild.low)} ~ ${won(e.rebuild.high)}</td></tr>` : ''}
        <tr><td>${p.targetAge}세 예상 시세${e.debt60 > 0 ? ' → 대출 갚고 남는 돈' : ''}</td><td class="n">${won(v60)}${e.debt60 > 0 ? ` → ${won(v60 - e.debt60)}` : ''}</td></tr>
        <tr><td>노후 월소득 (현재 가치, ${esc(ret.method)}${t.rule.cash ? ' + 남는 돈 운용' : ''}${t.rule.homeOnly ? ', 저축 제외' : ret.extraReal > 0 ? ' + 저축' : ''})</td><td class="n"><b>${manw(ret.monthly)}</b> · 목표의 ${Math.round(ratio * 100)}%</td></tr>
        <tr><td>입지 점수 ${e.loc.estimated ? '(추정)' : ''}</td><td class="n">${e.loc.score}점${e.loc.commute != null ? ` · 업무지구 약 ${e.loc.commute}분` : ''}${c.subwayMin != null ? ` · ${esc(c.stationName || '역')} 도보 ${c.subwayMin}분` : ''}</td></tr>
        ${c.infra ? `<tr><td>상권·생활</td><td class="n">대형마트 ${c.infra.mart}곳(1.5km) · 병원 ${c.infra.hospital}곳(1km)${c.infra.school != null ? ` · 초등학교 도보 ${c.infra.school}분` : ''}</td></tr>` : ''}
      </tbody></table></div>
      ${c.redev ? redevBlock(c, e, useRecon) : ''}
      ${cautions.length ? `<ul class="cons">${cautions.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
      <div class="row"><a class="map-btn" href="${map}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.2c-4 0-7.2 3.1-7.2 7 0 5.2 7.2 12.6 7.2 12.6s7.2-7.4 7.2-12.6c0-3.9-3.2-7-7.2-7z" fill="#191919"/><circle cx="12" cy="9.3" r="2.8" fill="#fee500"/></svg>카카오맵에서 보기</a></div>
    </div>`;
  }

  $('myMethod').innerHTML = [
    '두 채를 모두 판 순자산에서 매도 중개보수·양도세 예상·비상금을 빼고, 서울 아파트 취득 비용(취득세·중개보수·등기)을 더해 모자라는 돈을 계산합니다.',
    '은행 대출은 서울(규제지역) 무주택 기준 LTV 40%, 주택가격별 한도(15억 이하 6억 · 25억 이하 4억 · 초과 2억), 연소득을 넣으면 스트레스 DSR(수도권 하한 3%p × 금리 유형 반영비율, 기본 주기형 40%, 만기 30년 상한)까지 적용해 셋 중 가장 작은 값을 한도로 봅니다.',
    '거주 계획이 \'나중에 입주\'면 세입자 전세보증금을 안고 대출 없이 사고, 입주할 때 그동안 살 집 전세금·남은 현금·모은 돈과 전세퇴거자금 대출(1억 한도)로 전세금을 돌려준다고 계산합니다. 서울 아파트는 토지거래허가구역이라 2026-05-12부터 계속 무주택인 사람만 입주를 미룰 수 있고, 아니면 바로 입주로 계산합니다.',
    '순위 메모에 적은 지역·가격·평형·연식·역세권은 그 순위의 조건이 됩니다. 그 지역에 추천이 없으면 같은 조건으로 추천이 나오는 구·동을 안내합니다.',
    '대출은 만기(기본 30년)로 매달 갚다가, 60세에 남은 대출은 집을 팔아 한 번에 갚고 후순위 지역의 작은 집으로 옮긴다고 봅니다. 노후 자금 = 60세 시세 − 남은 대출 − 옮겨 살 집 + 상환 여유분 저축.',
    '상환 여유분 저축: 월 상환 기본 한도에서 실제 상환액을 뺀 나머지를 매달 연 3%로 모은다고 봅니다 (대출 없는 3·4순위는 기본 한도 전액). 내 기준에서 끌 수 있습니다.',
    '은행 한도를 넘는 돈은 추가 자금(가족 차입·개인 근저당 등)으로 보고 같은 기간 상환으로 계산합니다.',
    '미래 시세는 단지(40%)·같은 동(40%)·구(20%)의 과거 5년·10년 ㎡당 연평균 상승률을 섞은 뒤 보수적으로 1.5%p 낮추고, 연 5.5%를 넘지 않게 합니다. 서울 실거래 검증에서 같은 동 상승률을 쓰면 5년 뒤 시세 오차가 5%로, 구 상승률(10%)보다 잘 맞았습니다.',
    '재건축 가능성: 30년 넘은 단지를 서울 정비사업 정보몽땅 사업장과 같은 동·대표 지번·이름으로 짝지어 실제 단계를 붙입니다. 성사 가능성은 같은 구 재건축 사업 중 그 단계까지 온 곳이 준공·해산까지 끝난 비율(사례가 적으면 서울 비율로 보정), 입주까지 기간은 단계별 평균입니다. 사업이 없으면 같은 구 30년 넘은 단지의 사업 등록 비율을 곱합니다. 카드의 조합 공개 페이지·도시계획 지도 링크로 사실을 확인하고, 단지별로 가능성·기간·분담금을 고칠 수 있습니다.',
    '30년 넘은 단지(2순위·5순위·추가 A): 재건축 뒤 시세 = 같은 동 준공 15년 이내 신축의 ㎡당가 × 면적(현재가의 2배 상한) − 분담금(입주까지 물가만큼 증가). 오르는 몫은 성사 가능성(단지별 추정, 없으면 기본 60%)만큼만 인정합니다. 주상복합·소규모 단지·60세 이후 입주는 넣지 않습니다. 검증에서 신축은 같은 동 준신축 시세에 오차 중앙값 12%, 편향 거의 0으로 맞춰졌지만, 구축이 재건축되기까지의 기간·분담금·성사 여부는 공공데이터로 검증할 수 없는 가정입니다.',
    '노후 월소득은 60세 시세를 현재 가치로 바꾼 뒤, 집을 줄여 옮기고 차액을 연 4%로 쓰는 경우와 주택연금 중 큰 값입니다. 국민연금·퇴직연금은 넣지 않았습니다.',
    '입지(교통·상권·인프라) 45점 미만은 모든 순위에서 뺍니다. 한 단지는 가장 높은 순위에 한 번만 나옵니다.',
    '서울 시장 데이터는 매주 월요일 국토부 실거래가(최근 6개월 매매·전월세, 5·10년 전 매매)로 새로 모읍니다. 이 페이지를 열 때마다 최신 데이터로 다시 계산합니다.',
  ].map((s) => `<li>${esc(s)}</li>`).join('');

  renderForm();
  run(true);
  // 내 기준 카드 안에도 붙여넣기 칸 (다른 기기 조건으로 덮어쓰기)
  (function () {
    const w = document.getElementById('setupPasteWrap');
    if (w) w.innerHTML = '<details class="setup-more"><summary>개인 설정 링크로 다시 채우기</summary>' + '<p class="muted">붙여넣으면 지금 기준을 링크 내용으로 바꿉니다.</p>' + '<div class="setup-slot"></div></details>';
    w && w.addEventListener('toggle', () => {
      const slot = w.querySelector('.setup-slot');
      if (slot && !slot.innerHTML && !document.getElementById('setupPaste')) slot.innerHTML = setupPasteHtml();
    }, true);
  })();
})();
