/**
 * 빈칸 문법과 조사 처리 회귀 테스트.
 *
 * 여기서 지키려는 것 두 가지다.
 *  1. 용어 툴팁이 빈칸 정답 자리에 끼어들지 않는다. 끼어들면 학생이 무엇을 써도 틀린다.
 *  2. 위젯이 만드는 문장의 조사가 받침을 따른다. "학년 를" 같은 문장이 학생에게 보이면 안 된다.
 */
import { countBlanks, maskBlanks, unmaskBlanks, renderBlanks } from '../src/lib/blank.js';
import { markdown, linkTerms } from '../src/lib/md.js';
import { josa, ro } from '../src/scripts/widget.js';

let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => {
  if (cond) { pass += 1; console.log(`  OK   ${name}`); }
  else { fail += 1; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};

console.log('[blank] 빈칸 문법');
ok(countBlanks('{{가}}와 {{나||힌트}}') === 2, 'countBlanks 가 개수를 센다');
ok(countBlanks('빈칸 없는 문장') === 0, '빈칸이 없으면 0');

{
  const { text, items } = maskBlanks('{{정형 데이터||표로 정리되는 쪽}}라고 부른다.');
  ok(items.length === 1, 'maskBlanks 가 항목을 모은다');
  ok(!/정형 데이터/.test(text), '토큰화한 본문에는 정답 낱말이 남지 않는다', text);
  const html = unmaskBlanks(text, items, { n: 0 });
  ok(/data-answer="정형 데이터"/.test(html), 'unmaskBlanks 가 정답을 되돌린다');
  ok((html.match(/<input/g) ?? []).length === 1, '입력칸이 하나 생긴다');
  ok(/data-hint="표로 정리되는 쪽"/.test(html), '힌트가 보존된다');
}

{
  // 핵심 회귀: 정답이 용어집 용어와 같은 낱말일 때
  const terms = [{ term: '정형 데이터', desc: '칸이 정해진 데이터' }];
  const src = '표로 정리되는 자료를 {{정형 데이터||칸이 정해진 쪽}}라고 부른다.';
  const { text, items } = maskBlanks(src);
  const html = unmaskBlanks(linkTerms(markdown(text), terms), items, { n: 0 });
  const answer = /data-answer="([^"]*)"/.exec(html)?.[1] ?? '';
  ok(!/[<>]|&lt;|&gt;/.test(answer), '용어 링크가 정답 자리에 끼어들지 않는다', answer);
  ok(answer === '정형 데이터', '정답이 그대로 유지된다', answer);
  ok(!/\uE000|\uE001/.test(html), '자리표 문자가 화면에 남지 않는다');
}

{
  const html = renderBlanks('{{정형/정형 데이터||힌트}}', { n: 0 });
  ok(/data-answer="정형\|정형 데이터"/.test(html), "'/' 로 적은 여러 정답이 '|' 로 이어진다");
}

{
  const seed = { n: 0 };
  const a = renderBlanks('{{가}}', seed);
  const b = renderBlanks('{{나}}', seed);
  ok(/빈칸 1/.test(a) && /빈칸 2/.test(b), '빈칸 번호가 페이지 안에서 이어진다');
}

console.log('[widget] 조사 처리');
ok(josa('학년', '을', '를') === '을', '받침이 있으면 을');
ok(josa('학교', '을', '를') === '를', '받침이 없으면 를');
ok(josa('점수', '이', '가') === '가', '받침 없는 이/가');
ok(josa('이름', '이', '가') === '이', '받침 있는 이/가');
ok(josa('101', '을', '를') === '를', '한글이 아니면 받침 없는 쪽');
ok(ro('이름') === '으로', '일반 받침이면 으로');
ok(ro('점수') === '로', '받침이 없으면 로');
ok(ro('서울') === '로', "'ㄹ' 받침이면 로");
ok(ro('값') === '으로', "'ㅄ' 받침이면 으로");

console.log(`\n결과: 통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
