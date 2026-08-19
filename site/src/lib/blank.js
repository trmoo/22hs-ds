/**
 * 본문 빈칸 문법.
 *
 *   {{정답||힌트}}          답이 하나
 *   {{정형/정형 데이터||힌트}}  '/'로 여러 정답 허용 (하나만 맞으면 통과)
 *   {{정답}}                힌트 없음
 *
 * 서버에서 <span class="blank">…<input>…</span> 으로 바꾸고,
 * 채점은 scripts/blank.js 가 브라우저에서 한다.
 *
 * 정답을 data 속성에 담으므로 소스를 보면 알 수 있다. 이 사이트는 평가 도구가
 * 아니라 학습 도구이고, 오프라인·인쇄에서도 답을 확인할 수 있어야 하므로 그렇게 두었다.
 */
import { escapeHtml } from './md.js';

const RE = /\{\{([^{}|]+?)(?:\|\|([^{}]*?))?\}\}/g;

/** md 문자열에서 빈칸 개수를 센다 (집필 분량 점검·검증용) */
export function countBlanks(src) {
  return (String(src ?? '').match(RE) ?? []).length;
}

// 사용자 정의 영역 문자. 마크다운도 용어 링크도 이 글자는 건드리지 않는다.
const TOK_A = '';
const TOK_B = '';
const TOK_RE = /(\d+)/g;

/**
 * 빈칸 표기를 자리표(토큰)로 바꿔 둔다.
 *
 * 이 단계가 필요한 까닭: 용어 툴팁을 붙이는 linkTerms 는 본문에서 용어를 찾아
 * <button> 을 끼워 넣는다. 빈칸 정답이 용어와 같은 낱말이면 정답 자리에 태그가
 * 끼어들어 학생이 무엇을 써도 맞지 않는다. 그래서 용어 링크를 붙이기 전에
 * 빈칸을 한글이 없는 토큰으로 감춘 뒤, 링크가 끝나고 되돌린다.
 */
export function maskBlanks(src) {
  const items = [];
  const text = String(src ?? '').replace(RE, (_, ans, hint) => {
    items.push([ans, hint]);
    return TOK_A + (items.length - 1) + TOK_B;
  });
  return { text, items };
}

/** maskBlanks 로 감춘 자리표를 입력칸 HTML 로 되돌린다. */
export function unmaskBlanks(html, items, seed = { n: 0 }) {
  return String(html ?? '').replace(TOK_RE, (_, i) => {
    const pair = items[Number(i)];
    if (!pair) return '';
    return blankHtml(pair[0], pair[1], seed);
  });
}

/**
 * 이미 이스케이프·인라인 처리가 끝난 HTML 에서 빈칸 표기를 입력칸으로 바꾼다.
 * 용어 링크를 함께 쓰는 본문에서는 maskBlanks·unmaskBlanks 를 쓴다.
 * seed 는 페이지 안에서 빈칸마다 고유한 번호를 주기 위한 카운터 객체다.
 */
export function renderBlanks(html, seed = { n: 0 }) {
  return String(html ?? '').replace(RE, (_, ans, hint) => blankHtml(ans, hint, seed));
}

function blankHtml(ans, hint, seed) {
  {
    seed.n += 1;
    const answers = String(ans).split('/').map((s) => s.trim()).filter(Boolean);
    const width = Math.max(...answers.map((a) => a.length));
    const attrs = [
      `class="blank"`,
      `data-answer="${escapeHtml(answers.join('|'))}"`,
      hint ? `data-hint="${escapeHtml(String(hint).trim())}"` : '',
      `style="--blank-ch:${Math.min(Math.max(width + 2, 4), 22)}"`,
    ].filter(Boolean).join(' ');

    // 입력칸 + (힌트가 있으면) 힌트 버튼. 라벨은 스크린리더용으로 번호를 준다.
    return (
      `<span ${attrs}>` +
      `<input type="text" class="blank-in" inputmode="text" autocomplete="off" ` +
      `aria-label="빈칸 ${seed.n}" enterkeyhint="done" />` +
      `<span class="blank-mark" aria-hidden="true"></span>` +
      (hint ? `<button type="button" class="blank-hint" aria-label="빈칸 ${seed.n} 힌트 보기">힌트</button>` : '') +
      `</span>`
    );
  }
}
