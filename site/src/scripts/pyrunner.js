/**
 * pyrunner.js — 고등학교 「데이터 과학」 웹 교과서: 브라우저 파이썬 실행 모듈
 *
 * 설계 전제(학교 전산실 크롬)
 *  - 학교망이 CDN을 막을 수 있다. 즉 Pyodide 로드 실패는 "예외 상황"이 아니라 "정상 시나리오"다.
 *  - Pyodide 첫 로드는 수 MB를 내려받는다. 그래서 페이지 진입 시 자동 로드하지 않고,
 *    학생이 [▶ 실행]을 처음 누른 순간에만 지연 로드한다.
 *  - 로드가 안 되더라도 수업이 멈추면 안 된다. 콘텐츠 JSON의 code 블록마다 들어 있는
 *    expect(예상 출력)를 정적으로 보여 주는 것이 폴백이다. (아래 showFallback 참고)
 *
 * 외부 의존성: Pyodide(CDN) 하나뿐. 빌드 도구 없이 브라우저가 그대로 실행하는 ES 모듈이다.
 */

/* ────────────────────────────────────────────────────────────────
 * 1. 상수 — 나중에 자체 호스팅으로 바꿀 때 이 블록만 고치면 된다.
 *    (학교망이 jsdelivr를 막으면 PYODIDE_BASE를 학교 서버 경로로 교체)
 * ──────────────────────────────────────────────────────────────── */

const PYODIDE_VERSION = '0.26.4';
const PYODIDE_BASE = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
const PYODIDE_ENTRY = `${PYODIDE_BASE}pyodide.mjs`;

/** 로드 제한 시간(ms). 학교망이 조용히 물고 늘어지는 경우를 끊기 위한 값이다. */
const LOAD_TIMEOUT_MS = 30000;

/**
 * 내려받는 용량 안내 문구.
 * 정확한 바이트 수는 브라우저·버전·압축에 따라 달라지므로 숫자를 단정하지 않는다.
 */
const DOWNLOAD_SIZE_HINT = '수 MB';

/** 로딩 단계 문구. 진행률(%)은 Pyodide가 제공하지 않으므로 "가짜 %"를 만들지 않고 단계만 센다. */
const STAGE = {
  MODULE: '(1/2) 파이썬 모듈 내려받기',
  RUNTIME: '(2/2) 파이썬 실행기 초기화',
};

/* ────────────────────────────────────────────────────────────────
 * 2. 모듈 스코프 단일 상태 — Pyodide 인스턴스는 페이지 전체에서 하나만 공유한다.
 *    코드 블록이 20개여도 로드는 한 번뿐이다.
 * ──────────────────────────────────────────────────────────────── */

let _state = 'idle'; // 'idle' | 'loading' | 'ready' | 'failed'
let _pyodide = null;
let _loadPromise = null; // 단일 프로미스(중복 로드 방지)
let _stage = '';
let _failReason = '';

/** setStdout/setStderr 를 쓸 수 있는 빌드인가(0.26 은 지원). 없으면 StringIO 폴백을 쓴다. */
let _hasNativeCapture = false;

/** KeyboardInterrupt 버퍼. 쓸 수 있는 환경에서만 채워진다(8번 항목 주석 참고). */
let _interruptBuffer = null;

/** loadPackage 로 이미 불러온 패키지 이름(중복 요청 방지). */
const _loadedPackages = new Set();

/** 현재 실행 중인 런. stdout/stderr 를 어느 블록으로 보낼지 판단하는 라우팅 정보다. */
let _activeRun = null; // { id, out, err }
let _runSeq = 0;

/**
 * 파이썬 코드가 실제로 실행 중인지. 중지 버튼을 눌러 UI를 되돌려도,
 * 이미 시작된 파이썬 코드는 계속 돌고 있으므로 이 플래그는 그때까지 true다.
 */
let _execBusy = false;

/** 상태 변화 구독자(마운트된 블록들). 한 블록이 로드를 시작하면 모든 블록의 상태 표시가 같이 갱신된다. */
const _stateListeners = new Set();

/** Pyodide를 쓸 수 없다(=폴백으로 가야 한다)는 뜻의 오류. 파이썬 예외와 구분하기 위한 타입이다. */
class PyodideUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PyodideUnavailableError';
  }
}

function setState(next, stage) {
  _state = next;
  if (typeof stage === 'string') _stage = stage;
  for (const fn of _stateListeners) {
    try {
      fn(_state, _stage);
    } catch (err) {
      console.error('[pyrunner] 상태 리스너 오류', err);
    }
  }
}

/* ────────────────────────────────────────────────────────────────
 * 3. 공개 API
 * ──────────────────────────────────────────────────────────────── */

/**
 * 현재 파이썬 환경 상태.
 * @returns {'idle'|'loading'|'ready'|'failed'}
 */
export function pyodideState() {
  return _state;
}

/**
 * 코드 블록 하나를 컨테이너에 마운트한다.
 * @param {HTMLElement} container 마운트 대상(비워지고 새로 채워진다)
 * @param {{type?:string, lang?:string, source?:string, expect?:string, editable?:boolean}} block
 * @returns {{destroy: () => void}}
 */
export function mountPyRunner(container, block) {
  if (!container || typeof container.appendChild !== 'function') {
    console.error('[pyrunner] mountPyRunner: 컨테이너 요소가 올바르지 않다.', container);
    return { destroy() {} };
  }
  const spec = block && typeof block === 'object' ? block : {};
  const source = typeof spec.source === 'string' ? spec.source : '';
  if (!source) {
    container.textContent = '';
    container.appendChild(makeErrorNote('실행할 파이썬 코드가 없다. (source 없음)'));
    return { destroy() {} };
  }
  return createRunner(container, {
    source,
    expect: typeof spec.expect === 'string' ? spec.expect : '',
    // editable 기본값은 true. false 로 명시했을 때만 읽기 전용이 된다.
    editable: spec.editable !== false,
    lang: typeof spec.lang === 'string' ? spec.lang : 'python',
  });
}

/**
 * root 안의 data-pycode 요소를 모두 마운트한다.
 * @param {ParentNode} [root=document]
 * @returns {Array<{destroy: () => void}>} 마운트된 핸들 목록
 */
export function mountAllPyRunners(root = document) {
  const scope = root || document;
  const targets = [];
  // root 자신이 data-pycode 를 가진 경우도 처리한다(querySelectorAll 은 자신을 포함하지 않는다).
  if (typeof scope.matches === 'function' && scope.matches('[data-pycode]')) targets.push(scope);
  if (typeof scope.querySelectorAll === 'function') {
    for (const el of scope.querySelectorAll('[data-pycode]')) targets.push(el);
  }

  const handles = [];
  for (const el of targets) {
    // 두 번 마운트되는 사고(부분 렌더링/뷰 전환)를 막는다.
    if (el.dataset && el.dataset.pyrunMounted === '1') continue;

    let parsed = null;
    try {
      parsed = JSON.parse(el.getAttribute('data-pycode'));
    } catch (err) {
      // JSON 이 깨져도 페이지 전체를 죽이지 않는다. 해당 자리에만 안내를 남긴다.
      console.error('[pyrunner] data-pycode JSON 파싱 실패', err, el);
      el.textContent = '';
      el.appendChild(makeErrorNote('코드 블록 정보를 읽지 못했다. (data-pycode 형식 오류)'));
      if (el.dataset) el.dataset.pyrunMounted = '1';
      continue;
    }
    handles.push(mountPyRunner(el, parsed));
  }
  return handles;
}

/**
 * numpy·pandas 같은 외부 패키지를 불러오는 경로.
 *
 * 규칙: 기본 실행 경로에서는 절대 호출하지 않는다. 교과서의 code 블록은 순수 파이썬만 쓰도록
 * 작성돼 있고, 패키지를 받으면 추가로 수 MB를 더 내려받아 학교망에서 실패 확률이 커진다.
 * 나중에 심화 활동에서 필요할 때 콘텐츠 쪽에서 명시적으로 호출하도록 남겨 둔 함수다.
 *
 * @param {string|string[]} names 예: 'numpy' 또는 ['numpy','pandas']
 */
export async function ensurePackages(names) {
  const list = (Array.isArray(names) ? names : [names]).filter(Boolean);
  if (!list.length) return;
  const py = await ensurePyodide();
  const need = list.filter((n) => !_loadedPackages.has(n));
  if (!need.length) return;
  setState('loading', `추가 패키지 내려받기: ${need.join(', ')}`);
  try {
    await py.loadPackage(need);
    for (const n of need) _loadedPackages.add(n);
  } finally {
    // 패키지 하나가 실패해도 파이썬 환경 자체는 살아 있으므로 'failed'로 내리지 않는다.
    setState('ready', '');
  }
}

/* ────────────────────────────────────────────────────────────────
 * 4. Pyodide 지연 로드
 * ──────────────────────────────────────────────────────────────── */

/**
 * Pyodide 인스턴스를 반환한다. 이미 로드됐으면 그대로, 로드 중이면 같은 프로미스를 공유한다.
 * 실패한 뒤에는 재시도하지 않고 즉시 거부한다(규칙 7: 이후 클릭은 곧바로 폴백).
 */
function ensurePyodide() {
  if (_state === 'ready' && _pyodide) return Promise.resolve(_pyodide);
  if (_state === 'failed') {
    return Promise.reject(new PyodideUnavailableError(_failReason || '이전 로드 시도가 실패했다.'));
  }
  if (!_loadPromise) _loadPromise = startLoad();
  return _loadPromise;
}

async function startLoad() {
  setState('loading', STAGE.MODULE);

  let timer = null;
  // dynamic import 와 loadPyodide 는 취소 API가 없다. 그래서 "경주(race)"로 타임아웃을 만든다.
  // 시간이 지나면 우리는 실패로 처리하지만, 브라우저의 내려받기 자체는 백그라운드에서 계속될 수 있다.
  // (그래서 아래에서 work 에 catch 를 붙여 unhandled rejection 을 막는다.)
  const work = (async () => {
    // @vite-ignore: 절대 URL 이므로 번들러가 손대지 않게 한다(빌드 없이 브라우저가 그대로 실행).
    const mod = await import(/* @vite-ignore */ PYODIDE_ENTRY);
    if (!mod || typeof mod.loadPyodide !== 'function') {
      throw new Error('pyodide.mjs 에서 loadPyodide 를 찾지 못했다.');
    }
    setState('loading', STAGE.RUNTIME);
    return mod.loadPyodide({
      indexURL: PYODIDE_BASE,
      // stdout/stderr 는 로드 시점에 한 번만 걸어 두고, 현재 실행 중인 블록으로 라우팅한다.
      stdout: (line) => dispatchOut(line),
      stderr: (line) => dispatchErr(line),
    });
  })();
  work.catch(() => {}); // 타임아웃 이후 늦게 실패해도 콘솔을 더럽히지 않게

  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new PyodideUnavailableError(
          `${Math.round(LOAD_TIMEOUT_MS / 1000)}초 안에 응답이 없었다(학교망 차단 또는 느린 회선).`
        )
      );
    }, LOAD_TIMEOUT_MS);
  });

  try {
    const py = await Promise.race([work, deadline]);
    clearTimeout(timer);
    _pyodide = py;
    _hasNativeCapture = typeof py.setStdout === 'function' && typeof py.setStderr === 'function';
    if (_hasNativeCapture) {
      // 규칙 5: print() 출력을 잡는 기본 수단.
      py.setStdout({ batched: (line) => dispatchOut(line) });
      py.setStderr({ batched: (line) => dispatchErr(line) });
    }
    _interruptBuffer = setupInterruptBuffer(py);
    setState('ready', '');
    return py;
  } catch (err) {
    clearTimeout(timer);
    _failReason = err && err.message ? err.message : String(err);
    console.warn('[pyrunner] Pyodide 로드 실패 → 예상 출력 폴백으로 전환한다.', err);
    setState('failed', '');
    throw new PyodideUnavailableError(_failReason);
  }
}

/**
 * KeyboardInterrupt 버퍼 준비.
 *
 * setInterruptBuffer 는 SharedArrayBuffer 를 요구하고, SharedArrayBuffer 는
 * 문서가 cross-origin isolated(COOP/COEP 헤더) 여야 쓸 수 있다.
 * 정적 호스팅(깃허브 페이지 등)에서는 보통 불가능하므로 대개 null 이 된다.
 * 자세한 한계는 requestInterrupt() 주석 참고.
 */
function setupInterruptBuffer(py) {
  try {
    if (typeof py.setInterruptBuffer !== 'function') return null;
    if (typeof SharedArrayBuffer !== 'function') return null;
    if (!globalThis.crossOriginIsolated) return null;
    const buf = new Uint8Array(new SharedArrayBuffer(1));
    py.setInterruptBuffer(buf);
    return buf;
  } catch (err) {
    console.warn('[pyrunner] 인터럽트 버퍼를 준비하지 못했다(중지는 UI 복구로만 동작한다).', err);
    return null;
  }
}

/**
 * 중지 요청.
 *
 * ★ 실제 한계(규칙 8) ★
 *  - 우리는 Pyodide를 웹 워커가 아니라 메인 스레드에서 돌린다. 파이썬 실행은 동기 작업이라
 *    실행 중에는 메인 스레드가 막히고, 그동안 [■ 중지] 클릭 이벤트조차 처리되지 않는다.
 *    즉 `while True: pass` 같은 코드는 어떤 방법으로도 여기서 끊을 수 없다.
 *  - 인터럽트 버퍼가 준비된 경우에도(= COOP/COEP 가 걸린 배포에서만) 실제로 끊기는 것은
 *    파이썬이 이벤트 루프에 제어를 넘겨 주는 순간(await asyncio.sleep 등)이 있을 때뿐이다.
 *  - 그래서 이 함수는 "끊었다"고 단정하지 않는다. 버튼을 누르면 (a) 가능하면 인터럽트를 요청하고
 *    (b) 이후 도착하는 출력을 버리고 UI만 복구한다. 화면 문구도 그 한계를 그대로 적는다.
 * @returns {boolean} 진짜 인터럽트를 요청할 수 있었는지
 */
function requestInterrupt() {
  if (!_interruptBuffer) return false;
  _interruptBuffer[0] = 2; // 2 = SIGINT
  return true;
}

function canInterrupt() {
  return _interruptBuffer != null;
}

/* ────────────────────────────────────────────────────────────────
 * 5. 실행 & 출력 라우팅
 * ──────────────────────────────────────────────────────────────── */

function beginRun(out, err) {
  const id = ++_runSeq;
  _activeRun = { id, out, err };
  return id;
}

/** 런을 무효화한다. 중지 버튼과 정상 종료가 모두 이 함수를 쓴다. */
function endRun(id) {
  if (_activeRun && _activeRun.id === id) _activeRun = null;
}

function isCurrentRun(id) {
  return !!_activeRun && _activeRun.id === id;
}

function dispatchOut(text) {
  if (_activeRun && typeof _activeRun.out === 'function') _activeRun.out(String(text));
}

function dispatchErr(text) {
  if (_activeRun && typeof _activeRun.err === 'function') _activeRun.err(String(text));
}

/**
 * 학생 코드를 실행한다. 마지막 표현식 값이 아니라 print 출력이 기본이므로
 * 반환값은 쓰지 않고 stdout 만 화면에 보낸다.
 */
async function executePython(py, source) {
  _execBusy = true;
  try {
    if (_hasNativeCapture) {
      // 기본 경로: setStdout/setStderr 가 이미 걸려 있으므로 그대로 실행한다.
      // runPythonAsync 를 쓰면 최상위 await 도 동작한다. (패키지 자동 로드는 하지 않는다 → 규칙 12)
      await py.runPythonAsync(source);
      return;
    }
    // 폴백 경로: setStdout 이 없는 구버전 빌드. sys.stdout 을 StringIO 로 바꿔치기한다.
    py.globals.set('__pyrun_src', source);
    try {
      await py.runPythonAsync(
        [
          'import io, contextlib',
          '__pyrun_o = io.StringIO()',
          '__pyrun_e = io.StringIO()',
          'with contextlib.redirect_stdout(__pyrun_o), contextlib.redirect_stderr(__pyrun_e):',
          "    exec(compile(__pyrun_src, '<학생코드>', 'exec'), {'__name__': '__main__'})",
        ].join('\n')
      );
    } finally {
      // 예외가 나도 그 전까지 찍힌 출력은 보여 준다.
      flushStringIO(py);
    }
  } finally {
    _execBusy = false;
  }
}

function flushStringIO(py) {
  for (const [name, sink] of [
    ['__pyrun_o', dispatchOut],
    ['__pyrun_e', dispatchErr],
  ]) {
    let proxy = null;
    try {
      proxy = py.globals.get(name);
      if (!proxy) continue;
      const text = proxy.getvalue();
      if (text) sink(text);
    } catch (err) {
      console.warn('[pyrunner] 출력 회수 실패', err);
    } finally {
      if (proxy && typeof proxy.destroy === 'function') proxy.destroy();
    }
  }
}

/**
 * 파이썬 예외 메시지를 학생이 읽을 수 있게 나눈다.
 * head = 마지막 줄(오류 유형·메시지), body = 트레이스백 전체.
 */
function splitPyError(err) {
  const raw = err && err.message ? String(err.message) : String(err);
  const body = raw.replace(/\s+$/, '');
  const lines = body.split('\n');
  let head = '';
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i].trim()) {
      head = lines[i].trim();
      break;
    }
  }
  return { head, body };
}

/* ────────────────────────────────────────────────────────────────
 * 6. DOM 만들기 헬퍼 (innerHTML 을 쓰지 않는다 → 이스케이프 사고 없음)
 * ──────────────────────────────────────────────────────────────── */

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function makeButton(className, label, ariaLabel) {
  const b = el('button', className);
  b.type = 'button';
  b.textContent = label;
  // 라벨에 ▶ ■ ↺ 같은 기호가 들어가므로 스크린 리더용 이름을 따로 준다(규칙 11).
  if (ariaLabel) b.setAttribute('aria-label', ariaLabel);
  return b;
}

function makeErrorNote(text) {
  const p = el('p', 'pyrun-error');
  p.textContent = text;
  return p;
}

function statusLabel(state, stage) {
  switch (state) {
    case 'loading':
      return stage ? `파이썬 환경 준비 중… ${stage}` : '파이썬 환경 준비 중…';
    case 'ready':
      return '파이썬 준비됨';
    case 'failed':
      return '파이썬 환경 없음(예상 출력만 표시)';
    default:
      return '실행 전';
  }
}

/* ────────────────────────────────────────────────────────────────
 * 7. 블록 컨트롤러
 * ──────────────────────────────────────────────────────────────── */

function createRunner(container, spec) {
  let destroyed = false;
  let running = false; // 이 블록의 UI 기준 실행 상태
  let myRunId = 0;
  let outEmpty = true;
  const cleanups = [];

  /* ---- 구조 만들기 ---- */
  container.textContent = '';
  if (container.dataset) container.dataset.pyrunMounted = '1';

  const figure = el('figure', 'pyrun');
  figure.dataset.state = pyodideState();

  const cap = el('figcaption', 'pyrun-cap');
  const capTitle = el('span', 'pyrun-title');
  capTitle.textContent = '파이썬 실행';
  const status = el('span', 'pyrun-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.textContent = statusLabel(pyodideState(), _stage);
  cap.appendChild(capTitle);
  cap.appendChild(status);
  figure.appendChild(cap);

  /* ---- 코드 영역 ---- */
  let codeArea = null; // textarea (편집 가능)
  let codeText = null; // pre>code (읽기 전용)
  if (spec.editable) {
    codeArea = el('textarea', 'pyrun-code');
    codeArea.value = spec.source;
    codeArea.spellcheck = false;
    codeArea.setAttribute('wrap', 'off');
    codeArea.setAttribute('autocapitalize', 'off');
    codeArea.setAttribute('autocorrect', 'off');
    codeArea.setAttribute('aria-label', '파이썬 코드 편집 영역. Ctrl+Enter로 실행');
    const lines = spec.source.split('\n').length;
    codeArea.rows = Math.min(Math.max(lines, 3), 24);
    figure.appendChild(codeArea);
  } else {
    const pre = el('pre', 'pyrun-code');
    codeText = el('code', '');
    codeText.textContent = spec.source;
    if (spec.lang) codeText.setAttribute('data-lang', spec.lang);
    pre.appendChild(codeText);
    figure.appendChild(pre);
  }

  /* ---- 버튼 줄 ---- */
  const bar = el('div', 'pyrun-bar');
  const runBtn = makeButton('pyrun-run', '▶ 실행', '코드 실행');
  const stopBtn = makeButton('pyrun-stop', '■ 중지', '실행 중지');
  const resetBtn = makeButton('pyrun-reset', '↺ 되돌리기', '코드를 원본으로 되돌리기');
  const expectBtn = makeButton('pyrun-expect', '예상 출력 보기', '이 코드의 예상 출력 보기');
  stopBtn.disabled = true;
  // 편집 불가 블록은 되돌릴 것이 없다.
  resetBtn.disabled = !spec.editable;
  bar.appendChild(runBtn);
  bar.appendChild(stopBtn);
  bar.appendChild(resetBtn);
  bar.appendChild(expectBtn);

  // 규칙 2: 실행 버튼 옆에 최초 1회 내려받기 안내를 붙인다. 준비되면 숨긴다.
  const hint = el('span', 'pyrun-hint');
  hint.textContent = `실행을 누르면 파이썬 환경을 내려받는다(최초 1회, ${DOWNLOAD_SIZE_HINT}).`;
  bar.appendChild(hint);
  figure.appendChild(bar);

  /* ---- 출력 영역 ---- */
  const out = el('pre', 'pyrun-out');
  out.setAttribute('aria-live', 'polite');
  out.setAttribute('tabindex', '0'); // 키보드로 출력까지 훑을 수 있게
  out.setAttribute('aria-label', '실행 결과');
  figure.appendChild(out);

  container.appendChild(figure);

  /* ---- 출력 쓰기 ---- */
  function clearOut() {
    out.textContent = '';
    outEmpty = true;
  }

  function write(text, className) {
    if (destroyed) return;
    const span = el('span', className || '');
    const s = String(text);
    span.textContent = s.endsWith('\n') ? s : `${s}\n`;
    out.appendChild(span);
    outEmpty = false;
  }

  const writeOut = (t) => write(t, 'pyrun-stdout');
  const writeErr = (t) => write(t, 'pyrun-err');
  const writeNote = (t) => write(t, 'pyrun-note');

  /** 예상 출력 표시. 실제 실행 결과와 섞이지 않게 [예상 출력] 접두를 반드시 붙인다(규칙 10). */
  function showExpect() {
    if (!spec.expect) {
      writeNote('[예상 출력] 이 코드에는 예상 출력이 준비되어 있지 않다.');
      return;
    }
    const box = el('span', 'pyrun-expect-out');
    box.textContent = `[예상 출력]\n${spec.expect.replace(/\s+$/, '')}\n`;
    out.appendChild(box);
    outEmpty = false;
  }

  /**
   * 로드 실패 폴백(규칙 7).
   * 오류로 끝내지 않는 이유: 학교망 차단은 학생 잘못이 아니고, 교과서의 학습 목표는
   * "코드와 결과의 관계를 읽는 것"이다. 환경이 없어도 expect 로 그 목표는 달성된다.
   */
  function showFallback(reason) {
    clearOut();
    writeNote('파이썬 환경을 불러오지 못했다. 아래는 이 코드의 예상 출력이다.');
    showExpect();
    if (reason) {
      // 학생용 문구는 위 두 줄로 충분하지만, 선생님이 원인을 진단할 수 있게 한 줄 남긴다.
      writeNote(`(원인: ${reason})`);
    }
  }

  /* ---- 상태 반영 ---- */
  function refreshStatus() {
    if (destroyed) return;
    const shared = pyodideState();
    if (shared === 'loading') {
      // 로드는 [▶ 실행] 클릭에서 시작되므로 이 블록은 이미 running 상태다.
      // 그래도 학생에게 먼저 알려야 할 것은 "환경 준비 단계"다(규칙 3).
      status.textContent = statusLabel('loading', _stage);
      figure.dataset.state = 'loading';
    } else if (running) {
      status.textContent = '실행 중…';
      figure.dataset.state = 'running';
    } else {
      status.textContent = statusLabel(shared, _stage);
      figure.dataset.state = shared;
    }
    // 준비가 끝났거나 실패한 뒤에는 "내려받기 안내"가 필요 없다.
    hint.hidden = shared !== 'idle';
    if (spec.editable && codeArea) {
      resetBtn.disabled = codeArea.value === spec.source;
    }
  }

  function setRunning(next) {
    running = next;
    runBtn.disabled = next;
    stopBtn.disabled = !next;
    figure.setAttribute('aria-busy', next ? 'true' : 'false');
    refreshStatus();
  }

  // 다른 블록이 로드를 시작하면 이 블록의 상태 표시도 같이 갱신된다(단일 인스턴스 공유).
  const onGlobalState = () => refreshStatus();
  _stateListeners.add(onGlobalState);
  cleanups.push(() => _stateListeners.delete(onGlobalState));

  /* ---- 이벤트 ---- */
  function on(target, type, fn) {
    target.addEventListener(type, fn);
    cleanups.push(() => target.removeEventListener(type, fn));
  }

  function currentCode() {
    return codeArea ? codeArea.value : spec.source;
  }

  async function handleRun() {
    if (destroyed || running) return;

    // 규칙 7: 한 번 실패했으면 다시 네트워크를 두드리지 않고 즉시 폴백을 보여 준다.
    if (pyodideState() === 'failed') {
      showFallback(_failReason);
      return;
    }
    // 파이썬 인스턴스는 하나뿐이므로 동시 실행을 막는다(출력이 섞이는 것도 방지).
    if (_execBusy) {
      clearOut();
      writeNote('앞선 실행이 아직 끝나지 않았다. 잠시 뒤에 다시 실행하라.');
      return;
    }

    setRunning(true);
    clearOut();
    if (pyodideState() !== 'ready') {
      writeNote(`파이썬 환경을 준비하고 있다. 최초 1회만 내려받는다(${DOWNLOAD_SIZE_HINT}). 잠시 기다려라…`);
    }

    let py;
    try {
      py = await ensurePyodide();
    } catch (err) {
      if (destroyed) return;
      setRunning(false);
      showFallback(err && err.message ? err.message : String(err));
      return;
    }
    if (destroyed) return;

    clearOut(); // 준비 안내를 지우고 실제 실행 결과만 남긴다.
    myRunId = beginRun(writeOut, writeErr);
    const thisRun = myRunId;
    try {
      await executePython(py, currentCode());
      if (destroyed || !isCurrentRun(thisRun)) return; // 중지되었거나 언마운트됨
      if (outEmpty) writeNote('(출력이 없다. 결과를 보려면 print() 로 찍어 보라.)');
    } catch (err) {
      if (destroyed || !isCurrentRun(thisRun)) return;
      const { head, body } = splitPyError(err);
      if (/KeyboardInterrupt/.test(head) || /KeyboardInterrupt/.test(body)) {
        writeNote('실행이 중지되었다. (KeyboardInterrupt)');
      } else {
        const strong = el('strong', 'pyrun-errhead');
        strong.textContent = `오류: ${head || '알 수 없는 오류'}\n`;
        const wrap = el('span', 'pyrun-err');
        wrap.appendChild(strong);
        const detail = el('span', '');
        detail.textContent = `${body}\n`;
        wrap.appendChild(detail);
        out.appendChild(wrap);
        outEmpty = false;
      }
    } finally {
      endRun(thisRun);
      if (!destroyed) setRunning(false);
    }
  }

  function handleStop() {
    if (destroyed || !running) return;
    const real = requestInterrupt(); // 가능한 환경에서만 진짜 인터럽트를 요청한다
    endRun(myRunId); // 이후 도착하는 출력은 버린다
    setRunning(false);
    // 거짓으로 "중단됐다"고 쓰지 않는다. 아래 문구가 실제 동작 그대로다.
    if (real) {
      writeNote('중지를 요청했다. 파이썬이 다음 검사 지점에 도달하면 멈춘다.');
    } else {
      writeNote(
        '중지했다. 화면은 되돌렸지만, 이미 시작된 파이썬 코드는 브라우저가 끝까지 실행한다(중간에 진짜로 끊을 수는 없다). 멈추지 않으면 페이지를 새로 고쳐라.'
      );
    }
  }

  function handleReset() {
    if (destroyed || !codeArea) return;
    codeArea.value = spec.source; // 원본 복원. 편집 내용은 어디에도 저장하지 않는다(규칙 9).
    clearOut();
    writeNote('코드를 원본으로 되돌렸다.');
    refreshStatus();
    codeArea.focus();
  }

  function handleExpect() {
    if (destroyed) return;
    showExpect();
  }

  on(runBtn, 'click', handleRun);
  on(stopBtn, 'click', handleStop);
  on(resetBtn, 'click', handleReset);
  on(expectBtn, 'click', handleExpect);
  if (codeArea) {
    on(codeArea, 'input', refreshStatus);
    // Ctrl/Cmd+Enter 로도 실행. Tab 은 가로채지 않는다 —
    // 들여쓰기 편의보다 "키보드만으로 버튼까지 이동" 이라는 접근성이 우선이다(규칙 11).
    on(codeArea, 'keydown', (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
        ev.preventDefault();
        handleRun();
      }
    });
  }

  refreshStatus();

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      // 이 블록이 실행 중이었다면 출력 라우팅을 끊는다(떼어낸 노드에 쓰지 않도록).
      endRun(myRunId);
      for (const fn of cleanups) {
        try {
          fn();
        } catch (err) {
          console.warn('[pyrunner] 정리 중 오류', err);
        }
      }
      cleanups.length = 0;
      container.textContent = '';
      if (container.dataset) delete container.dataset.pyrunMounted;
    },
  };
}
