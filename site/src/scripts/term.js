/**
 * 용어 툴팁.
 *
 * 레퍼런스 사이트는 툴팁을 <span>에 붙여 키보드로 접근할 수 없었다.
 * 여기서는 <button>으로 만들어 Tab·Enter·Esc로 쓸 수 있게 한다.
 * 정의 텍스트는 term-def(정의 목록)에도 그대로 남아 있어 툴팁을 못 써도 읽을 수 있다.
 */

let pop = null;
let owner = null;

function hide() {
  if (!pop) return;
  pop.remove();
  pop = null;
  if (owner) { owner.setAttribute('aria-expanded', 'false'); owner = null; }
}

function show(btn) {
  hide();
  const desc = btn.dataset.desc;
  if (!desc) return;

  pop = document.createElement('div');
  pop.className = 'term-pop';
  pop.setAttribute('role', 'tooltip');
  pop.id = 'term-pop';
  const b = document.createElement('b');
  b.textContent = btn.dataset.term || btn.textContent;
  pop.append(b, document.createTextNode(desc));
  document.body.append(pop);

  const r = btn.getBoundingClientRect();
  const w = pop.offsetWidth;
  const left = Math.min(Math.max(8, r.left + scrollX), scrollX + document.documentElement.clientWidth - w - 8);
  let top = r.bottom + scrollY + 6;
  // 아래가 좁으면 위로 띄운다
  if (r.bottom + pop.offsetHeight + 16 > innerHeight) top = r.top + scrollY - pop.offsetHeight - 6;
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;

  btn.setAttribute('aria-describedby', 'term-pop');
  btn.setAttribute('aria-expanded', 'true');
  owner = btn;
}

export function initTerms(root = document) {
  const btns = root.querySelectorAll('.term-ref[data-desc]');
  btns.forEach((btn) => {
    btn.setAttribute('aria-expanded', 'false');
    btn.addEventListener('mouseenter', () => show(btn));
    btn.addEventListener('mouseleave', hide);
    btn.addEventListener('focus', () => show(btn));
    btn.addEventListener('blur', hide);
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      owner === btn ? hide() : show(btn);
    });
  });
  if (btns.length) {
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
    addEventListener('scroll', hide, { passive: true });
    addEventListener('resize', hide);
  }
}
