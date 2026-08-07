/* =============================================================================
 * chart.js — 「데이터 과학」 웹 교과서 공용 차트 모듈
 * -----------------------------------------------------------------------------
 * 이 파일 하나가 사이트의 모든 그래프를 담당한다.
 * 차트 종류마다 따로 손코딩하지 않는 이유는 레퍼런스 사이트에서 실제로 생긴
 * 결함 5가지를 구조적으로 막기 위해서다.
 *
 *   (1) 축 폰트가 본문 폰트와 어긋남   → 폰트를 getComputedStyle에서 읽는다
 *   (2) 색 하드코딩으로 테마 무시      → 색을 CSS 변수에서 읽는다
 *   (3) 리사이즈 때 데이터 재생성      → 데이터 모델을 1회만 만들고 다시 그리기만 한다
 *   (4) 인쇄하면 그래프가 사라짐        → 데이터 표 대체본을 항상 함께 만든다
 *   (5) 스크린리더가 읽을 수단이 없음   → role="img"+aria-label+데이터 표
 *
 * 외부 라이브러리를 쓰지 않는다. 빌드 도구 없이 브라우저가 그대로 실행한다.
 *
 * 공개 API
 *   renderChart(container, block) → { destroy() }
 *   renderAllCharts(root = document)
 * 검증용으로 순수 함수 몇 개를 함께 내보낸다(niceTicks, formatNumber,
 * measureYAxisWidth, buildDataModel).
 * ========================================================================== */

/* ---------------------------------------------------------------------------
 * 0. 상수
 * ------------------------------------------------------------------------ */

/** 지원하는 kind와 화면·낭독에 쓸 한국어 이름. */
const KIND_LABEL = {
  scatter: '산점도',
  line: '꺾은선그래프',
  bar: '막대그래프',
  hist: '히스토그램',
  box: '상자그림',
};

/**
 * CSS 변수와 폴백값.
 * 폴백은 "변수를 아직 정의하지 않은 페이지에서도 읽을 수 있는 그래프가 나온다"를
 * 보장하는 최소 안전망일 뿐이다. 실제 색은 CSS가 정한다.
 */
const COLOR_VARS = {
  axis: ['--chart-axis', '#51607a'],
  grid: ['--chart-grid', '#e3e9f2'],
  label: ['--chart-label', '#1e293b'],
  series1: ['--chart-series-1', '#0d9488'],
  series2: ['--chart-series-2', '#2563eb'],
  series3: ['--chart-series-3', '#d97706'],
  series4: ['--chart-series-4', '#7c3aed'],
  series5: ['--chart-series-5', '#16a34a'],
  emphasis: ['--chart-emphasis', '#dc2626'],
  muted: ['--chart-muted', '#8b97ad'],
  bg: ['--chart-bg', 'transparent'],
};

/** 애니메이션은 "막대·선이 자라는" 정도로만 짧게 준다. */
const ANIM_MS = 260;

/** 캔버스 버퍼가 과도하게 커지지 않게 DPR 상한을 둔다(고배율 화면 메모리 보호). */
const MAX_DPR = 3;

/** 상자그림 요약값 키 별칭. 영문 키와 한글 키를 모두 받는다. */
const BOX_KEY_ALIASES = {
  min: ['min', 'Min', '최솟값', '최소값'],
  q1: ['q1', 'Q1', '1사분위수', '제1사분위수', '1사분위'],
  median: ['median', 'med', 'Median', '중앙값'],
  q3: ['q3', 'Q3', '3사분위수', '제3사분위수', '3사분위'],
  max: ['max', 'Max', '최댓값', '최대값'],
};

/** 데이터 표 머리글에 쓸 상자그림 열 이름(한글 고정). */
const BOX_HEAD = ['최솟값', '1사분위수', '중앙값', '3사분위수', '최댓값'];

/* ---------------------------------------------------------------------------
 * 1. 작은 수치 유틸 — 모두 순수 함수라서 단위 검증이 쉽다
 * ------------------------------------------------------------------------ */

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * 값을 수치로 바꾼다. 실패하면 NaN이다.
 * "1,280"처럼 쉼표가 들어간 문자열도 받는다(집필 규칙이 천 단위 쉼표를 쓰므로).
 */
function toNum(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v === 'string') {
    const s = v.trim().replace(/,/g, '').replace(/−/g, '-'); // 유니코드 마이너스 허용
    if (s === '') return NaN;
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
}

/** 부동소수 오차로 눈금이 0.30000000000000004가 되는 것을 막는다. */
function roundTo(v, decimals) {
  const p = Math.pow(10, clamp(decimals, 0, 12));
  return Math.round(v * p) / p;
}

/** 눈금 간격에서 표시할 소수 자릿수를 정한다. */
function decimalsForStep(step) {
  if (!Number.isFinite(step) || step <= 0) return 0;
  if (step >= 1) return 0;
  return Math.min(6, Math.ceil(-Math.log10(step)));
}

/**
 * "보기 좋은 수" 눈금을 만든다. 간격은 1·2·5·10 계열만 쓴다.
 * 데이터 범위를 늘리기만 하고 값을 바꾸지는 않는다(데이터 생성 금지 규칙).
 *
 * @param {number} min 데이터 최솟값
 * @param {number} max 데이터 최댓값
 * @param {number} count 원하는 눈금 개수(대략)
 * @returns {{min:number,max:number,step:number,ticks:number[]}}
 */
export function niceTicks(min, max, count = 5) {
  let lo = toNum(min);
  let hi = toNum(max);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { min: 0, max: 1, step: 1, ticks: [0, 1] };
  if (hi < lo) [lo, hi] = [hi, lo];

  // 값이 하나뿐이면(모두 같은 값) 축이 납작해지므로 최소 폭을 준다.
  if (hi - lo < 1e-12) {
    const pad = Math.abs(hi) > 1e-12 ? Math.abs(hi) * 0.1 : 1;
    lo -= pad;
    hi += pad;
  }

  const want = Math.max(2, Math.round(count));
  const rawStep = (hi - lo) / want;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const mult = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  const step = mult * mag;

  const dec = decimalsForStep(step) + 2; // 경계값에도 오차 보정을 적용한다
  const niceMin = roundTo(Math.floor(lo / step) * step, dec);
  const niceMax = roundTo(Math.ceil(hi / step) * step, dec);

  const ticks = [];
  // 개수 상한을 둬서 step 계산이 틀어져도 무한 루프가 되지 않게 한다.
  for (let i = 0, v = niceMin; i <= 200 && v <= niceMax + step * 1e-6; i += 1, v = niceMin + step * i) {
    ticks.push(roundTo(v, dec));
  }
  if (ticks.length < 2) ticks.push(roundTo(niceMin + step, dec));
  return { min: niceMin, max: niceMax, step, ticks };
}

/**
 * 수를 사람이 읽는 형태로 만든다.
 * 문체 규칙(§4-3)에 따라 천 단위는 쉼표, 음수는 유니코드 마이너스(−)를 쓴다.
 * decimals를 주지 않으면 원자료의 소수 자릿수를 그대로 보존한다.
 */
export function formatNumber(value, decimals) {
  const n = typeof value === 'number' ? value : toNum(value);
  if (!Number.isFinite(n)) return value === null || value === undefined ? '' : String(value);

  let s = decimals === undefined || decimals === null ? String(n) : n.toFixed(decimals);
  if (s.includes('e')) return s; // 지수 표기는 손대지 않는다

  const neg = s.startsWith('-');
  if (neg) s = s.slice(1);
  const dot = s.indexOf('.');
  let int = dot === -1 ? s : s.slice(0, dot);
  const frac = dot === -1 ? '' : s.slice(dot + 1);
  int = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '−' : '') + int + (frac ? '.' + frac : '');
}

/**
 * y축 눈금 라벨의 실제 텍스트 폭을 재서 왼쪽 여백을 정한다.
 * 하드코딩하면 "1,280,000"처럼 긴 라벨이 잘리므로 반드시 measureText로 잰다.
 *
 * @param {CanvasRenderingContext2D} ctx 눈금 폰트가 이미 설정된 컨텍스트
 * @param {string[]} labels 눈금 라벨
 * @returns {number} 왼쪽 여백(px)
 */
export function measureYAxisWidth(ctx, labels, opts = {}) {
  const { tickLen = 4, gap = 6, hasTitle = false, titlePx = 13, titleGap = 6, min = 28 } = opts;
  let w = 0;
  for (const l of labels || []) {
    const m = ctx && typeof ctx.measureText === 'function' ? ctx.measureText(String(l)) : null;
    const mw = m && Number.isFinite(m.width) ? m.width : String(l).length * 7;
    if (mw > w) w = mw;
  }
  let pad = tickLen + gap + w + 2;
  if (hasTitle) pad += titlePx + titleGap;
  return Math.max(min, Math.ceil(pad));
}

/** 폰트 문자열을 만든다. family는 항상 본문에서 읽어 온 값이다. */
function fontStr(px, family, weight) {
  return `${weight ? weight + ' ' : ''}${Math.round(px)}px ${family}`;
}

/** 본문 글자 크기에서 축·라벨 글자 크기를 파생한다(본문과 어긋나지 않게). */
function fontSizes(basePx) {
  const base = Number.isFinite(basePx) && basePx > 0 ? basePx : 16;
  return {
    tick: clamp(Math.round(base * 0.75), 10, 14),
    title: clamp(Math.round(base * 0.8), 11, 15),
    value: clamp(Math.round(base * 0.7), 10, 13),
    note: clamp(Math.round(base * 0.7), 10, 13),
  };
}

/** 텍스트가 maxW를 넘으면 말줄임한다(라벨이 길어도 여백이 폭주하지 않게). */
function ellipsize(ctx, text, maxW) {
  const s = String(text);
  if (ctx.measureText(s).width <= maxW) return s;
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(s.slice(0, mid) + '…').width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return lo <= 0 ? '…' : s.slice(0, lo) + '…';
}

/** 1px 선을 또렷하게 그리기 위한 반픽셀 정렬. */
function crisp(v) {
  return Math.round(v) + 0.5;
}

function easeOutCubic(t) {
  const u = 1 - t;
  return 1 - u * u * u;
}

/* ---------------------------------------------------------------------------
 * 2. 데이터 모델 — renderChart에서 "단 한 번만" 만든다
 * ---------------------------------------------------------------------------
 * 리사이즈·테마 변경 때는 이 모델을 그대로 다시 그릴 뿐이다.
 * 통계값이 화면 크기에 따라 달라지는 레퍼런스의 버그는 여기서 원천 차단된다.
 * ------------------------------------------------------------------------ */

/** 요약값 객체에서 별칭 중 하나를 찾아 수치로 돌려준다. */
function pickBoxValue(row, aliases) {
  for (const k of aliases) {
    if (Object.prototype.hasOwnProperty.call(row, k)) {
      const n = toNum(row[k]);
      if (Number.isFinite(n)) return n;
    }
  }
  return NaN;
}

/**
 * 정렬된 수치 배열의 분위수(선형 보간). 상자그림에 요약값이 없을 때만 쓴다.
 * 이것은 데이터 "생성"이 아니라 주어진 값의 집계이며, 모델 생성 시점에 한 번만
 * 계산하고 캐시하므로 리사이즈로 값이 바뀌지 않는다.
 */
function quantileSorted(sorted, p) {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * chart 블록을 그리기 좋은 모델로 바꾼다.
 * 실패해도 예외를 던지지 않고 { error } 를 담아 돌려준다.
 */
export function buildDataModel(block) {
  const b = block && typeof block === 'object' ? block : {};
  const kind = typeof b.kind === 'string' ? b.kind : '';
  const rows = Array.isArray(b.data) ? b.data.filter((r) => r && typeof r === 'object') : [];
  const xKey = b.x;
  const yKey = b.y;

  const model = {
    kind,
    xKey,
    yKey,
    xLabel: typeof b.xLabel === 'string' ? b.xLabel : '',
    yLabel: typeof b.yLabel === 'string' ? b.yLabel : '',
    caption: typeof b.caption === 'string' ? b.caption : '',
    annotations: Array.isArray(b.annotations) ? b.annotations : [],
    xScaleType: 'band', // 'linear' | 'band'
    categories: [],
    points: [],
    bars: [],
    boxes: [],
    xMin: 0,
    xMax: 1,
    yMin: 0,
    yMax: 1,
    dropped: 0,
    boxComputed: false,
    error: '',
    table: { head: [], rows: [] },
  };

  if (!KIND_LABEL[kind]) {
    model.error = `지원하지 않는 그래프 종류다(kind: ${kind || '없음'}).`;
    return model;
  }
  if (rows.length === 0) {
    model.error = '표시할 데이터가 없다.';
    return model;
  }
  if (typeof xKey !== 'string' || typeof yKey !== 'string') {
    model.error = 'x·y 키 이름이 지정되지 않았다.';
    return model;
  }

  const xName = model.xLabel || xKey;
  const yName = model.yLabel || yKey;

  if (kind === 'scatter' || kind === 'line') {
    // x가 전부 수치면 선형축, 하나라도 아니면 범주축으로 본다.
    // (집필 규약은 수치를 전제하지만 "1월"처럼 범주가 들어온 차시가 있어
    //  안내 문구로 죽이는 대신 순서축으로 정직하게 그린다.)
    const allNumeric = rows.every((r) => Number.isFinite(toNum(r[xKey])));
    model.xScaleType = allNumeric ? 'linear' : 'band';

    rows.forEach((r, i) => {
      const yv = toNum(r[yKey]);
      if (!Number.isFinite(yv)) {
        model.dropped += 1;
        return;
      }
      const rawX = r[xKey];
      if (allNumeric) {
        model.points.push({ x: toNum(rawX), y: yv, raw: rawX });
      } else {
        const label = rawX === undefined || rawX === null ? String(i + 1) : String(rawX);
        model.categories.push(label);
        model.points.push({ x: model.categories.length - 1, y: yv, raw: label });
      }
    });
    if (model.points.length === 0) {
      model.error = '수치로 읽을 수 있는 데이터가 없다.';
      return model;
    }
    const xs = model.points.map((p) => p.x);
    const ys = model.points.map((p) => p.y);
    model.xMin = Math.min(...xs);
    model.xMax = Math.max(...xs);
    model.yMin = Math.min(...ys);
    model.yMax = Math.max(...ys);
    model.table.head = [xName, yName];
    model.table.rows = model.points.map((p) => [
      model.xScaleType === 'linear' ? formatNumber(p.raw) : String(p.raw),
      formatNumber(p.y),
    ]);
  } else if (kind === 'bar' || kind === 'hist') {
    rows.forEach((r, i) => {
      const v = toNum(r[yKey]);
      if (!Number.isFinite(v)) {
        model.dropped += 1;
        return;
      }
      const rawX = r[xKey];
      const label = rawX === undefined || rawX === null || rawX === '' ? String(i + 1) : String(rawX);
      model.categories.push(label);
      model.bars.push({ label, value: v });
    });
    if (model.bars.length === 0) {
      model.error = '수치로 읽을 수 있는 도수·값이 없다.';
      return model;
    }
    const vs = model.bars.map((d) => d.value);
    // 막대는 0에서 시작해야 길이 비교가 정직하다. 그래서 0을 반드시 포함한다.
    model.yMin = Math.min(0, ...vs);
    model.yMax = Math.max(0, ...vs);
    model.table.head = [xName, yName];
    model.table.rows = model.bars.map((d) => [d.label, formatNumber(d.value)]);
  } else if (kind === 'box') {
    const hasSummary = rows.some(
      (r) => Number.isFinite(pickBoxValue(r, BOX_KEY_ALIASES.median)) && Number.isFinite(pickBoxValue(r, BOX_KEY_ALIASES.q1))
    );
    if (hasSummary) {
      rows.forEach((r, i) => {
        const rawX = r[xKey];
        const label = rawX === undefined || rawX === null || rawX === '' ? String(i + 1) : String(rawX);
        const box = {
          label,
          min: pickBoxValue(r, BOX_KEY_ALIASES.min),
          q1: pickBoxValue(r, BOX_KEY_ALIASES.q1),
          median: pickBoxValue(r, BOX_KEY_ALIASES.median),
          q3: pickBoxValue(r, BOX_KEY_ALIASES.q3),
          max: pickBoxValue(r, BOX_KEY_ALIASES.max),
        };
        if (![box.min, box.q1, box.median, box.q3, box.max].every(Number.isFinite)) {
          model.dropped += 1;
          return;
        }
        model.categories.push(label);
        model.boxes.push(box);
      });
    } else {
      // 요약값이 없고 범주별 원자료가 들어온 경우다.
      // 다섯 수 요약을 이 시점에 한 번만 계산해 모델에 넣는다(리사이즈와 무관).
      const groups = new Map();
      rows.forEach((r) => {
        const v = toNum(r[yKey]);
        if (!Number.isFinite(v)) {
          model.dropped += 1;
          return;
        }
        const rawX = r[xKey];
        const label = rawX === undefined || rawX === null || rawX === '' ? '전체' : String(rawX);
        if (!groups.has(label)) groups.set(label, []);
        groups.get(label).push(v);
      });
      for (const [label, values] of groups) {
        const sorted = values.slice().sort((a, b2) => a - b2);
        model.categories.push(label);
        model.boxes.push({
          label,
          min: sorted[0],
          q1: quantileSorted(sorted, 0.25),
          median: quantileSorted(sorted, 0.5),
          q3: quantileSorted(sorted, 0.75),
          max: sorted[sorted.length - 1],
          n: sorted.length,
        });
      }
      model.boxComputed = true;
    }
    if (model.boxes.length === 0) {
      model.error = '상자그림을 그릴 요약값이 없다.';
      return model;
    }
    model.yMin = Math.min(...model.boxes.map((d) => d.min));
    model.yMax = Math.max(...model.boxes.map((d) => d.max));
    model.table.head = [xName, ...BOX_HEAD];
    model.table.rows = model.boxes.map((d) => [
      d.label,
      formatNumber(roundTo(d.min, 6)),
      formatNumber(roundTo(d.q1, 6)),
      formatNumber(roundTo(d.median, 6)),
      formatNumber(roundTo(d.q3, 6)),
      formatNumber(roundTo(d.max, 6)),
    ]);
  }

  if (model.xScaleType === 'band') {
    model.xMin = 0;
    model.xMax = Math.max(1, model.categories.length - 1);
  }
  return model;
}

/* ---------------------------------------------------------------------------
 * 3. 테마 읽기 — 색과 폰트는 전부 CSS에서 온다
 * ------------------------------------------------------------------------ */

/**
 * 컨테이너의 계산된 스타일에서 색·폰트를 읽는다.
 * 매번 다시 그릴 때 호출하므로, 테마를 바꾸면 다음 렌더에 그대로 반영된다.
 */
function readTheme(container) {
  let cs = null;
  if (typeof getComputedStyle === 'function') {
    try {
      cs = getComputedStyle(container);
    } catch (e) {
      cs = null;
    }
  }
  const get = (name, fallback) => {
    if (!cs || typeof cs.getPropertyValue !== 'function') return fallback;
    const v = cs.getPropertyValue(name);
    const t = typeof v === 'string' ? v.trim() : '';
    return t || fallback;
  };

  const theme = {};
  for (const key of Object.keys(COLOR_VARS)) {
    const [varName, fallback] = COLOR_VARS[key];
    theme[key] = get(varName, fallback);
  }
  theme.series = [theme.series1, theme.series2, theme.series3, theme.series4, theme.series5];

  // 폰트도 본문에서 읽는다. sans-serif 하드코딩은 축 글꼴이 본문과 어긋나는 원인이었다.
  const family = cs && typeof cs.fontFamily === 'string' ? cs.fontFamily.trim() : '';
  theme.font = family || 'system-ui, sans-serif'; // 계산 스타일이 없는 환경(테스트)의 최후 수단
  const size = cs && cs.fontSize ? parseFloat(cs.fontSize) : NaN;
  theme.baseSize = Number.isFinite(size) && size > 0 ? size : 16;
  return theme;
}

/** 색이 사실상 투명한지 본다(배경 칠·글자 후광을 건너뛰기 위해). */
function isTransparent(color) {
  const c = String(color || '').trim().toLowerCase();
  return c === '' || c === 'transparent' || c === 'none' || /^rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)$/.test(c);
}

/** 애니메이션을 줄이라는 설정인지 확인한다. */
function prefersReducedMotion() {
  if (typeof matchMedia !== 'function') return true; // 확인 불가하면 애니메이션을 쓰지 않는다
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches === true;
  } catch (e) {
    return true;
  }
}

/* ---------------------------------------------------------------------------
 * 4. 레이아웃 — 여백을 측정으로 정한다
 * ------------------------------------------------------------------------ */

/**
 * 그릴 영역(플롯 사각형)과 눈금을 계산한다.
 * 왼쪽 여백은 y축 눈금 라벨의 실제 폭, 아래 여백은 x축 라벨의 실제 폭에서 나온다.
 * 두 번 훑는 이유: y라벨 폭이 정해져야 플롯 너비가 나오고, 플롯 너비가 정해져야
 * x축 눈금 개수·회전 여부가 정해지기 때문이다(순환을 2패스로 끊는다).
 */
function computeLayout(ctx, model, cssW, cssH, theme) {
  const F = fontSizes(theme.baseSize);
  const TICK = 4;
  const GAP = 6;
  const isBarLike = model.kind === 'bar' || model.kind === 'hist';

  // 값 라벨을 막대 위에 쓰므로 위 여백에 미리 자리를 잡아 둔다(라벨이 잘리지 않게).
  const top = isBarLike ? F.value + 10 : 10;

  // --- 1패스: y 눈금 (도메인은 데이터에서만 나오므로 화면 크기와 무관하다)
  const bottomGuess = TICK + GAP + F.tick + (model.xLabel ? F.title + 6 : 0) + 2;
  const plotHGuess = Math.max(40, cssH - top - bottomGuess);
  const yCount = clamp(Math.round(plotHGuess / 52), 2, 8);
  const yT = niceTicks(model.yMin, model.yMax, yCount);
  const yDec = decimalsForStep(yT.step);
  const yLabels = yT.ticks.map((t) => formatNumber(t, yDec));

  ctx.font = fontStr(F.tick, theme.font);
  const left = measureYAxisWidth(ctx, yLabels, {
    tickLen: TICK,
    gap: GAP,
    hasTitle: !!model.yLabel,
    titlePx: F.title,
  });

  // --- 2패스: x 눈금 / 라벨 회전 / 아래·오른쪽 여백
  let right = 12;
  let plotW = Math.max(40, cssW - left - right);

  let xTicks = [];
  let xLabels = [];
  let rotate = false;
  let stride = 1;
  let xT = null;

  if (model.xScaleType === 'linear') {
    const xCount = clamp(Math.round(plotW / 90), 2, 8);
    xT = niceTicks(model.xMin, model.xMax, xCount);
    const xDec = decimalsForStep(xT.step);
    xTicks = xT.ticks;
    xLabels = xTicks.map((t) => formatNumber(t, xDec));
    // 마지막 라벨이 오른쪽으로 삐져나가는 만큼만 오른쪽 여백을 준다.
    const lastW = ctx.measureText(xLabels[xLabels.length - 1] || '').width;
    right = Math.max(12, Math.ceil(lastW / 2) + 4);
    plotW = Math.max(40, cssW - left - right);
    // 라벨이 겹치면 건너뛰며 표시한다.
    let maxW = 0;
    for (const l of xLabels) maxW = Math.max(maxW, ctx.measureText(l).width);
    const slot = plotW / Math.max(1, xTicks.length - 1);
    stride = Math.max(1, Math.ceil((maxW + 10) / Math.max(1, slot)));
  } else {
    xLabels = model.categories.slice();
    const band = plotW / Math.max(1, xLabels.length);
    let maxW = 0;
    for (const l of xLabels) maxW = Math.max(maxW, ctx.measureText(l).width);
    // 범주 라벨이 밴드 폭보다 넓으면 45도로 눕힌다(잘라 버리는 것보다 정보가 남는다).
    rotate = maxW > band - 6;
    stride = rotate
      ? // 눕힌 라벨은 글자 높이만큼의 밴드 폭이 있으면 겹치지 않는다.
        Math.max(1, Math.ceil((F.tick + 5) / Math.max(1, band)))
      : Math.max(1, Math.ceil((maxW + 8) / Math.max(1, band)));
  }

  // 아래 여백: 회전 여부에 따라 필요한 높이가 달라진다.
  let labelSpace = F.tick;
  if (rotate) {
    let maxW = 0;
    for (let i = 0; i < xLabels.length; i += stride) maxW = Math.max(maxW, ctx.measureText(xLabels[i]).width);
    labelSpace = Math.ceil(maxW * 0.7071) + 2;
  }
  let bottom = TICK + GAP + labelSpace + (model.xLabel ? F.title + 6 : 0) + 2;
  const bottomCap = Math.round(cssH * 0.42);
  let labelMaxW = Infinity;
  if (bottom > bottomCap) {
    // 여백이 그림을 잡아먹기 시작하면 라벨을 말줄임한다.
    const room = bottomCap - (TICK + GAP + (model.xLabel ? F.title + 6 : 0) + 2 + 2);
    labelMaxW = rotate ? Math.max(20, room / 0.7071) : Infinity;
    bottom = bottomCap;
  }

  const plotH = Math.max(40, cssH - top - bottom);
  plotW = Math.max(40, cssW - left - right);

  const x0 = left;
  const x1 = left + plotW;
  const y0 = top + plotH; // 아래쪽(값이 작은 쪽)
  const y1 = top; // 위쪽(값이 큰 쪽)

  const sy = (v) => y0 - ((v - yT.min) / (yT.max - yT.min || 1)) * plotH;
  const sx =
    model.xScaleType === 'linear'
      ? (v) => x0 + ((v - xT.min) / (xT.max - xT.min || 1)) * plotW
      : null;
  const band = plotW / Math.max(1, model.categories.length || 1);
  const center = (i) => x0 + band * (i + 0.5);

  return {
    F, TICK, GAP,
    left, right, top, bottom, plotW, plotH,
    x0, x1, y0, y1,
    yT, yLabels, xT, xTicks, xLabels, rotate, stride, labelMaxW,
    sy, sx, band, center,
  };
}

/* ---------------------------------------------------------------------------
 * 5. 그리기
 * ------------------------------------------------------------------------ */

function drawAxes(ctx, model, L, theme) {
  const { x0, x1, y0, y1, F } = L;

  // 격자선(옅게) — 세로축 눈금마다 수평선
  ctx.save();
  ctx.strokeStyle = theme.grid;
  ctx.lineWidth = 1;
  for (const t of L.yT.ticks) {
    const y = crisp(L.sy(t));
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
  }
  // 선형 x축은 세로 격자선도 옅게 넣는다(값 읽기가 쉬워진다).
  if (model.xScaleType === 'linear' && L.xTicks.length) {
    for (let i = 0; i < L.xTicks.length; i += L.stride) {
      const x = crisp(L.sx(L.xTicks[i]));
      ctx.beginPath();
      ctx.moveTo(x, y1);
      ctx.lineTo(x, y0);
      ctx.stroke();
    }
  }
  ctx.restore();

  // L자 축
  ctx.save();
  ctx.strokeStyle = theme.axis;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(crisp(x0), y1);
  ctx.lineTo(crisp(x0), crisp(y0));
  ctx.lineTo(x1, crisp(y0));
  ctx.stroke();

  // y축 눈금 + 라벨
  ctx.fillStyle = theme.label;
  ctx.font = fontStr(F.tick, theme.font);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  L.yT.ticks.forEach((t, i) => {
    const y = crisp(L.sy(t));
    ctx.beginPath();
    ctx.moveTo(crisp(x0) - L.TICK, y);
    ctx.lineTo(crisp(x0), y);
    ctx.strokeStyle = theme.axis;
    ctx.stroke();
    ctx.fillText(L.yLabels[i], x0 - L.TICK - L.GAP, y);
  });

  // x축 눈금 + 라벨
  ctx.strokeStyle = theme.axis;
  if (model.xScaleType === 'linear') {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let i = 0; i < L.xTicks.length; i += L.stride) {
      const x = crisp(L.sx(L.xTicks[i]));
      ctx.beginPath();
      ctx.moveTo(x, crisp(y0));
      ctx.lineTo(x, crisp(y0) + L.TICK);
      ctx.stroke();
      ctx.fillText(L.xLabels[i], x, y0 + L.TICK + L.GAP - 2);
    }
  } else {
    for (let i = 0; i < L.xLabels.length; i += L.stride) {
      const x = L.center(i);
      ctx.beginPath();
      ctx.moveTo(crisp(x), crisp(y0));
      ctx.lineTo(crisp(x), crisp(y0) + L.TICK);
      ctx.stroke();
      const text = Number.isFinite(L.labelMaxW) ? ellipsize(ctx, L.xLabels[i], L.labelMaxW) : L.xLabels[i];
      if (L.rotate) {
        ctx.save();
        ctx.translate(x, y0 + L.TICK + L.GAP - 2);
        ctx.rotate(-Math.PI / 4);
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 0, 0);
        ctx.restore();
      } else {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(text, x, y0 + L.TICK + L.GAP - 2);
      }
    }
  }

  // 축 제목 — 세로축은 회전한다
  ctx.fillStyle = theme.label;
  ctx.font = fontStr(F.title, theme.font, '600');
  if (model.xLabel) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(ellipsize(ctx, model.xLabel, L.plotW), x0 + L.plotW / 2, y0 + L.bottom - 2);
  }
  if (model.yLabel) {
    ctx.save();
    ctx.translate(F.title, y1 + L.plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(ellipsize(ctx, model.yLabel, L.plotH), 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

function drawScatter(ctx, model, L, theme, p) {
  ctx.save();
  ctx.globalAlpha = p;
  ctx.fillStyle = theme.series[0];
  const r = clamp(Math.min(L.plotW, L.plotH) / 60, 3, 5.5) * (0.6 + 0.4 * p);
  for (const pt of model.points) {
    const x = model.xScaleType === 'linear' ? L.sx(pt.x) : L.center(pt.x);
    const y = L.sy(pt.y);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawLine(ctx, model, L, theme, p) {
  ctx.save();
  // 선이 자라는 연출은 플롯을 가로로 잘라 보여 주는 것으로 충분하다.
  ctx.beginPath();
  ctx.rect(L.x0 - 1, L.y1 - 8, L.plotW * p + 2, L.plotH + 16);
  ctx.clip();

  ctx.strokeStyle = theme.series[0];
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  model.points.forEach((pt, i) => {
    const x = model.xScaleType === 'linear' ? L.sx(pt.x) : L.center(pt.x);
    const y = L.sy(pt.y);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // 값의 위치를 짚어 주는 작은 점
  ctx.fillStyle = theme.series[0];
  const r = model.points.length > 40 ? 0 : 3;
  if (r > 0) {
    for (const pt of model.points) {
      const x = model.xScaleType === 'linear' ? L.sx(pt.x) : L.center(pt.x);
      ctx.beginPath();
      ctx.arc(x, L.sy(pt.y), r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawBars(ctx, model, L, theme, p) {
  const isHist = model.kind === 'hist';
  const base = L.sy(clamp(0, L.yT.min, L.yT.max));
  // 히스토그램은 계급이 이어져 있음을 보이기 위해 막대를 붙인다.
  // 막대그래프는 범주가 떨어져 있으므로 사이를 띄운다.
  const w = isHist ? Math.max(1, L.band - 1) : Math.min(L.band * 0.62, 72);

  ctx.save();
  model.bars.forEach((d, i) => {
    const cx = L.center(i);
    const yv = L.sy(d.value);
    const h = (yv - base) * p; // 아래(또는 위)에서 자란다
    ctx.fillStyle = theme.series[0];
    ctx.globalAlpha = 0.92;
    ctx.fillRect(cx - w / 2, base, w, h);
    if (isHist) {
      // 계급 경계를 보이게 얇은 테두리를 준다
      ctx.globalAlpha = 1;
      ctx.strokeStyle = theme.bg && !isTransparent(theme.bg) ? theme.bg : theme.grid;
      ctx.lineWidth = 1;
      ctx.strokeRect(crisp(cx - w / 2), crisp(base), Math.round(w), Math.round(h));
    }
  });

  // 값 라벨 — 막대가 좁으면 생략한다
  ctx.globalAlpha = p;
  ctx.fillStyle = theme.label;
  ctx.font = fontStr(L.F.value, theme.font);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  if (w >= 24) {
    model.bars.forEach((d, i) => {
      const text = formatNumber(d.value);
      if (ctx.measureText(text).width > L.band - 2) return; // 겹치면 쓰지 않는다
      const cx = L.center(i);
      const yv = base + (L.sy(d.value) - base) * p;
      const above = d.value >= 0;
      ctx.textBaseline = above ? 'bottom' : 'top';
      ctx.fillText(text, cx, above ? yv - 4 : yv + 4);
    });
  }
  ctx.restore();
}

function drawBoxes(ctx, model, L, theme, p) {
  const w = Math.min(L.band * 0.5, 64);
  ctx.save();
  ctx.lineWidth = 1.5;
  model.boxes.forEach((d, i) => {
    const cx = L.center(i);
    const med = L.sy(d.median);
    // 중앙값에서 바깥으로 펼쳐지는 연출. p=1이면 정확한 위치다.
    const at = (v) => med + (L.sy(v) - med) * p;
    const yq1 = at(d.q1);
    const yq3 = at(d.q3);
    const ymin = at(d.min);
    const ymax = at(d.max);

    // 수염
    ctx.strokeStyle = theme.axis;
    ctx.beginPath();
    ctx.moveTo(crisp(cx), ymax);
    ctx.lineTo(crisp(cx), yq3);
    ctx.moveTo(crisp(cx), yq1);
    ctx.lineTo(crisp(cx), ymin);
    ctx.stroke();
    // 수염 끝 가로선
    ctx.beginPath();
    ctx.moveTo(cx - w * 0.28, crisp(ymax));
    ctx.lineTo(cx + w * 0.28, crisp(ymax));
    ctx.moveTo(cx - w * 0.28, crisp(ymin));
    ctx.lineTo(cx + w * 0.28, crisp(ymin));
    ctx.stroke();

    // 상자(1사분위수~3사분위수)
    const boxTop = Math.min(yq1, yq3);
    const boxH = Math.max(1, Math.abs(yq3 - yq1));
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = theme.series[0];
    ctx.fillRect(cx - w / 2, boxTop, w, boxH);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = theme.series[0];
    ctx.strokeRect(crisp(cx - w / 2), crisp(boxTop), Math.round(w), Math.round(boxH));

    // 중앙값 — 가장 굵게, 강조색으로
    ctx.strokeStyle = theme.emphasis;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - w / 2, crisp(med));
    ctx.lineTo(cx + w / 2, crisp(med));
    ctx.stroke();
    ctx.lineWidth = 1.5;
  });
  ctx.restore();
}

/** 주석의 x 좌표를 픽셀로 바꾼다. 범주축이면 라벨 또는 인덱스로 찾는다. */
function annX(model, L, v) {
  if (model.xScaleType === 'linear') {
    const n = toNum(v);
    return Number.isFinite(n) ? L.sx(n) : NaN;
  }
  const i = model.categories.indexOf(String(v));
  if (i >= 0) return L.center(i);
  const n = toNum(v);
  if (Number.isFinite(n) && n >= 0 && n < model.categories.length) return L.center(Math.round(n));
  return NaN;
}

/** 주석 라벨을 배경 후광과 함께 쓴다(격자선 위에서도 읽히게). */
function drawAnnLabel(ctx, text, x, y, theme, F, align) {
  if (!text) return;
  ctx.save();
  ctx.font = fontStr(F.note, theme.font, '600');
  ctx.textAlign = align || 'left';
  ctx.textBaseline = 'middle';
  if (!isTransparent(theme.bg)) {
    const w = ctx.measureText(text).width;
    const h = F.note + 4;
    const bx = align === 'right' ? x - w - 3 : align === 'center' ? x - w / 2 - 3 : x - 3;
    ctx.fillStyle = theme.bg;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(bx, y - h / 2, w + 6, h);
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = theme.label;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function drawAnnotations(ctx, model, L, theme, p) {
  if (!model.annotations.length) return;
  ctx.save();
  ctx.globalAlpha = p;
  for (const a of model.annotations) {
    if (!a || typeof a !== 'object') continue;
    const dashed = a.style !== 'solid';
    if (a.type === 'line' && Array.isArray(a.from) && Array.isArray(a.to)) {
      const x1 = annX(model, L, a.from[0]);
      const x2 = annX(model, L, a.to[0]);
      const y1 = L.sy(toNum(a.from[1]));
      const y2 = L.sy(toNum(a.to[1]));
      if (![x1, x2, y1, y2].every(Number.isFinite)) continue;
      ctx.strokeStyle = theme.series[2] || theme.emphasis;
      ctx.lineWidth = 2;
      ctx.setLineDash(dashed ? [6, 4] : []);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.setLineDash([]);
      // 라벨은 선의 끝 쪽에 붙인다(오른쪽 끝이 잘리면 왼쪽으로).
      const endRight = x2 >= x1;
      const lx = endRight ? Math.min(x2, L.x1) : Math.max(x2, L.x0);
      drawAnnLabel(ctx, a.label, endRight ? lx - 4 : lx + 4, endRight ? y2 - 10 : y2 - 10, theme, L.F, endRight ? 'right' : 'left');
    } else if (a.type === 'hline') {
      const y = L.sy(toNum(a.y));
      if (!Number.isFinite(y)) continue;
      ctx.strokeStyle = theme.muted;
      ctx.lineWidth = 1.5;
      ctx.setLineDash(a.style === 'solid' ? [] : [6, 4]);
      ctx.beginPath();
      ctx.moveTo(L.x0, crisp(y));
      ctx.lineTo(L.x1, crisp(y));
      ctx.stroke();
      ctx.setLineDash([]);
      const ly = y - 9 < L.y1 ? y + 9 : y - 9;
      drawAnnLabel(ctx, a.label, L.x1 - 4, ly, theme, L.F, 'right');
    } else if (a.type === 'point') {
      const x = annX(model, L, a.x);
      const y = L.sy(toNum(a.y));
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const color = a.emphasis ? theme.emphasis : theme.series[1] || theme.series[0];
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 2;
      if (a.emphasis) {
        // 강조점은 고리로 감싸 눈에 띄게 한다
        ctx.beginPath();
        ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(x, y, 4.5, 0, Math.PI * 2);
        ctx.fill();
      }
      const align = x > L.x0 + L.plotW * 0.7 ? 'right' : 'left';
      drawAnnLabel(ctx, a.label, align === 'right' ? x - 11 : x + 11, y, theme, L.F, align);
    }
  }
  ctx.restore();
}

/** 한 프레임을 그린다. p는 0~1 진행도이며 p=1이 최종 상태다. */
function drawFrame(ctx, model, cssW, cssH, theme, p) {
  ctx.save();
  ctx.clearRect(0, 0, cssW, cssH);
  if (!isTransparent(theme.bg)) {
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, cssW, cssH);
  }
  const L = computeLayout(ctx, model, cssW, cssH, theme);
  drawAxes(ctx, model, L, theme);

  // 마크는 플롯 영역을 넘지 않게 자른다(축 라벨 위로 새는 것 방지).
  ctx.save();
  ctx.beginPath();
  ctx.rect(L.x0 - 8, L.y1 - 8, L.plotW + 16, L.plotH + 16);
  ctx.clip();
  if (model.kind === 'scatter') drawScatter(ctx, model, L, theme, p);
  else if (model.kind === 'line') drawLine(ctx, model, L, theme, p);
  else if (model.kind === 'bar' || model.kind === 'hist') drawBars(ctx, model, L, theme, p);
  else if (model.kind === 'box') drawBoxes(ctx, model, L, theme, p);
  drawAnnotations(ctx, model, L, theme, p);
  ctx.restore();

  ctx.restore();
  return L;
}

/* ---------------------------------------------------------------------------
 * 6. 접근성 텍스트
 * ------------------------------------------------------------------------ */

/** 축 이름을 "가로축 …, 세로축 …" 형태로 만든다. */
function axisSentence(model) {
  const x = model.xLabel || model.xKey || '';
  const y = model.yLabel || model.yKey || '';
  if (!x && !y) return '';
  return `가로축은 ${x || '범주'}, 세로축은 ${y || '값'}이다.`;
}

/**
 * 스크린리더가 읽을 요약을 만든다.
 * "제목(캡션) + 종류 + 축 + 요점"을 담고, 자세한 수치는 데이터 표로 안내한다.
 */
function buildAriaLabel(model) {
  const parts = [];
  const kindName = KIND_LABEL[model.kind] || '그래프';
  if (model.caption) parts.push(model.caption.replace(/\s+/g, ' ').trim());
  parts.push(`${kindName}이다.`);
  const axes = axisSentence(model);
  if (axes) parts.push(axes);

  if (model.kind === 'scatter' || model.kind === 'line') {
    parts.push(`값 ${model.points.length}개가 있다.`);
    if (model.xScaleType === 'linear') {
      parts.push(`가로축 범위는 ${formatNumber(model.xMin)}부터 ${formatNumber(model.xMax)}까지다.`);
    } else {
      parts.push(`가로축 범주는 ${model.categories.length}개다.`);
    }
    parts.push(`세로축 값은 ${formatNumber(model.yMin)}부터 ${formatNumber(model.yMax)}까지다.`);
    const first = model.points[0];
    const last = model.points[model.points.length - 1];
    if (first && last) {
      const trend = last.y > first.y ? '커지는' : last.y < first.y ? '작아지는' : '변화가 없는';
      parts.push(`첫 값 ${formatNumber(first.y)}에서 마지막 값 ${formatNumber(last.y)}으로 ${trend} 방향이다.`);
    }
  } else if (model.kind === 'bar' || model.kind === 'hist') {
    const unit = model.kind === 'hist' ? '계급' : '범주';
    parts.push(`${unit} ${model.bars.length}개가 있다.`);
    let hi = model.bars[0];
    let lo = model.bars[0];
    for (const d of model.bars) {
      if (d.value > hi.value) hi = d;
      if (d.value < lo.value) lo = d;
    }
    parts.push(`가장 큰 값은 ${hi.label} ${formatNumber(hi.value)}, 가장 작은 값은 ${lo.label} ${formatNumber(lo.value)}이다.`);
  } else if (model.kind === 'box') {
    parts.push(`범주 ${model.boxes.length}개의 다섯 수 요약이다.`);
    parts.push(
      model.boxes
        .map(
          (d) =>
            `${d.label}은 최솟값 ${formatNumber(roundTo(d.min, 4))}, 중앙값 ${formatNumber(
              roundTo(d.median, 4)
            )}, 최댓값 ${formatNumber(roundTo(d.max, 4))}`
        )
        .join('. ') + '이다.'
    );
  }

  const annLabels = model.annotations
    .map((a) => (a && typeof a.label === 'string' ? a.label.trim() : ''))
    .filter(Boolean);
  if (annLabels.length) parts.push(`표시선은 ${annLabels.join(', ')}이다.`);
  if (model.boxComputed) parts.push('요약값은 제시된 자료에서 계산한 값이다.');
  parts.push('자세한 수치는 아래 데이터 표에 있다.');
  return parts.join(' ');
}

/* ---------------------------------------------------------------------------
 * 7. DOM 만들기 — 텍스트는 전부 textContent로 넣는다(HTML 주입 여지 없음)
 * ------------------------------------------------------------------------ */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.setAttribute('class', className);
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function clearNode(node) {
  if (typeof node.replaceChildren === 'function') node.replaceChildren();
  else while (node.firstChild) node.removeChild(node.firstChild);
}

/**
 * 데이터 표 대체본을 만든다.
 * 스크린리더 사용자와 인쇄 모두를 위한 장치이므로 실제 수치를 모두 담는다.
 * class="chart-datatable"은 인쇄 시 CSS가 펼치기 위한 약속된 이름이다.
 */
function buildDataTable(model) {
  const details = el('details', 'chart-datatable');
  details.appendChild(el('summary', 'chart-datatable-summary', '데이터 표로 보기'));

  const wrap = el('div', 'chart-table-wrap');
  const table = el('table', 'chart-table');
  const name =
    `${KIND_LABEL[model.kind] || '그래프'} 데이터 표` +
    (model.kind === 'box' && model.yLabel ? ` (${model.yLabel} 요약값)` : '');
  table.setAttribute('aria-label', name);

  const thead = el('thead');
  const hrow = el('tr');
  model.table.head.forEach((h) => {
    const th = el('th', null, h);
    th.setAttribute('scope', 'col');
    hrow.appendChild(th);
  });
  thead.appendChild(hrow);
  table.appendChild(thead);

  const tbody = el('tbody');
  model.table.rows.forEach((r) => {
    const tr = el('tr');
    r.forEach((c, i) => {
      if (i === 0) {
        const th = el('th', null, c);
        th.setAttribute('scope', 'row');
        tr.appendChild(th);
      } else {
        tr.appendChild(el('td', 'chart-num', c));
      }
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  details.appendChild(wrap);

  if (model.boxComputed) {
    details.appendChild(
      el('p', 'chart-note', '요약값(최솟값·1사분위수·중앙값·3사분위수·최댓값)은 제시된 자료에서 계산한 값이다.')
    );
  }
  if (model.dropped > 0) {
    details.appendChild(el('p', 'chart-note', `수치로 읽을 수 없어 표시하지 않은 항목이 ${model.dropped}개 있다.`));
  }
  return details;
}

/* ---------------------------------------------------------------------------
 * 8. 공용 감시자 — 테마 변경·인쇄를 한 곳에서 처리한다
 * ---------------------------------------------------------------------------
 * 차트가 많은 페이지에서 인스턴스마다 옵서버를 만들면 낭비이므로,
 * 모듈 수준에 하나씩만 두고 인스턴스를 등록·해제한다.
 * ------------------------------------------------------------------------ */

const watchers = {
  instances: new Set(),
  themeObserver: null,
  colorScheme: null,
  onColorScheme: null,
  printQuery: null,
  onPrint: null,
  onBeforePrint: null,
  onAfterPrint: null,
};

function notifyThemeChange() {
  // 색을 다시 읽어 그리기만 한다. 데이터는 건드리지 않는다.
  for (const inst of watchers.instances) inst.requestRedraw();
}

function setPrintOpen(open) {
  for (const inst of watchers.instances) inst.setPrintOpen(open);
}

function attachWatchers(inst) {
  watchers.instances.add(inst);
  if (watchers.instances.size > 1) return;

  // 테마 전환 신호: 루트/본문의 속성 변화(data-theme, class 등)
  if (typeof MutationObserver === 'function' && typeof document !== 'undefined') {
    try {
      watchers.themeObserver = new MutationObserver(notifyThemeChange);
      const opts = { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-subject'] };
      if (document.documentElement) watchers.themeObserver.observe(document.documentElement, opts);
      if (document.body) watchers.themeObserver.observe(document.body, opts);
    } catch (e) {
      watchers.themeObserver = null;
    }
  }
  // OS 다크 모드 전환
  if (typeof matchMedia === 'function') {
    try {
      watchers.colorScheme = matchMedia('(prefers-color-scheme: dark)');
      watchers.onColorScheme = notifyThemeChange;
      if (watchers.colorScheme.addEventListener) watchers.colorScheme.addEventListener('change', watchers.onColorScheme);
      else if (watchers.colorScheme.addListener) watchers.colorScheme.addListener(watchers.onColorScheme);
    } catch (e) {
      watchers.colorScheme = null;
    }
    // 인쇄: CSS가 details를 펼칠 수 없는 브라우저를 위한 보조 장치다.
    try {
      watchers.printQuery = matchMedia('print');
      watchers.onPrint = (ev) => setPrintOpen(!!ev.matches);
      if (watchers.printQuery.addEventListener) watchers.printQuery.addEventListener('change', watchers.onPrint);
      else if (watchers.printQuery.addListener) watchers.printQuery.addListener(watchers.onPrint);
    } catch (e) {
      watchers.printQuery = null;
    }
  }
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    watchers.onBeforePrint = () => setPrintOpen(true);
    watchers.onAfterPrint = () => setPrintOpen(false);
    window.addEventListener('beforeprint', watchers.onBeforePrint);
    window.addEventListener('afterprint', watchers.onAfterPrint);
  }
}

function detachWatchers(inst) {
  watchers.instances.delete(inst);
  if (watchers.instances.size > 0) return;
  if (watchers.themeObserver) {
    watchers.themeObserver.disconnect();
    watchers.themeObserver = null;
  }
  if (watchers.colorScheme && watchers.onColorScheme) {
    if (watchers.colorScheme.removeEventListener) watchers.colorScheme.removeEventListener('change', watchers.onColorScheme);
    else if (watchers.colorScheme.removeListener) watchers.colorScheme.removeListener(watchers.onColorScheme);
  }
  if (watchers.printQuery && watchers.onPrint) {
    if (watchers.printQuery.removeEventListener) watchers.printQuery.removeEventListener('change', watchers.onPrint);
    else if (watchers.printQuery.removeListener) watchers.printQuery.removeListener(watchers.onPrint);
  }
  if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
    if (watchers.onBeforePrint) window.removeEventListener('beforeprint', watchers.onBeforePrint);
    if (watchers.onAfterPrint) window.removeEventListener('afterprint', watchers.onAfterPrint);
  }
  watchers.colorScheme = null;
  watchers.onColorScheme = null;
  watchers.printQuery = null;
  watchers.onPrint = null;
  watchers.onBeforePrint = null;
  watchers.onAfterPrint = null;
}

/* ---------------------------------------------------------------------------
 * 9. 공개 API
 * ------------------------------------------------------------------------ */

/** 컨테이너 폭을 잰다. 레이아웃 전이면 0이 나올 수 있고, 그때는 그리지 않는다. */
function measureWidth(node) {
  let w = 0;
  if (typeof node.getBoundingClientRect === 'function') {
    try {
      const r = node.getBoundingClientRect();
      if (r && Number.isFinite(r.width)) w = r.width;
    } catch (e) {
      w = 0;
    }
  }
  if (!w && Number.isFinite(node.clientWidth)) w = node.clientWidth;
  return Math.max(0, Math.floor(w));
}

/** 폭에서 높이를 정한다. data-chart-height로 개별 지정도 허용한다. */
function decideHeight(container, cssW) {
  const attr = typeof container.getAttribute === 'function' ? container.getAttribute('data-chart-height') : null;
  const fixed = toNum(attr);
  if (Number.isFinite(fixed) && fixed >= 120) return Math.round(fixed);
  return Math.round(clamp(cssW * 0.6, 200, 420));
}

/** 예외를 던지지 않고 안내 문구를 남긴다(페이지 전체가 죽지 않게 한다). */
function renderFallback(container, message, model) {
  clearNode(container);
  const box = el('div', 'chart-empty');
  box.setAttribute('role', 'note');
  box.appendChild(el('p', null, `그래프를 표시할 수 없다. ${message}`));
  container.appendChild(box);
  // 수치가 있다면 표로라도 보여 주는 것이 낫다.
  if (model && model.table && model.table.rows.length) {
    container.appendChild(buildDataTable(model));
  }
  if (typeof console !== 'undefined' && console.warn) {
    console.warn(`[chart] ${message}`, container);
  }
  return {
    destroy() {
      clearNode(container);
    },
  };
}

/**
 * chart 블록 하나를 컨테이너에 그린다.
 *
 * @param {HTMLElement} container 그릴 자리
 * @param {object} block 콘텐츠 JSON의 chart 블록
 * @returns {{destroy: function}} 정리 함수를 가진 핸들
 */
export function renderChart(container, block) {
  const noop = { destroy() {} };
  if (!container || typeof container !== 'object' || typeof document === 'undefined') {
    if (typeof console !== 'undefined' && console.warn) console.warn('[chart] 그릴 컨테이너가 없다.');
    return noop;
  }

  // --- 데이터 모델은 여기서 단 한 번만 만든다. 이후 어떤 이유로도 다시 만들지 않는다.
  const model = buildDataModel(block);
  if (model.error) return renderFallback(container, model.error, model);
  if (model.dropped > 0 && typeof console !== 'undefined' && console.warn) {
    console.warn(`[chart] 수치로 읽을 수 없는 항목 ${model.dropped}개를 건너뛴다.`, block);
  }

  clearNode(container);

  // --- DOM 골격: figure > canvas + details(데이터 표) + figcaption
  const figure = el('figure', 'chart-figure');
  figure.setAttribute('data-chart-kind', model.kind);

  const canvas = el('canvas', 'chart-canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', buildAriaLabel(model));
  if (canvas.style) {
    canvas.style.display = 'block';
    canvas.style.width = '100%';
  }
  figure.appendChild(canvas);

  const details = buildDataTable(model);
  figure.appendChild(details);

  if (model.caption) {
    figure.appendChild(el('figcaption', 'chart-caption', model.caption));
  }
  container.appendChild(figure);
  if (typeof container.setAttribute === 'function') container.setAttribute('data-chart-rendered', 'true');

  const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  if (!ctx) {
    // 캔버스를 못 쓰는 환경에서도 데이터 표는 남는다.
    if (typeof console !== 'undefined' && console.warn) console.warn('[chart] 2D 컨텍스트를 얻을 수 없어 데이터 표만 보인다.', container);
    return {
      destroy() {
        clearNode(container);
      },
    };
  }

  const state = {
    w: 0,
    h: 0,
    dpr: 0,
    raf: 0,
    animRaf: 0,
    forceNext: false,
    done: false,
    destroyed: false,
    printSaved: null,
  };

  /** 캔버스 버퍼를 CSS 크기 × DPR로 맞춘다(레티나 대응). */
  function resizeBuffer(cssW, cssH, dpr) {
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    if (canvas.style) canvas.style.height = cssH + 'px';
    // 이후 그리기는 CSS 픽셀 좌표로 하면 된다.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function paint(progress) {
    if (state.destroyed) return;
    const theme = readTheme(container); // 색·폰트를 매 렌더에 다시 읽는다
    drawFrame(ctx, model, state.w, state.h, theme, progress);
  }

  function animate() {
    if (state.destroyed) return;
    if (prefersReducedMotion()) {
      // 움직임을 줄이라는 설정이면 즉시 최종 상태로 그린다.
      state.done = true;
      paint(1);
      return;
    }
    const t0 = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
    const step = () => {
      if (state.destroyed) return;
      const now = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
      const t = clamp((now - t0) / ANIM_MS, 0, 1);
      paint(easeOutCubic(t));
      if (t < 1) state.animRaf = raf(step);
      else {
        state.animRaf = 0;
        state.done = true;
      }
    };
    state.animRaf = raf(step);
  }

  function raf(fn) {
    if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(fn);
    if (typeof setTimeout === 'function') return setTimeout(fn, 16);
    fn();
    return 0;
  }

  function cancelRaf(id) {
    if (!id) return;
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id);
    else if (typeof clearTimeout === 'function') clearTimeout(id);
  }

  /** 크기를 확인하고 필요할 때만 다시 그린다. */
  function measureAndDraw(force) {
    if (state.destroyed) return;
    const cssW = measureWidth(container) || measureWidth(canvas);
    if (cssW <= 0) return; // 아직 레이아웃이 없다(숨겨진 탭 등). 다음 신호를 기다린다.
    const cssH = decideHeight(container, cssW);
    const dpr = clamp(typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1, 1, MAX_DPR);

    const sizeSame = cssW === state.w && cssH === state.h && dpr === state.dpr;
    if (sizeSame && !force) return; // 같은 크기면 재그리기를 생략한다

    if (!sizeSame) {
      state.w = cssW;
      state.h = cssH;
      state.dpr = dpr;
      resizeBuffer(cssW, cssH, dpr);
    }

    if (!state.done) animate();
    else paint(1); // 리사이즈·테마 변경은 "다시 그리기"만 한다. 데이터는 그대로다.
  }

  /** rAF 스로틀: 리사이즈가 연속으로 와도 프레임당 한 번만 그린다. */
  function schedule(force) {
    if (state.destroyed) return;
    if (state.raf) {
      if (force) state.forceNext = true;
      return;
    }
    if (force) state.forceNext = true;
    state.raf = raf(() => {
      state.raf = 0;
      const f = !!state.forceNext;
      state.forceNext = false;
      measureAndDraw(f);
    });
  }

  const instance = {
    requestRedraw() {
      schedule(true);
    },
    setPrintOpen(open) {
      // 인쇄 중에는 데이터 표를 펼친다. 인쇄가 끝나면 원래 상태로 돌린다.
      if (open) {
        if (state.printSaved === null) state.printSaved = !!details.open;
        details.open = true;
      } else if (state.printSaved !== null) {
        details.open = state.printSaved;
        state.printSaved = null;
      }
    },
    destroy() {
      if (state.destroyed) return;
      state.destroyed = true;
      cancelRaf(state.raf);
      cancelRaf(state.animRaf);
      state.raf = 0;
      state.animRaf = 0;
      if (ro) ro.disconnect();
      detachWatchers(instance);
      clearNode(container);
      if (typeof container.removeAttribute === 'function') container.removeAttribute('data-chart-rendered');
    },
  };

  // --- 리사이즈 감시
  let ro = null;
  if (typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(() => schedule(false));
    ro.observe(container);
  } else if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    // 아주 오래된 브라우저용 폴백
    const onResize = () => schedule(false);
    window.addEventListener('resize', onResize);
    ro = { disconnect: () => window.removeEventListener('resize', onResize) };
  }

  attachWatchers(instance);
  measureAndDraw(true); // 첫 렌더

  return instance;
}

/**
 * data-chart 속성을 가진 요소를 모두 찾아 렌더한다.
 *
 * @param {Document|HTMLElement} root 탐색 시작점
 * @returns {Array<{destroy: function}>} 각 차트의 핸들
 */
export function renderAllCharts(root = typeof document !== 'undefined' ? document : null) {
  const instances = [];
  if (!root || typeof root.querySelectorAll !== 'function') {
    if (typeof console !== 'undefined' && console.warn) console.warn('[chart] 렌더할 문서를 찾을 수 없다.');
    return instances;
  }
  const nodes = root.querySelectorAll('[data-chart]');
  for (const node of Array.from(nodes)) {
    if (node.getAttribute('data-chart-rendered') === 'true') continue; // 두 번 그리지 않는다
    const raw = node.getAttribute('data-chart');
    let block = null;
    try {
      block = JSON.parse(raw);
    } catch (e) {
      // 파싱 실패도 예외로 올리지 않는다(한 차트가 페이지를 죽이면 안 된다).
      instances.push(renderFallback(node, 'data-chart 속성의 JSON을 읽을 수 없다.', null));
      continue;
    }
    instances.push(renderChart(node, block));
  }
  return instances;
}
