/*
 * 판정의 '미래 그림': 지금 가격 → 입주 → 5·10년 뒤 → 노후 시작(60세) 예상 시세, 같은 동 시세와 비교,
 * 재건축(30년 넘은 단지)·주변 정비사업(재개발 포함)이 끝났을 때의 그림. 서울 아파트만 (서울 시장 데이터 기준).
 * 상세 입력이든 내 조건으로 찾기든 판정이 다시 계산될 때마다 그린다.
 */
(function () {
  const T = window.REA_TIERS, M = window.REA_MYMARKET, E = window.REA, P = window.REA_POLICY;
  const $ = (id) => document.getElementById(id);
  const MAN = 1e4;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const won = (x) => {
    if (x == null || !isFinite(x)) return '—';
    const v = Math.round(Math.abs(x) / MAN), e = Math.floor(v / 1e4), r = v % 1e4;
    return (x < 0 ? '−' : '') + (e && r ? `${e}억 ${r.toLocaleString()}만` : e ? `${e}억` : `${r.toLocaleString()}만`) + '원';
  };
  const perM2 = (price, area) => `${Math.round(price / area / MAN).toLocaleString()}만원/㎡`;
  const ym = (d) => (/^\d{4}-\d{2}/.test(d || '') ? d.slice(0, 7) : new Date().toISOString().slice(0, 7));
  const addYears = (d, y) => { const [a, b] = ym(d).split('-').map(Number); const m = a * 12 + (b - 1) + Math.round(y * 12); return `${Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, '0')}`; };
  const yearsBetween = (a, b) => { const [y1, m1] = ym(a).split('-').map(Number), [y2, m2] = ym(b).split('-').map(Number); return (y2 * 12 + m2 - y1 * 12 - m1) / 12; };
  const median = (a) => { if (!a.length) return null; const x = a.slice().sort((m, n) => m - n), k = x.length >> 1; return x.length % 2 ? x[k] : (x[k - 1] + x[k]) / 2; };

  const adjText = (a) => (a < 0 ? `과거 급등기를 감안해 ${+(-a * 100).toFixed(1)}%p 낮추고` : a > 0 ? `${+(a * 100).toFixed(1)}%p 높이고` : '보정 없이');
  let pick = null; // { id, p }: 내 조건으로 찾기에서 고른 단지와 그때 쓴 조건
  window.REA_FUTURE = {
    setPick(id, p) { pick = id ? { id, p: p || null } : null; render(); },
    get pick() { return pick; },
  };
  document.addEventListener('rea:updated', () => render());
  $('future').addEventListener('change', (e) => {
    if (e.target.id === 'futurePick') window.REA_FUTURE.setPick(e.target.value || null, pick && pick.p);
  });

  let seq = 0;
  async function render() {
    const box = $('future'), L = window.REA_LAST, my = ++seq;
    if (!L || !L.inputs || L.inputs.propertyType !== '아파트' || !/^seoul-/.test(L.inputs.regionId) || !(L.inputs.price > 0)) { box.hidden = true; return; }
    try { await M.load(); } catch (_) { box.hidden = true; return; }
    if (my !== seq) return; // 더 새 계산이 있으면 그것만 그린다
    const I = L.inputs, pr = M.prepare(), market = M.market;
    let c = pick && pr.all.find((x) => x.id === pick.id);
    if (c && (c.regionId !== I.regionId || Math.abs(c.area - I.areaM2) > 5)) c = null; // 지역·면적을 바꾸면 고른 단지와 다른 집
    const prof = (pick && pick.p) || M.loadProfile();
    const hasProf = M.hasProfile(prof);
    const reg = market.regions[I.regionId];
    const dong = c ? M.dongOf(c) : null;
    const gr = T.growth(c || {}, reg, { growthAdjust: prof.growthAdjust ?? -0.015 }, dong);
    const g = gr.g;

    // 시점: 매수 → 입주 → 5년 → 10년 → 노후 시작
    const buy = ym(I.purchaseDate);
    const age = hasProf ? prof.age : I.age, target = hasProf ? prof.targetAge : 60;
    const pts = [{ label: '지금 (매수)', at: buy, y: 0 }];
    if (I.moveInBy && yearsBetween(buy, I.moveInBy) > 0.2) pts.push({ label: '입주', at: ym(I.moveInBy), y: yearsBetween(buy, I.moveInBy) });
    pts.push({ label: '5년 뒤', at: addYears(buy, 5), y: 5 }, { label: '10년 뒤', at: addYears(buy, 10), y: 10 });
    if (age && target > age) pts.push({ label: `${target}세`, at: addYears(buy, target - age), y: target - age });
    pts.sort((a, b) => a.y - b.y);
    const uniq = pts.filter((x, k) => !k || Math.abs(x.y - pts[k - 1].y) > 0.5);

    // 재건축: 30년 넘은 단지면 같은 동 신축 시세로 재건축 뒤 가치 (내 조건 평가와 같은 계산)
    const thisYear = new Date().getFullYear();
    let rb = null, ev = null;
    if (c && c.builtYear && thisYear - c.builtYear >= 30) {
      ev = M.evaluate({ ...c, price: I.price }, { ...T.DEFAULTS, ...prof, age: age || 45, targetAge: target });
      rb = ev.rebuild;
    }
    const steps = uniq.map((x) => {
      const v = I.price * Math.pow(1 + g, x.y);
      const withRb = rb && x.y >= rb.years ? I.price * Math.pow(1 + g, x.y) + rb.chance * Math.max(0, (rb.nowNew * Math.pow(1 + g, x.y) - rb.share) - v) : null;
      return `<div class="fs"><small>${esc(x.label)} · ${esc(x.at)}</small><b>${won(v)}</b>${withRb && withRb > v * 1.005 ? `<span class="fs-rb">재건축 반영 ${won(withRb)}</span>` : x.y ? `<span>+${Math.round((Math.pow(1 + g, x.y) - 1) * 100)}%</span>` : `<span>${perM2(I.price, I.areaM2)}</span>`}</div>`;
    }).join('<span class="fs-arrow" aria-hidden="true">›</span>');

    // 같은 동 시세
    let near = '';
    if (c) {
      const same = pr.all.filter((x) => x.regionId === c.regionId && x.dong === c.dong);
      const byName = new Map();
      for (const x of same) { const o = byName.get(x.name); if (!o || Math.abs(x.area - I.areaM2) < Math.abs(o.area - I.areaM2)) byName.set(x.name, x); }
      const rows = [...byName.values()].sort((a, b) => (b.builtYear || 0) - (a.builtYear || 0)).slice(0, 8);
      const dongM2 = median(same.map((x) => x.price / x.area));
      const mine = I.price / I.areaM2;
      near = `<h4>주변 시세 · ${esc(c.dong)}</h4>
        <p class="muted">이 집 ${perM2(I.price, I.areaM2)} · 같은 동 전체 중위 ${dongM2 ? perM2(dongM2, 1) : '—'}${dong && dong.newM2 ? ` · 같은 동 신축(15년 이내 ${dong.newN}곳) ${perM2(dong.newM2, 1)} → 이 집보다 ${Math.round((dong.newM2 / mine - 1) * 100)}% ${dong.newM2 >= mine ? '높음' : '낮음'}` : ' · 같은 동에 15년 이내 신축 거래가 적음'}</p>
        <ul class="near-list">${rows.map((x) => `<li${x.id === c.id ? ' class="me"' : ''}><b>${esc(x.name)}</b><span class="n">${won(x.price)}</span><span class="muted">${x.builtYear ? `${x.builtYear}년 준공` : '준공 미상'} · 전용 ${x.area}㎡</span><span class="n muted">${Math.round(x.price / x.area / MAN).toLocaleString()}만원/㎡</span></li>`).join('')}</ul>`;
    }

    // 재건축 그림
    let recon = '';
    if (c && c.redev) {
      const r = c.redev, prj = r.project;
      recon = `<h4>재건축 그림</h4>
        <p>${prj ? `정비사업 정보몽땅: <b>${esc(prj.name)}</b> · ${esc(prj.stageText || '단계 미상')}` : '정비사업 정보몽땅에 이 단지로 등록된 재건축 사업이 없습니다 (사업 전이거나 이름이 다를 수 있음).'}</p>
        ${r.done ? '' : `<p class="muted">주변 사례로 본 성사 가능성 약 ${Math.round((r.chance || 0) * 100)}% · 지금 단계부터 입주까지 보통 ${r.years}년 (약 ${thisYear + Math.round(r.years)}년 입주)</p>`}
        ${rb && rb.nowNew - rb.share <= I.price ? `<p class="muted">같은 동 신축 시세(지금 신축이라면 ${won(rb.nowNew)})에서 분담금 ${won(rb.share)}을 빼면 지금 가격보다 낮아, 재건축으로 더 오를 몫은 없다고 봤습니다 (이미 재건축 기대가 가격에 들어 있을 수 있음).</p>` : rb ? `<p class="muted">재건축 뒤: 지금 신축이라면 ${won(rb.nowNew)} (같은 동 신축 ㎡당 × 면적) − 분담금 ${won(rb.share)} (전용㎡당 ${Math.round((T.reconAssume(c, prof).shareM2 || 0) / MAN)}만원, 입주까지 물가 반영) → 오르는 몫은 성사 가능성만큼만 반영했습니다.</p>` : '<p class="muted">같은 동 신축 시세가 없거나 노후 시작 전에 입주하기 어려워 재건축 가치는 넣지 않았습니다.</p>'}
        <p class="links">${prj && prj.cafe ? `<a href="https://cleanup.seoul.go.kr/cafe/mainIndx.do?cafeUrl=${encodeURIComponent(prj.cafe)}" target="_blank" rel="noopener">조합 공개 페이지</a> · ` : ''}${prj && prj.rec ? `<a href="https://urban.seoul.go.kr/view/map/mapPopup.html?recordCode=${encodeURIComponent(prj.rec)}" target="_blank" rel="noopener">도시계획 지도</a> · ` : ''}<a href="https://cleanup.seoul.go.kr/cleanup/bsnssttus/lscrMainIndx.do" target="_blank" rel="noopener">정비사업 정보몽땅</a></p>`;
    }

    // 주변 정비사업 (재건축·재개발 모두): 끝나면 주변 신축 시세를 따라간다
    let projects = '';
    const snap = M.redevSnap;
    if (c && snap) {
      const col = (k) => snap.cols.indexOf(k), gu = E.region(c.regionId).name.replace(/^서울 /, '');
      const list = snap.rows.filter((row) => row[col('자치구')] === gu && String(row[col('대표지번')] || '').split(' ')[0] === c.dong).slice(0, 6);
      if (list.length) {
        projects = `<h4>주변 정비사업 · ${esc(c.dong)}</h4><ul class="plain">${list.map((row) => {
          const st = T.normStage(row[col('진행단계')]), yrs = st ? P.RECON.yearsToMoveIn[st] : null;
          const cafe = row[col('cafe')];
          return `<li><b>${esc(row[col('사업장명')])}</b> <span class="muted">${esc(row[col('사업구분')])} · ${esc(row[col('진행단계')] || '단계 미상')}${yrs ? ` · 보통 ${yrs}년 뒤(약 ${thisYear + Math.round(yrs)}년) 입주` : ''}</span>${cafe ? ` <a href="https://cleanup.seoul.go.kr/cafe/mainIndx.do?cafeUrl=${encodeURIComponent(cafe)}" target="_blank" rel="noopener">공개 자료</a>` : ''}</li>`;
        }).join('')}</ul>
        <p class="muted">정비사업이 끝난 새 아파트는 같은 동 신축 시세${dong && dong.newM2 ? `(지금 ${perM2(dong.newM2, 1)})` : ''}를 따라가는 경향이 있어(서울 실거래 검증 오차 중앙값 12%), 동네 전체 시세를 끌어올릴 수 있습니다. 공사 기간에는 이주 수요로 주변 전세가 오르기도 합니다.</p>`;
      }
    }

    // 단지를 고르지 않았으면: 비슷한 단지 고르기
    let chooser = '';
    if (!c) {
      const sim = pr.all.filter((x) => x.regionId === I.regionId && Math.abs(x.area - I.areaM2) <= 5)
        .sort((a, b) => Math.abs(a.price - I.price) - Math.abs(b.price - I.price)).slice(0, 40);
      if (sim.length) chooser = `<label class="f wide future-pick">이 집의 단지를 고르면 같은 동 시세·재건축·주변 정비사업까지 그립니다
        <select id="futurePick"><option value="">단지 고르기 (매매가가 비슷한 순)</option>${sim.map((x) => `<option value="${esc(x.id)}">${esc(x.name)} · ${esc(x.dong)} · ${x.area}㎡ · ${won(x.price)}</option>`).join('')}</select></label>`;
    }

    box.innerHTML = `<h3>미래 그림 <span class="muted">· ${c ? `${esc(c.name)} 전용 ${c.area}㎡` : `${esc(E.region(I.regionId).name)} 평균 상승률 기준`}</span></h3>
      <div class="future-steps">${steps}</div>
      <p class="muted">연 상승률 ${(g * 100).toFixed(1)}% (${esc(gr.basis)}, ${adjText(prof.growthAdjust ?? -0.015)} 연 5.5% 상한) · 지금 가치로 바꾸지 않은 명목 금액이고, 오차가 클 수 있는 추정입니다.</p>
      ${recon}${near}${projects}${chooser}`;
    box.hidden = false;
  }
})();
