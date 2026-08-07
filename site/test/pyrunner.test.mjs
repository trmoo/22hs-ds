/**
 * pyrunner.js 헤드리스 검증 — 특히 "학교망이 CDN을 막았을 때" 경로.
 *
 * Node 는 https ESM import 를 거부하므로 Pyodide 로드는 자연히 실패한다.
 * 그 상황에서 학생이 코드와 예상 출력을 여전히 볼 수 있어야 한다.
 *
 * 실행: node test/pyrunner.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

/* ---------- 최소 DOM ---------- */
const listeners = new Map();
function makeEl(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [], parentElement: null, attrs: {}, style: {}, dataset: {},
    textContent: '', value: '', disabled: false, hidden: false, open: false,
    classList: {
      _s: new Set(),
      add(...c) { c.forEach((x) => this._s.add(x)); },
      remove(...c) { c.forEach((x) => this._s.delete(x)); },
      contains(c) { return this._s.has(c); },
      toggle(c, on) { on ? this._s.add(c) : this._s.delete(c); },
    },
    // pyrunner 는 node.className = '...' 로 클래스를 넣는다. classList 와 반드시 동기화해야 한다.
    get className() { return [...this.classList._s].join(' '); },
    set className(v) {
      this.classList._s = new Set(String(v).split(/\s+/).filter(Boolean));
    },
    get innerHTML() { return this._html ?? ''; },
    set innerHTML(v) { this._html = v; if (v === '') this.children = []; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k] ?? null; },
    removeAttribute(k) { delete this.attrs[k]; },
    hasAttribute(k) { return k in this.attrs; },
    appendChild(c) { c.parentElement = this; this.children.push(c); return c; },
    append(...cs) { cs.forEach((c) => { if (typeof c === 'object') this.appendChild(c); else this.appendChild(Object.assign(makeEl('span'), { textContent: c })); }); },
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((x) => x !== this); },
    addEventListener(t, fn) { const k = this; (listeners.get(k) ?? listeners.set(k, {}).get(k)); const m = listeners.get(k) || {}; m[t] = fn; listeners.set(k, m); },
    removeEventListener() {},
    click() { const m = listeners.get(this); if (m?.click) return m.click({ preventDefault() {} }); },
    focus() {}, blur() {},
    querySelector(sel) { return find(this, sel); },
    querySelectorAll(sel) { return findAll(this, sel); },
    getBoundingClientRect() { return { width: 700, height: 200, top: 0, left: 0 }; },
    scrollIntoView() {},
    get scrollHeight() { return 100; },
    set scrollTop(v) {},
  };
  return el;
}
const clsOf = (el) => [...el.classList._s];
function matches(el, sel) {
  if (sel.startsWith('.')) return clsOf(el).includes(sel.slice(1));
  if (sel.startsWith('[')) { const k = sel.slice(1, -1).split('=')[0]; return k in el.attrs || k.replace('data-', '') in el.dataset; }
  return el.tagName === sel.toUpperCase();
}
function find(root, sel) {
  for (const c of root.children) { if (matches(c, sel)) return c; const r = find(c, sel); if (r) return r; }
  return null;
}
function findAll(root, sel, acc = []) {
  for (const c of root.children) { if (matches(c, sel)) acc.push(c); findAll(c, sel, acc); }
  return acc;
}

globalThis.document = {
  createElement: makeEl,
  createTextNode: (t) => Object.assign(makeEl('#text'), { textContent: t }),
  documentElement: makeEl('html'),
  body: makeEl('body'),
  addEventListener() {}, removeEventListener() {},
  querySelectorAll: () => [],
};
globalThis.window = { addEventListener() {}, removeEventListener() {} };
globalThis.getComputedStyle = () => ({ fontFamily: 'Pretendard', getPropertyValue: () => '' });
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.requestAnimationFrame = (cb) => { cb(0); return 1; };

const warn = [];
console.warn = (...a) => warn.push(a.join(' '));
console.error = (...a) => warn.push('ERR ' + a.join(' '));

const { mountPyRunner, mountAllPyRunners, pyodideState, ensurePackages } =
  await import('../src/scripts/pyrunner.js');

let pass = 0, fail = 0;
const ok = (c, label, extra = '') => { c ? (pass++, console.log(`  OK   ${label}`)) : (fail++, console.log(`  FAIL ${label} ${extra}`)); };
const textOf = (el) => {
  if (!el) return '';
  let s = el.textContent || '';
  for (const c of el.children) s += textOf(c);
  return s + (el._html ?? '');
};

/* ---------- 1. 마운트 구조 ---------- */
console.log('\n[1] UI 구조');
const BLOCK = { type: 'code', lang: 'python', source: 'values = [3, 1, 4]\nprint(sum(values) / len(values))', expect: '2.6666666666666665' };
const host = makeEl('div');
const handle = mountPyRunner(host, BLOCK);
ok(!!find(host, '.pyrun'), 'figure.pyrun 생성');
ok(!!find(host, '.pyrun-cap'), 'figcaption.pyrun-cap 생성');
ok(!!find(host, '.pyrun-status'), '.pyrun-status 생성');
ok(!!find(host, '.pyrun-code'), '.pyrun-code 생성');
ok(!!find(host, '.pyrun-out'), '.pyrun-out 생성');
ok(!!find(host, '.pyrun-run'), '실행 버튼');
ok(!!find(host, '.pyrun-stop'), '중지 버튼');
ok(!!find(host, '.pyrun-reset'), '되돌리기 버튼');
ok(!!find(host, '.pyrun-expect'), '예상 출력 버튼');
ok(find(host, '.pyrun-out')?.getAttribute('aria-live') === 'polite', '출력 영역이 aria-live');

/* ---------- 2. 초기 상태: 네트워크 요청 없음 ---------- */
console.log('\n[2] 지연 로드');
ok(pyodideState() === 'idle', `마운트만 해도 idle 상태 (현재 ${pyodideState()})`);
ok(textOf(find(host, '.pyrun-cap')).length > 0, '캡션에 안내 문구가 있다');

/* ---------- 3. 예상 출력 보기 (오프라인에서도 즉시) ---------- */
console.log('\n[3] 예상 출력 보기');
find(host, '.pyrun-expect')?.click();
const outAfterExpect = textOf(find(host, '.pyrun-out'));
ok(outAfterExpect.includes(BLOCK.expect), 'expect 값이 출력 영역에 표시된다', outAfterExpect.slice(0, 80));
ok(/예상/.test(outAfterExpect), '예상 출력임을 밝히는 표시가 있다', outAfterExpect.slice(0, 60));

/* ---------- 4. Pyodide 로드 실패 시 폴백 ---------- */
console.log('\n[4] CDN 차단 상황의 폴백 (Node 는 https import 를 거부하므로 자연 재현)');
find(host, '.pyrun-out').textContent = '';
find(host, '.pyrun-out')._html = '';
await find(host, '.pyrun-run')?.click();
await new Promise((r) => setTimeout(r, 1500));
const st = pyodideState();
const outAfterRun = textOf(find(host, '.pyrun-out'));
ok(st === 'failed' || st === 'loading', `로드 실패를 상태로 표시 (현재 ${st})`);
ok(outAfterRun.includes(BLOCK.expect), '폴백으로 expect 를 보여 준다', outAfterRun.slice(0, 100));
ok(/불러오지|실패|없/.test(outAfterRun), '한국어 안내 문구가 있다', outAfterRun.slice(0, 100));

/* ---------- 5. 되돌리기 ---------- */
console.log('\n[5] 편집·되돌리기');
const codeEl = find(host, '.pyrun-code');
if (codeEl && 'value' in codeEl) {
  codeEl.value = 'print(1)';
  find(host, '.pyrun-reset')?.click();
  ok(codeEl.value === BLOCK.source, '되돌리기가 원본 코드를 복원한다', codeEl.value.slice(0, 30));
} else {
  ok(true, '편집 불가 모드(pre)로 렌더 — 되돌리기 대상 없음');
}

/* ---------- 6. 콘텐츠의 모든 code 블록 마운트 ---------- */
console.log('\n[6] 콘텐츠의 모든 code 블록 마운트');
const LESSONS = path.resolve('../content/lessons');
let n = 0, bad = 0, noExpect = 0;
for (const f of fs.readdirSync(LESSONS).filter((x) => x.endsWith('.json'))) {
  const L = JSON.parse(fs.readFileSync(path.join(LESSONS, f), 'utf-8'));
  for (const b of (L.blocks ?? [])) {
    if (b.type !== 'code') continue;
    n++;
    if (!b.expect) noExpect++;
    const h2 = makeEl('div');
    try { mountPyRunner(h2, b); } catch (e) { bad++; console.log(`  FAIL ${f}: ${e.message}`); }
    if (!find(h2, '.pyrun-out')) { bad++; console.log(`  FAIL ${f}: 출력 영역 없음`); }
  }
}
ok(n > 0, `code 블록 ${n}개 발견`);
ok(bad === 0, `${n}개 전부 오류 없이 마운트`);
ok(noExpect === 0, `expect 가 빠진 블록 없음 (오프라인 폴백 전제)`);

/* ---------- 7. 잘못된 입력 ---------- */
console.log('\n[7] 잘못된 입력');
for (const [label, b] of Object.entries({
  'source 없음': { type: 'code', lang: 'python', expect: 'x' },
  'expect 없음': { type: 'code', lang: 'python', source: 'print(1)' },
  '빈 객체': {},
})) {
  const h3 = makeEl('div');
  let err = null;
  try { mountPyRunner(h3, b); } catch (e) { err = e; }
  ok(!err, `${label}: 예외를 던지지 않는다`, err?.message ?? '');
}

handle?.destroy?.();
console.log(`\n[경고 로그] ${warn.length}건${warn.length ? '\n  - ' + warn.slice(0, 5).join('\n  - ') : ''}`);
console.log(`\n결과: 통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
