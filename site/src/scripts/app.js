/**
 * 셸 동작: 모바일 드로어 · 테마 · 우측 목차 스크롤 스파이 · 읽기 진행 · 진도 저장
 * 모든 상태는 localStorage 에만 둔다(서버 없음).
 *
 * 출판사는 고르지 않는다. 특정 교과서를 기본값으로 두면 그 교과서 중심으로 읽히므로,
 * 3사 위치를 차시마다 나란히 보여 주는 방식(교과서 대조표)만 남겼다.
 */

const LS = {
  theme: 'ds-theme',
  read: 'ds-read',           // 읽은 차시 목록
};

const readJSON = (k, fb) => {
  try { return JSON.parse(localStorage.getItem(k)) ?? fb; } catch { return fb; }
};
const writeJSON = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 사생활 보호 모드 등 */ }
};

/* ---------- 모바일 드로어 ---------- */
function initDrawer() {
  const btn = document.getElementById('nav-toggle');
  if (!btn) return;
  const close = () => {
    document.body.classList.remove('nav-open');
    btn.setAttribute('aria-expanded', 'false');
  };
  btn.addEventListener('click', () => {
    const open = document.body.classList.toggle('nav-open');
    btn.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  // 드로어 안에서 링크를 누르면 닫는다
  document.querySelector('.pane-tree')?.addEventListener('click', (e) => {
    if (e.target.closest('a')) close();
  });
  // 바깥(오버레이) 클릭
  document.addEventListener('click', (e) => {
    if (!document.body.classList.contains('nav-open')) return;
    if (e.target.closest('.pane-tree') || e.target.closest('#nav-toggle')) return;
    close();
  });
}

/* ---------- 테마 ---------- */
function initTheme() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme;
    const sysDark = matchMedia('(prefers-color-scheme: dark)').matches;
    const next = cur ? (cur === 'dark' ? 'light' : 'dark') : (sysDark ? 'light' : 'dark');
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(LS.theme, next); } catch {}
  });
}

/* ---------- 우측 목차 스크롤 스파이 ---------- */
function initToc() {
  const toc = document.getElementById('toc');
  if (!toc) return;
  const links = [...toc.querySelectorAll('a')];
  const targets = links
    .map((a) => document.getElementById(decodeURIComponent(a.hash.slice(1))))
    .filter(Boolean);
  if (!targets.length) return;

  let active = null;
  const setActive = (id) => {
    if (active === id) return;
    active = id;
    links.forEach((a) => a.classList.toggle('active', a.hash === `#${id}`));
  };

  const io = new IntersectionObserver((entries) => {
    // 화면에 보이는 것 중 가장 위쪽을 활성으로 둔다
    const vis = entries.filter((e) => e.isIntersecting)
      .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
    if (vis.length) setActive(vis[0].target.id);
  }, { rootMargin: '-15% 0px -70% 0px', threshold: 0 });

  targets.forEach((t) => io.observe(t));
}

/* ---------- 읽기 진행 바 ---------- */
function initProgress() {
  const bar = document.getElementById('progress-bar');
  if (!bar) return;
  let queued = false;
  const update = () => {
    const h = document.documentElement;
    const max = h.scrollHeight - h.clientHeight;
    bar.style.width = (max > 0 ? (h.scrollTop / max) * 100 : 0) + '%';
    queued = false;
  };
  addEventListener('scroll', () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  }, { passive: true });
  update();
}

/* ---------- 진도(읽은 차시) ---------- */
function initReadState() {
  const read = new Set(readJSON(LS.read, []));

  // 트리에 체크 표시
  document.querySelectorAll('.tree-list a[data-lesson]').forEach((a) => {
    if (read.has(a.dataset.lesson)) a.classList.add('tree-done');
  });

  // 현재 차시를 끝까지 읽으면 읽음으로 표시
  const cur = document.body.dataset.lesson;
  if (!cur) return;
  const mark = () => {
    if (read.has(cur)) return;
    const h = document.documentElement;
    const ratio = (h.scrollTop + h.clientHeight) / h.scrollHeight;
    if (ratio > 0.9) {
      read.add(cur);
      writeJSON(LS.read, [...read]);
      document.querySelector(`.tree-list a[data-lesson="${cur}"]`)?.classList.add('tree-done');
    }
  };
  addEventListener('scroll', mark, { passive: true });
  mark();
}

export function initApp() {
  initDrawer();
  initTheme();
  initToc();
  initProgress();
  initReadState();
}
