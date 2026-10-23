/**
 * 빌드 결과(dist/) 검사.
 *
 * 모듈 단위 시험은 함수 하나만 본다. 학생이 실제로 보는 것은 빌드된 HTML 이므로
 * 그 HTML 을 통째로 훑어 본문이 깨진 곳이 없는지 확인한다.
 *
 * 지키려는 것:
 *  1. 용어 툴팁 속성(data-term·data-desc) 안에 태그가 끼어들지 않는다.
 *     설명에 다른 용어(예: '잔차')가 들어 있을 때 그 자리에 버튼이 또 들어가
 *     속성이 깨진 적이 있다(01-01·01-02·01-03·02-04·03-02·04-03, 9곳).
 *  2. 태그를 걷어 낸 본문에 `">` 조각이 0곳이다. 위 1이 깨지면 이 조각이 글자로 보인다.
 *     이스케이프된 본문에서 `">` 가 날것으로 나올 일은 없으므로 하나라도 있으면 결함이다.
 *
 * 실행: npm run build 뒤 node test/dist.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');

let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => {
  if (cond) { pass += 1; console.log(`  OK   ${name}`); }
  else { fail += 1; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};

/** dist 아래 html 파일을 모두 모은다 */
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return walk(p);
    return d.name.endsWith('.html') ? [p] : [];
  });
}

/**
 * 화면에 보이는 글자만 남긴다 — 스크립트·스타일을 빼고 태그를 걷어 낸다.
 *
 * `<[^>]*>` 로 걷으면 안 된다. 코드 블록의 data 속성에는 파이썬 `>=` 가 날것으로
 * 들어 있어(HTML 에서 허용된다) 그 자리에서 태그가 끝난 것으로 잘못 읽는다.
 * 그래서 브라우저처럼 따옴표 안의 값을 건너뛰며 태그 끝을 찾는다.
 * 속성 이름 자리의 `"` 는 브라우저도 이름의 일부로 읽으므로 따옴표로 보지 않는다.
 * 그래야 속성이 깨졌을 때 학생 화면에 보이는 조각이 여기서도 똑같이 드러난다.
 */
function visibleText(html) {
  const src = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '');
  let out = '';
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) { out += src.slice(i); break; }
    out += src.slice(i, lt);
    if (src.startsWith('<!--', lt)) {                                // 주석
      const end = src.indexOf('-->', lt + 4);
      i = end < 0 ? src.length : end + 3;
      continue;
    }
    if (!/[A-Za-z\/!]/.test(src[lt + 1] ?? '')) { out += '<'; i = lt + 1; continue; }
    i = tagEnd(src, lt + 1);
  }
  return out;
}

/** '<' 다음 자리에서 시작해 태그가 끝난 다음 자리를 돌려준다 */
function tagEnd(s, i) {
  const WS = /[\s/]/;
  while (i < s.length && !WS.test(s[i]) && s[i] !== '>') i += 1;   // 태그 이름
  while (i < s.length) {
    while (i < s.length && WS.test(s[i])) i += 1;
    if (s[i] === '>') return i + 1;
    while (i < s.length && !WS.test(s[i]) && s[i] !== '>' && s[i] !== '=') i += 1; // 속성 이름
    while (i < s.length && /\s/.test(s[i])) i += 1;
    if (s[i] !== '=') continue;
    i += 1;
    while (i < s.length && /\s/.test(s[i])) i += 1;
    const q = s[i];
    if (q === '"' || q === "'") {                                    // 따옴표 값
      const end = s.indexOf(q, i + 1);
      i = end < 0 ? s.length : end + 1;
    } else {                                                         // 따옴표 없는 값
      while (i < s.length && !/\s/.test(s[i]) && s[i] !== '>') i += 1;
    }
  }
  return i;
}

console.log('[dist] 빌드 결과 검사');
if (!fs.existsSync(DIST) || !walk(DIST).length) {
  console.log('  FAIL dist/ 가 비어 있다 — 먼저 npm run build 를 실행한다');
  process.exit(1);
}

const files = walk(DIST);
const lessons = files.filter((f) => /[\\/]lesson[\\/]\d{2}-\d{2}[\\/]index\.html$/.test(f));
ok(lessons.length === 19, `차시 페이지가 19개다 (${lessons.length}개)`);

let buttons = 0;
const badAttr = [];
const badText = [];
for (const f of files) {
  const html = fs.readFileSync(f, 'utf8');
  const rel = path.relative(DIST, f).replace(/\\/g, '/');
  buttons += (html.match(/class="term-ref"/g) ?? []).length;

  for (const m of html.matchAll(/data-(?:term|desc)="([^"]*)"/g)) {
    if (/[<>]/.test(m[1])) badAttr.push(`${rel}: ${m[1].slice(0, 40)}…`);
  }
  const text = visibleText(html);
  for (const m of text.matchAll(/">/g)) {
    badText.push(`${rel}: …${text.slice(Math.max(0, m.index - 20), m.index + 15).replace(/\s+/g, ' ')}…`);
  }
}

ok(buttons > 0, `용어 툴팁 버튼이 만들어졌다 (${buttons}개)`);
ok(badAttr.length === 0, '툴팁 속성 안에 태그가 끼어든 곳이 0곳이다', `\n      ${badAttr.join('\n      ')}`);
ok(badText.length === 0, '본문에 보이는 `">` 조각이 0곳이다', `${badText.length}곳\n      ${badText.join('\n      ')}`);

console.log(`\n결과: 통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
