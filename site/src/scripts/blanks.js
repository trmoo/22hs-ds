/**
 * 본문 빈칸 채점.
 *
 * - 입력하면 바로 채점한다(디바운스). 맞으면 초록, 틀리면 빨강.
 * - 힌트 버튼은 정답을 알려 주지 않고 단서만 보여 준다.
 * - 채점 기준은 느슨하게 둔다: 앞뒤 공백·중간 공백·괄호 병기·마침표를 무시한다.
 *   학생이 '정형데이터'라고 붙여 써도 맞게 처리한다.
 * - 입력값은 localStorage 에 저장해 다시 방문했을 때 남아 있게 한다.
 */

const LS = 'ds-blanks';

/** 비교용 정규화 — 공백 제거, 괄호 안 병기 제거, 소문자, 끝 마침표 제거 */
function norm(s) {
  return String(s ?? '')
    .replace(/\([^)]*\)/g, '')
    .replace(/[\s·、,.]/g, '')
    .replace(/[!?。]$/, '')
    .toLowerCase();
}

const load = () => { try { return JSON.parse(localStorage.getItem(LS)) ?? {}; } catch { return {}; } };
const save = (o) => { try { localStorage.setItem(LS, JSON.stringify(o)); } catch {} };

export function initBlanks(root = document) {
  const nodes = [...root.querySelectorAll('.blank')];
  if (!nodes.length) return;

  const lesson = document.body.dataset.lesson || 'x';
  const store = load();
  store[lesson] ??= {};

  const summary = document.getElementById('blank-summary');
  const total = nodes.length;
  // 빈칸이 없는 차시에서는 카드 자체를 띄우지 않는다.
  document.getElementById('blank-card')?.removeAttribute('hidden');

  const tally = () => {
    const ok = nodes.filter((n) => n.classList.contains('ok')).length;
    const tried = nodes.filter((n) => n.querySelector('.blank-in').value.trim()).length;
    if (summary) {
      summary.textContent = `빈칸 ${ok} / ${total} 정답` + (tried > ok ? ` · 다시 볼 곳 ${tried - ok}개` : '');
      summary.classList.toggle('done', ok === total);
    }
  };

  nodes.forEach((node, i) => {
    const input = node.querySelector('.blank-in');
    const mark = node.querySelector('.blank-mark');
    const hintBtn = node.querySelector('.blank-hint');
    const answers = (node.dataset.answer || '').split('|').map(norm).filter(Boolean);

    const grade = (silent) => {
      const v = input.value.trim();
      node.classList.remove('ok', 'no');
      if (mark) mark.textContent = '';
      if (!v) { if (!silent) tally(); return; }
      const ok = answers.includes(norm(v));
      node.classList.add(ok ? 'ok' : 'no');
      if (mark) mark.textContent = ok ? '✓' : '✗';
      input.setAttribute('aria-invalid', ok ? 'false' : 'true');
      store[lesson][i] = v;
      save(store);
      if (!silent) tally();
    };

    // 저장된 값 복원
    if (store[lesson][i]) { input.value = store[lesson][i]; grade(true); }

    let t = null;
    input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => grade(), 350); });
    input.addEventListener('blur', () => grade());
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); grade(); } });

    if (hintBtn) {
      hintBtn.addEventListener('click', () => {
        const shown = node.classList.toggle('hinted');
        hintBtn.textContent = shown ? '힌트 닫기' : '힌트';
        if (shown && !node.querySelector('.blank-tip')) {
          const tip = document.createElement('span');
          tip.className = 'blank-tip';
          tip.setAttribute('role', 'note');
          tip.textContent = node.dataset.hint || '';
          node.append(tip);
        }
      });
    }
  });

  // 다시 풀기 — 입력과 저장값을 함께 비운다. 저장만 지우면 화면에 답이 남는다.
  document.getElementById('blank-reset')?.addEventListener('click', () => {
    nodes.forEach((node) => {
      node.querySelector('.blank-in').value = '';
      node.classList.remove('ok', 'no');
      node.querySelector('.blank-tip')?.remove();
    });
    store[lesson] = {};
    save(store);
    tally();
    nodes[0]?.querySelector('.blank-in')?.focus();
  });

  tally();
}
