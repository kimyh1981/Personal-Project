/*
 * 내 맞춤 추천 화면. 개인 조건은 localStorage에만 두고, 서울 시장 데이터(data/market-seoul.json)로 순위를 계산한다.
 * 처음 설정: my.html#setup=<base64url JSON> 링크로 열면 조건을 저장하고 주소에서 지운다 (서버로 전송되지 않음).
 */
(function () {
  const E = window.REA, P = window.REA_POLICY, T = window.REA_TIERS, GEO = window.REA_GEO;
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
  function readSetupHash() {
    const m = location.hash.match(/setup=([A-Za-z0-9_-]+)/);
    if (!m) return null;
    try {
      const json = decodeURIComponent(escape(atob(m[1].replace(/-/g, '+').replace(/_/g, '/'))));
      const p = JSON.parse(json);
      history.replaceState(null, '', location.pathname); // 주소에서 지운다
      return p;
    } catch (_) { return null; }
  }
  let profile = { ...T.DEFAULTS, ...(load(KEY, {})) };
  const fromLink = readSetupHash();
  if (fromLink) { profile = { ...T.DEFAULTS, ...fromLink }; save(KEY, profile); }
  const hasProfile = () => (profile.homes || []).length > 0;

  // ── 입력 폼 (화면은 만원·%, 저장은 원·비율) ────────────────────────────
  const FIELDS = [
    ['cgtReserve', 'won'], ['cashReserve', 'won'], ['pay', 'won'], ['payMax', 'won'], ['payPlusRatio', 'num'], ['payHigh', 'won'],
    ['annualIncome', 'won'], ['loanRate', 'pct'], ['plusRate', 'pct'], ['name', 'text'], ['age', 'num'], ['targetAge', 'num'],
    ['retireNeed', 'won'], ['postIncome', 'won'], ['downsizeHome', 'won'], ['growthAdjust', 'pct'], ['minArea', 'num'],
  ];
  const toView = (v, t) => (t === 'won' ? (v ? Math.round(v / MAN) : '') : t === 'pct' ? +(v * 100).toFixed(2) : v ?? '');
  const fromView = (s, t) => (t === 'text' ? s : t === 'won' ? (Number(s) || 0) * MAN : t === 'pct' ? (Number(s) || 0) / 100 : Number(s) || 0);
  function renderForm() {
    for (const [k, t] of FIELDS) { const el = $('p_' + k); if (el) el.value = toView(profile[k], t); }
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
  let market = null;
  async function loadMarket() {
    const r = await fetch('data/market-seoul.json', { cache: 'no-store' });
    if (!r.ok) throw new Error('서울 시장 데이터가 아직 없습니다 (매주 자동 수집)');
    market = await r.json();
    return market;
  }
  function candidates() {
    const cols = market.cols;
    return market.cands.map((row) => {
      const o = Object.fromEntries(cols.map((c, i) => [c, row[i]]));
      return { id: `${o.r}|${o.n}|${o.d}|${Math.round(o.a)}`, regionId: o.r, name: o.n, dong: o.d, jibun: o.j, area: o.a, price: o.p, jeonse: o.je, count: o.c, builtYear: o.y, g5: o.g5, g10: o.g10 };
    });
  }

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
  let busy = false;
  async function run(withEnrich = true) {
    if (busy) return; busy = true;
    const status = (t) => { $('myStatus').innerHTML = t; };
    try {
      if (!hasProfile()) { renderEmpty(); return; }
      if (!market) { status('<p class="muted">서울 시장 데이터를 불러오는 중…</p>'); await loadMarket(); }
      const f = T.funds(profile);
      const all = candidates();
      let evals = all.map((c) => T.evaluate(c, profile, market.regions[c.regionId], f));
      let res = T.classify(evals, profile);
      let enriched = false;
      if (withEnrich) {
        // 순위별 상위 후보만 입지를 확인한 뒤 다시 매긴다. 순위가 바뀌어 새로 올라온 후보가 있어 두 번 돈다
        for (let round = 0; round < 2; round++) {
          const short = [...new Set(T.topN(res, 8).flatMap((t) => t.items.map((x) => x.e.c)))];
          enriched = await enrich(short, (t) => status(`<p class="muted">${round ? '새로 올라온 후보 ' : ''}${esc(t)}</p>`));
          evals = all.map((c) => T.evaluate(c, profile, market.regions[c.regionId], f));
          res = T.classify(evals, profile);
          if (!enriched) break;
        }
      }
      const tiers = T.topN(res, 5);
      render(f, res, tiers, enriched);
    } catch (err) {
      status(`<p>${esc(err.message)}</p>`);
    } finally { busy = false; }
  }

  function renderEmpty() {
    $('myTitle').textContent = '내 맞춤 추천';
    $('myStatus').innerHTML = `<h3>내 기준이 아직 없습니다</h3>
      <p class="muted">받으신 <b>개인 설정 링크</b>로 한 번 열면 조건이 이 기기에 저장됩니다. 또는 아래 '내 기준'을 직접 채우세요.</p>`;
    $('myTiers').innerHTML = ''; $('tierNav').innerHTML = '';
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

  function render(f, res, tiers, enriched) {
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
        <tr><td><b>서울 매수에 쓸 현금</b></td><td class="n"><b>${won(f.cash)}</b></td></tr>
        <tr><td>월 상환 기본 / 최대 / 2순위 / 5순위</td><td class="n">${manw(p.pay)} / ${manw(p.payMax)} / ${manw(p.pay * p.payPlusRatio)} / ${manw(p.payHigh)}</td></tr>
        <tr><td>노후 목표 (${p.targetAge}세, ${years}년 뒤)</td><td class="n">월 ${manw(p.retireNeed)} (현재 가치)</td></tr>
      </tbody></table></div>
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

  function emptyCard(t) {
    const n = t.nearest;
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
      <li><b>서울 전세 낀 매수 (갭)</b>: 서울 아파트는 토지거래허가구역이라 허가 후 2년 실거주 의무가 있어 불가합니다. 입주를 늦추려면 재건축 연한 단지를 사서 살다가 이주하는 방식(2순위·추가 A)만 가능합니다.</li>
      <li><b>서울 먼저 사고 나중에 팔기 (일시적 2주택)</b>: 처분 조건부 대출도 LTV 40%라 한도는 같고, 기한 안에 못 팔면 대출 회수·양도세 위험이 있습니다. 순위는 같고 매도 순서만 다릅니다.</li>
    </ul></div>`;
  }

  function card(t, x, k, prevWeek) {
    const e = x.e, c = e.c, p = profile, reg = E.region(c.regionId);
    const age = c.builtYear ? new Date().getFullYear() - c.builtYear : null;
    const useRecon = ['t2', 't5', 'xa'].includes(t.id);
    const v60 = useRecon ? e.v60r : e.v60;
    const ret = t.id === 'xb' ? e.retCash : useRecon ? e.retRecon : e.ret;
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
        ${e.need > 0 ? `<tr><td>은행 대출 / 추가 자금</td><td class="n">${won(e.loan)}${e.plus ? ` / ${won(e.plus)}` : ''}</td></tr>
        <tr><td>월 상환 (${e.years}년, 60세 완납)</td><td class="n">${manw(e.payTotal)}</td></tr>` : `<tr><td>대출 없이 남는 돈</td><td class="n">${won(e.leftover)}</td></tr>`}
        <tr><td>예상 연 상승률 (${esc(e.growth.basis)}${useRecon && e.recon ? ' + 재건축' : ''})</td><td class="n">${pct(useRecon ? e.gRecon : e.growth.g)}</td></tr>
        <tr><td>${p.targetAge}세 예상 시세</td><td class="n">${won(v60)}</td></tr>
        <tr><td>노후 월소득 (현재 가치, ${esc(ret.method)}${t.id === 'xb' ? ' + 남는 돈 운용' : ''})</td><td class="n"><b>${manw(ret.monthly)}</b> · 목표의 ${Math.round(ratio * 100)}%</td></tr>
        <tr><td>입지 점수 ${e.loc.estimated ? '(추정)' : ''}</td><td class="n">${e.loc.score}점${e.loc.commute != null ? ` · 업무지구 약 ${e.loc.commute}분` : ''}${c.subwayMin != null ? ` · ${esc(c.stationName || '역')} 도보 ${c.subwayMin}분` : ''}</td></tr>
        ${c.infra ? `<tr><td>상권·생활</td><td class="n">대형마트 ${c.infra.mart}곳(1.5km) · 병원 ${c.infra.hospital}곳(1km)${c.infra.school != null ? ` · 초등학교 도보 ${c.infra.school}분` : ''}</td></tr>` : ''}
      </tbody></table></div>
      ${cautions.length ? `<ul class="cons">${cautions.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
      <div class="row"><a class="ghost btn" href="${map}" target="_blank" rel="noopener">지도에서 보기</a></div>
    </div>`;
  }

  $('myMethod').innerHTML = [
    '두 채를 모두 판 순자산에서 매도 중개보수·양도세 예상·비상금을 빼고, 서울 아파트 취득 비용(취득세·중개보수·등기)을 더해 모자라는 돈을 계산합니다.',
    '은행 대출은 서울(규제지역) 무주택 기준 LTV 40%, 주택가격별 한도(15억 이하 6억 · 25억 이하 4억 · 초과 2억), 연소득을 넣으면 스트레스 DSR까지 적용합니다. 60세에 다 갚는 기간으로 월 상환을 계산합니다.',
    '은행 한도를 넘는 돈은 추가 자금(가족 차입·개인 근저당 등)으로 보고 같은 기간 상환으로 계산합니다.',
    '미래 시세는 단지와 구의 과거 5년·10년 ㎡당 연평균 상승률을 섞은 뒤 보수적으로 1.5%p 낮추고, 연 5.5%를 넘지 않게 합니다. 30년 넘은 단지는 재건축 기대를 2순위·5순위·추가 A에서만 0.7%p 더합니다.',
    '노후 월소득은 60세 시세를 현재 가치로 바꾼 뒤, 집을 줄여 옮기고 차액을 연 4%로 쓰는 경우와 주택연금 중 큰 값입니다. 국민연금·퇴직연금은 넣지 않았습니다.',
    '입지(교통·상권·인프라) 45점 미만은 모든 순위에서 뺍니다. 한 단지는 가장 높은 순위에 한 번만 나옵니다.',
    '서울 시장 데이터는 매주 월요일 국토부 실거래가(최근 6개월 매매·전월세, 5·10년 전 매매)로 새로 모읍니다. 이 페이지를 열 때마다 최신 데이터로 다시 계산합니다.',
  ].map((s) => `<li>${esc(s)}</li>`).join('');

  renderForm();
  run(true);
})();
