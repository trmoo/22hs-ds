/**
 * 확인 문제. 선택하면 즉시 채점하고 해설을 펼친다.
 *
 * 정답 정보는 서버 렌더 시 data-answer 에 담겨 있다. 학생이 소스를 보면 알 수 있지만,
 * 이 사이트는 평가 도구가 아니라 학습 도구이므로 그 편이 오프라인·인쇄에 유리하다.
 * (점수를 남기는 평가가 필요하면 서버가 필요하다 — PLAN §9 결정 8)
 */

const VERDICT_OK = '맞았다';
const VERDICT_NO = '다시 생각해 보자';

function gradeItem(item) {
  const choices = [...item.querySelectorAll('.q-choice')];
  const fb = item.querySelector('.q-fb');
  let answer;
  try { answer = JSON.parse(item.dataset.answer); } catch { answer = null; }

  const isCorrect = (btn) => {
    const v = btn.dataset.val;
    if (item.dataset.qtype === 'ox') return String(answer) === v;
    return String(answer) === v;
  };

  choices.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (item.dataset.done) return;
      item.dataset.done = '1';

      const ok = isCorrect(btn);
      choices.forEach((b) => {
        b.disabled = true;
        if (!ok && isCorrect(b)) b.classList.add('reveal');   // 정답을 알려 준다
      });
      btn.classList.add(ok ? 'right' : 'wrong');
      btn.setAttribute('aria-pressed', 'true');

      if (fb) {
        fb.classList.add('on', ok ? 'good' : 'bad');
        const v = fb.querySelector('.v');
        if (v) v.textContent = ok ? VERDICT_OK : VERDICT_NO;
      }
      item.dispatchEvent(new CustomEvent('quiz:graded', { bubbles: true, detail: { ok } }));
    });
  });
}

function initQuiz(quiz) {
  const items = [...quiz.querySelectorAll('.q-item')];
  items.forEach(gradeItem);

  const score = quiz.querySelector('.quiz-score');
  if (!score) return;
  let done = 0, right = 0;
  quiz.addEventListener('quiz:graded', (e) => {
    done += 1;
    if (e.detail.ok) right += 1;
    score.textContent = done < items.length
      ? `${done} / ${items.length} 문항 풀이 · 맞힌 개수 ${right}`
      : `모두 풀었다. 맞힌 개수 ${right} / ${items.length}`;
  });
}

export function initQuizzes(root = document) {
  root.querySelectorAll('[data-quiz]').forEach(initQuiz);
}
