/**
 * 검색·필터.
 *
 * 색인은 빌드 시 /search-index.json 으로 뽑아 두고 이 페이지에서만 가져온다.
 * 모든 페이지에 인라인으로 심으면 차시 페이지가 140KB까지 커지기 때문이다.
 * 정적 파일이라 서버 로직이 없고, 배포본을 그대로 열면 오프라인에서도 동작한다.
 */

const AREA_NO = { 1: 'Ⅰ', 2: 'Ⅱ', 3: 'Ⅲ', 4: 'Ⅳ' };
const STD_RE = /12데과\d{2}-\d{2}/g;

const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, '');

function snippet(text, q) {
  if (!q) return text.slice(0, 140);
  const i = norm(text).indexOf(norm(q));
  if (i < 0) return text.slice(0, 140);
  // norm이 공백을 지우므로 원문 위치는 근처를 훑어 찾는다
  const raw = text.toLowerCase().indexOf(q.toLowerCase());
  const at = raw >= 0 ? raw : i;
  const from = Math.max(0, at - 50);
  return (from > 0 ? '…' : '') + text.slice(from, from + 150);
}

function highlight(text, q) {
  const div = document.createElement('div');
  div.textContent = text;
  let html = div.innerHTML;
  if (q && q.trim()) {
    const esc = q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    html = html.replace(new RegExp(esc, 'gi'), (m) => `<mark>${m}</mark>`);
  }
  return html;
}

export async function initSearch() {
  // 색인은 별도 정적 파일에서 가져온다(페이지 무게를 줄이기 위해).
  let idx = [];
  try {
    const res = await fetch('/search-index.json');
    if (res.ok) idx = await res.json();
  } catch (e) {
    console.error('[search] 색인을 불러오지 못했다', e);
  }
  const input = document.getElementById('sq');
  if (!idx.length) {
    const c = document.getElementById('scount');
    if (c) c.textContent = '검색 색인을 불러오지 못했다. 좌측 단원 목차로 이동할 수 있다.';
  }
  const list = document.getElementById('sresults');
  const count = document.getElementById('scount');
  if (!input || !list) return;

  const areaBtns = [...document.querySelectorAll('#area-filters button')];
  const stdBtns = [...document.querySelectorAll('#std-filters button')];
  const activeAreas = new Set();
  const activeStds = new Set();

  const syncUrl = (q) => {
    const u = new URL(location.href);
    q ? u.searchParams.set('q', q) : u.searchParams.delete('q');
    activeAreas.size ? u.searchParams.set('area', [...activeAreas].join(',')) : u.searchParams.delete('area');
    activeStds.size ? u.searchParams.set('std', [...activeStds].join(',')) : u.searchParams.delete('std');
    history.replaceState(null, '', u);
  };

  function run() {
    const q = input.value.trim();
    const nq = norm(q);

    // 검색어에 성취기준 코드가 들어 있으면 그 코드로도 필터한다
    const codesInQuery = (q.toUpperCase().match(STD_RE) ?? []);

    let rows = idx;
    if (activeAreas.size) rows = rows.filter((r) => activeAreas.has(String(r.areaId)));
    if (activeStds.size) rows = rows.filter((r) => r.standards.some((s) => activeStds.has(s)));
    if (codesInQuery.length) rows = rows.filter((r) => r.standards.some((s) => codesInQuery.includes(s)));

    if (nq && !codesInQuery.length) {
      rows = rows
        .map((r) => {
          const t = norm(r.title), k = norm(r.keywords.join(' ')), body = norm(r.text);
          let score = 0;
          if (t.includes(nq)) score += 10;
          if (k.includes(nq)) score += 5;
          if (body.includes(nq)) score += 1;
          return { r, score };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((x) => x.r);
    }

    list.innerHTML = '';
    for (const r of rows) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = `/lesson/${r.id}/`;
      a.innerHTML = highlight(r.title, q);
      const meta = document.createElement('p');
      meta.className = 'snip';
      meta.innerHTML =
        `<span class="badge">${r.standards.join(' · ')}</span> ${AREA_NO[r.areaId] ?? ''} 영역 · ` +
        highlight(snippet(r.text, codesInQuery.length ? '' : q), codesInQuery.length ? '' : q);
      li.append(a, meta);
      list.append(li);
    }
    if (count) {
      count.textContent = rows.length
        ? `${rows.length}개 차시`
        : '조건에 맞는 차시가 없다. 검색어나 필터를 바꿔 보자.';
    }
    syncUrl(q);
  }

  const toggle = (btn, set, key) => {
    btn.addEventListener('click', () => {
      const on = btn.getAttribute('aria-pressed') === 'true';
      btn.setAttribute('aria-pressed', String(!on));
      on ? set.delete(btn.dataset[key]) : set.add(btn.dataset[key]);
      run();
    });
  };
  areaBtns.forEach((b) => toggle(b, activeAreas, 'area'));
  stdBtns.forEach((b) => toggle(b, activeStds, 'std'));

  let t = null;
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 120); });
  document.getElementById('sform')?.addEventListener('submit', (e) => { e.preventDefault(); run(); });

  // URL 파라미터로 들어온 검색 상태를 복원한다(헤더 검색창이 이 페이지로 보낸다)
  const p = new URLSearchParams(location.search);
  if (p.get('q')) input.value = p.get('q');
  for (const a of (p.get('area') ?? '').split(',').filter(Boolean)) {
    activeAreas.add(a);
    areaBtns.find((b) => b.dataset.area === a)?.setAttribute('aria-pressed', 'true');
  }
  for (const s of (p.get('std') ?? '').split(',').filter(Boolean)) {
    activeStds.add(s);
    stdBtns.find((b) => b.dataset.std === s)?.setAttribute('aria-pressed', 'true');
  }
  run();
  input.focus();
}
