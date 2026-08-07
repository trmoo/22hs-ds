/**
 * chart.js 헤드리스 검증.
 *
 * 브라우저 패널이 표시되지 않는 환경에서는 requestAnimationFrame 이 발화하지 않아
 * 캔버스 픽셀로 확인할 수 없다. 그래서 최소 DOM 과 기록형 2D 컨텍스트를 심어
 * (1) 순수 함수의 계산이 맞는지 (2) 그리기 경로가 실제로 마크를 찍는지 확인한다.
 *
 * 실행: node test/chart.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

/* ---------- 기록형 2D 컨텍스트 ---------- */
function makeCtx() {
  const calls = [];
  const rec = (name) => (...args) => { calls.push({ name, args }); };
  const ctx = {
    calls,
    canvas: null,
    font: '', fillStyle: '', strokeStyle: '', lineWidth: 1, textAlign: '', textBaseline: '',
    globalAlpha: 1, lineJoin: '', lineCap: '',
    save: rec('save'), restore: rec('restore'), translate: rec('translate'),
    rotate: rec('rotate'), scale: rec('scale'), setTransform: rec('setTransform'),
    clearRect: rec('clearRect'), fillRect: rec('fillRect'), strokeRect: rec('strokeRect'),
    beginPath: rec('beginPath'), closePath: rec('closePath'),
    moveTo: rec('moveTo'), lineTo: rec('lineTo'), arc: rec('arc'),
    rect: rec('rect'), roundRect: rec('roundRect'), ellipse: rec('ellipse'),
    arcTo: rec('arcTo'), quadraticCurveTo: rec('quadraticCurveTo'), bezierCurveTo: rec('bezierCurveTo'),
    clip: rec('clip'), stroke: rec('stroke'), fill: rec('fill'),
    fillText: rec('fillText'), strokeText: rec('strokeText'),
    setLineDash: rec('setLineDash'), getLineDash: () => [],
    measureText: (t) => ({ width: String(t).length * 6.5 }),
    createLinearGradient: () => ({ addColorStop() {} }),
  };
  return ctx;
}

/* ---------- 최소 DOM ---------- */
let elCount = 0;
function makeEl(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    _id: ++elCount,
    children: [],
    parentElement: null,
    attrs: {},
    style: {},
    dataset: {},
    classList: {
      _s: new Set(),
      add(...c) { c.forEach((x) => this._s.add(x)); },
      remove(...c) { c.forEach((x) => this._s.delete(x)); },
      contains(c) { return this._s.has(c); },
      toggle(c, on) { on === undefined ? (this._s.has(c) ? this._s.delete(c) : this._s.add(c)) : (on ? this._s.add(c) : this._s.delete(c)); },
    },
    textContent: '',
    innerHTML: '',
    offsetWidth: 760,
    offsetHeight: 380,
    clientWidth: 760,
    clientHeight: 380,
    width: 300,
    height: 150,
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k] ?? null; },
    removeAttribute(k) { delete this.attrs[k]; },
    hasAttribute(k) { return k in this.attrs; },
    appendChild(c) { c.parentElement = this; this.children.push(c); return c; },
    append(...cs) { cs.forEach((c) => typeof c === 'object' && this.appendChild(c)); },
    insertBefore(c) { return this.appendChild(c); },
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((x) => x !== this); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {}, removeEventListener() {},
    getBoundingClientRect() { return { width: this.offsetWidth, height: this.offsetHeight, top: 0, left: 0, bottom: this.offsetHeight, right: this.offsetWidth }; },
    getContext() { if (!this._ctx) { this._ctx = makeCtx(); this._ctx.canvas = this; } return this._ctx; },
  };
  return el;
}

globalThis.document = {
  createElement: makeEl,
  documentElement: makeEl('html'),
  body: makeEl('body'),
  addEventListener() {}, removeEventListener() {},
};
globalThis.window = { addEventListener() {}, removeEventListener() {}, devicePixelRatio: 2 };
globalThis.devicePixelRatio = 2;
globalThis.getComputedStyle = () => ({
  fontFamily: 'Pretendard, sans-serif',
  fontSize: '17px',
  getPropertyValue: (n) => ({
    '--chart-axis': '#7c8798', '--chart-grid': '#e7ecf2', '--chart-label': '#4a5768',
    '--chart-series-1': '#0d7d72', '--chart-series-2': '#1d5fd0', '--chart-series-3': '#9a6100',
    '--chart-series-4': '#7b3fb5', '--chart-series-5': '#b3261e',
    '--chart-emphasis': '#b3261e', '--chart-muted': '#b6bfcc', '--chart-bg': 'transparent',
  })[n] ?? '',
});
// 애니메이션을 끄고 즉시 최종 상태로 그리게 한다
globalThis.matchMedia = (q) => ({ matches: /reduced-motion/.test(q), addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
globalThis.requestAnimationFrame = (cb) => { cb(0); return 1; };
globalThis.cancelAnimationFrame = () => {};

const { renderChart, niceTicks, formatNumber, measureYAxisWidth, buildDataModel } =
  await import('../src/scripts/chart.js');

// chart.js 가 잘못된 입력에 경고를 남기는 것은 정상 동작이므로 로그만 조용히 모은다
const warnings = [];
console.warn = (...a) => warnings.push(a.map((x) => (typeof x === 'string' ? x : '[obj]')).join(' '));
console.error = (...a) => warnings.push('ERR ' + a.map((x) => (typeof x === 'string' ? x : '[obj]')).join(' '));

/* ---------- 검사 유틸 ---------- */
let pass = 0, fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log(`  OK   ${label}`); }
  else { fail++; console.log(`  FAIL ${label} ${extra}`); }
};

/* ---------- 1. niceTicks ---------- */
console.log('\n[1] niceTicks — 보기 좋은 눈금');
{
  // 반환 형태: { min, max, step, ticks: number[] }
  const r = niceTicks(0, 100, 5);
  const t = r.ticks;
  ok(Array.isArray(t) && t.length >= 2, 'ticks 배열을 돌려준다', JSON.stringify(r));
  ok(t.every((v, i) => i === 0 || v > t[i - 1]), '증가한다', JSON.stringify(t));
  ok(t.every((v, i) => i === 0 || Math.abs(v - t[i - 1] - r.step) < 1e-9), '간격이 일정하다', JSON.stringify(t));
  const mant = r.step / Math.pow(10, Math.floor(Math.log10(r.step)));
  ok([1, 2, 2.5, 5, 10].some((m) => Math.abs(mant - m) < 1e-9), '간격이 1·2·2.5·5 계열이다', `step=${r.step}`);
  ok(r.min <= 0 && r.max >= 100, '데이터 범위를 감싼다', JSON.stringify(r));

  const neg = niceTicks(-13, 47, 5);
  ok(neg.min <= -13 && neg.max >= 47, '음수 범위도 감싼다', JSON.stringify(neg));
  const flat = niceTicks(5, 5, 5);
  ok(Array.isArray(flat.ticks) && flat.ticks.length >= 1, '최솟값=최댓값도 죽지 않는다', JSON.stringify(flat));
}

/* ---------- 2. measureYAxisWidth ---------- */
console.log('\n[2] measureYAxisWidth — 라벨 길이에 따른 여백');
{
  const ctx = makeCtx();
  const narrow = measureYAxisWidth(ctx, ['0', '5', '10']);
  const wide = measureYAxisWidth(ctx, ['0', '50,000', '100,000']);
  ok(wide > narrow, '라벨이 길면 여백이 커진다', `narrow=${narrow} wide=${wide}`);
  ok(narrow > 0, '여백이 0보다 크다', String(narrow));
}

/* ---------- 3. 실제 콘텐츠의 chart 블록 전수 렌더 ---------- */
console.log('\n[3] 콘텐츠의 모든 chart 블록 렌더');
const LESSONS = path.resolve('../content/lessons');
const blocks = [];
for (const f of fs.readdirSync(LESSONS).filter((x) => x.endsWith('.json'))) {
  const L = JSON.parse(fs.readFileSync(path.join(LESSONS, f), 'utf-8'));
  for (const [i, b] of (L.blocks ?? []).entries()) {
    if (b.type === 'chart') blocks.push({ file: f, i, b });
  }
}
console.log(`  대상 ${blocks.length}개`);

const kindSeen = new Map();
let drewAll = true;
for (const { file, i, b } of blocks) {
  const host = makeEl('div');
  let handle = null, err = null;
  try { handle = renderChart(host, b); } catch (e) { err = e; }

  const canvas = (function find(el) {
    if (el.tagName === 'CANVAS') return el;
    for (const c of el.children) { const r = find(c); if (r) return r; }
    return null;
  })(host);

  const calls = canvas?._ctx?.calls ?? [];
  const marks = calls.filter((c) => ['fillRect', 'arc', 'stroke', 'fill', 'fillText'].includes(c.name)).length;
  const texts = calls.filter((c) => c.name === 'fillText').length;
  const sized = canvas && canvas.width > 300;

  const good = !err && canvas && marks > 0 && texts > 0 && sized;
  if (!good) drewAll = false;
  kindSeen.set(b.kind, (kindSeen.get(b.kind) ?? 0) + 1);
  if (!good) {
    console.log(`  FAIL ${file}[${i}] kind=${b.kind} err=${err?.message ?? '-'} marks=${marks} texts=${texts} sized=${sized}`);
  }
  handle?.destroy?.();
}
ok(drewAll, `${blocks.length}개 블록 전부 오류 없이 마크·라벨을 그린다`);
ok([...kindSeen.keys()].length >= 3, `쓰인 kind: ${[...kindSeen.entries()].map(([k, n]) => `${k}×${n}`).join(', ')}`);

/* ---------- 4. 5가지 kind 각각 ---------- */
console.log('\n[4] 5가지 kind 개별 확인');
const SAMPLES = {
  scatter: { kind: 'scatter', x: '시간', y: '점수', xLabel: '시간', yLabel: '점수', caption: '예시', data: [{ 시간: 1, 점수: 42 }, { 시간: 3, 점수: 53 }, { 시간: 6, 점수: 71 }] },
  line: { kind: 'line', x: '월', y: '값', xLabel: '월', yLabel: '값', caption: '예시', data: [{ 월: '3월', 값: 8200 }, { 월: '4월', 값: 7600 }, { 월: '5월', 값: 9100 }] },
  bar: { kind: 'bar', x: '요일', y: '잔반량', xLabel: '요일', yLabel: '잔반량(kg)', caption: '예시', data: [{ 요일: '월', 잔반량: 12 }, { 요일: '화', 잔반량: 9 }] },
  hist: { kind: 'hist', x: '구간', y: '학생 수', xLabel: '통학 시간(분)', yLabel: '학생 수(명)', caption: '예시', data: [{ 구간: '0~10', '학생 수': 3 }, { 구간: '10~20', '학생 수': 8 }, { 구간: '20~30', '학생 수': 5 }] },
  box: { kind: 'box', x: '동아리', y: '모금액', xLabel: '동아리', yLabel: '모금액(원)', caption: '예시', data: [{ 동아리: 'A', min: 1000, q1: 2000, median: 3000, q3: 4000, max: 9000 }] },
};
for (const [kind, block] of Object.entries(SAMPLES)) {
  const host = makeEl('div');
  let err = null, h = null;
  try { h = renderChart(host, block); } catch (e) { err = e; }
  const canvas = (function find(el) { if (el.tagName === 'CANVAS') return el; for (const c of el.children) { const r = find(c); if (r) return r; } return null; })(host);
  const calls = canvas?._ctx?.calls ?? [];
  const marks = calls.filter((c) => ['fillRect', 'arc', 'stroke', 'fill'].includes(c.name)).length;
  ok(!err && marks > 0, `${kind}: 마크 ${marks}개`, err?.message ?? '');
  h?.destroy?.();
}

/* ---------- 5. 잘못된 입력 ---------- */
console.log('\n[5] 잘못된 입력에서 죽지 않는다');
for (const [label, bad] of Object.entries({
  '빈 데이터': { kind: 'bar', data: [], x: 'a', y: 'b' },
  '미지원 kind': { kind: 'radar', data: [{ a: 1, b: 2 }], x: 'a', y: 'b' },
  'x 키 불일치': { kind: 'line', data: [{ a: 1, b: 2 }], x: 'zzz', y: 'b' },
  'null 데이터': { kind: 'bar', data: null, x: 'a', y: 'b' },
})) {
  const host = makeEl('div');
  let err = null;
  try { renderChart(host, bad); } catch (e) { err = e; }
  ok(!err, `${label}: 예외를 던지지 않는다`, err?.message ?? '');
}

/* ---------- 6. 데이터 재생성 금지 ---------- */
console.log('\n[6] 리사이즈해도 데이터를 다시 만들지 않는다');
{
  const block = JSON.parse(JSON.stringify(SAMPLES.scatter));
  const before = JSON.stringify(block);
  const host = makeEl('div');
  const h = renderChart(host, block);
  host.offsetWidth = 420;            // 크기를 바꾸고
  globalThis.window.addEventListener = () => {};
  h?.redraw?.();                     // 다시 그려도
  ok(JSON.stringify(block) === before, '입력 블록이 변형되지 않는다');
  const model1 = JSON.stringify(buildDataModel(block));
  const model2 = JSON.stringify(buildDataModel(block));
  ok(model1 === model2, 'buildDataModel 이 결정적이다(난수 없음)');
  h?.destroy?.();
}

console.log(`\n결과: 통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
