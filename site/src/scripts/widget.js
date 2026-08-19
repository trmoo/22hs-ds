/**
 * 조작 위젯. 데이터로만 정의하고, 종류마다 렌더 함수 하나씩 둔다.
 *
 *   classify — 항목을 눌러 고르고 통에 넣어 분류한다 (정형/비정형 등)
 *   order    — 섞인 단계를 올바른 순서로 배치한다
 *   match    — 왼쪽 항목과 오른쪽 항목을 짝짓는다
 *   join     — 두 표를 공통 열(키)로 통합해 본다
 *
 * 규칙
 * - 데이터를 절대 만들지 않는다. block 에 적힌 값만 쓴다(차트 모듈과 같은 원칙).
 * - 정답 여부를 바로 알려 주고, 왜 그런지 설명을 함께 보여 준다.
 * - 키보드로 조작할 수 있어야 하므로 조작 대상은 모두 button 이다.
 * - 진행 상황은 aria-live 영역에 쓴다.
 */

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

function shell(container, block) {
  container.textContent = '';
  const fig = el('figure', 'wgt');
  const cap = el('figcaption', 'wgt-cap');
  cap.append(el('span', null, block.title || '해 보기'));
  const status = el('span', 'wgt-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  cap.append(status);
  fig.append(cap);
  const body = el('div', 'wgt-body');
  fig.append(body);
  if (block.prompt) body.append(el('p', 'wgt-prompt', block.prompt));
  container.append(fig);
  return { body, status };
}

function feedback(body) {
  let box = body.querySelector('.wgt-fb');
  if (!box) {
    box = el('div', 'wgt-fb');
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    body.append(box);
  }
  return box;
}

/* ---------- classify : 분류하기 ---------- */
function classify(container, block) {
  const { body, status } = shell(container, block);
  const bins = block.bins ?? [];
  const items = block.items ?? [];
  let picked = null;
  let done = 0;
  let right = 0;

  const pool = el('div', 'wgt-pool');
  const binWrap = el('div', 'wgt-bins');
  binWrap.style.setProperty('--bins', String(Math.max(bins.length, 1)));
  body.append(pool, binWrap);
  const fb = feedback(body);

  const itemBtns = items.map((it) => {
    const b = el('button', 'wgt-chip', it.text);
    b.type = 'button';
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => {
      if (b.disabled) return;
      itemBtns.forEach((x) => {
        x.classList.remove('sel');
        x.setAttribute('aria-pressed', 'false');
      });
      picked = { it, b };
      b.classList.add('sel');
      b.setAttribute('aria-pressed', 'true');
      status.textContent = it.text + ' 선택됨. 알맞은 칸을 누르시오.';
    });
    pool.append(b);
    return b;
  });

  bins.forEach((bin) => {
    const zone = el('button', 'wgt-bin');
    zone.type = 'button';
    zone.append(el('span', 'wgt-bin-h', bin.label));
    const placed = el('span', 'wgt-placed');
    zone.append(placed);
    zone.addEventListener('click', () => {
      if (!picked) {
        status.textContent = '먼저 위에서 항목을 하나 고르시오.';
        return;
      }
      const ok = picked.it.bin === bin.id;
      placed.append(el('span', ok ? 'right' : 'wrong', picked.it.text));
      picked.b.disabled = true;
      picked.b.classList.remove('sel');
      picked.b.classList.add('used');
      done += 1;
      if (ok) right += 1;
      const why = picked.it.explain ? ' — ' + picked.it.explain : '';
      fb.className = 'wgt-fb on ' + (ok ? 'good' : 'bad');
      fb.textContent = (ok ? '맞다. ' : '다시 보자. ') + picked.it.text + why;
      picked = null;
      status.textContent = done === items.length
        ? '모두 분류했다. 맞힌 개수 ' + right + ' / ' + items.length
        : done + ' / ' + items.length + ' 분류 · 맞힌 개수 ' + right;
    });
    binWrap.append(zone);
  });

  status.textContent = '항목 ' + items.length + '개를 ' + bins.length + '개 칸으로 분류하시오.';
  return { destroy() { container.textContent = ''; } };
}

/* ---------- order : 순서 맞추기 ---------- */
function order(container, block) {
  const { body, status } = shell(container, block);
  const correct = block.items ?? [];
  // 표시 순서는 데이터로 고정한다. 난수로 섞으면 새로 고칠 때마다 달라져 설명과 어긋난다.
  const shown = block.shuffled ?? correct.map((_, i) => i);
  const slots = el('ol', 'wgt-slots');
  const pool = el('div', 'wgt-pool');
  body.append(slots, pool);
  const fb = feedback(body);
  let next = 0;

  shown.forEach((idx) => {
    const b = el('button', 'wgt-chip', correct[idx]);
    b.type = 'button';
    b.dataset.idx = String(idx);
    b.addEventListener('click', () => {
      if (b.disabled) return;
      const want = next;
      if (Number(b.dataset.idx) !== want) {
        fb.className = 'wgt-fb on bad';
        fb.textContent = '그 단계는 아직이다. ' + (want + 1) + '번째로 올 것을 고르시오.';
        status.textContent = (want + 1) + '번째 단계가 아니다.';
        b.classList.add('shake');
        setTimeout(() => b.classList.remove('shake'), 400);
        return;
      }
      slots.append(el('li', 'wgt-slot', correct[idx]));
      b.disabled = true;
      b.classList.add('used');
      next += 1;
      fb.className = 'wgt-fb on good';
      fb.textContent = block.steps && block.steps[idx] ? '맞다. ' + block.steps[idx] : '맞다.';
      status.textContent = next === correct.length
        ? '순서를 모두 맞췄다.'
        : next + ' / ' + correct.length + ' 배치';
    });
    pool.append(b);
  });

  status.textContent = correct.length + '단계를 순서대로 고르시오.';
  return { destroy() { container.textContent = ''; } };
}

/* ---------- match : 짝짓기 ---------- */
function match(container, block) {
  const { body, status } = shell(container, block);
  const pairs = block.pairs ?? [];
  const grid = el('div', 'wgt-match');
  const leftCol = el('div', 'wgt-col');
  const rightCol = el('div', 'wgt-col');
  grid.append(leftCol, rightCol);
  body.append(grid);
  const fb = feedback(body);
  let pickedLeft = null;
  let done = 0;

  const lBtns = pairs.map((p, i) => {
    const b = el('button', 'wgt-chip wide', p.left);
    b.type = 'button';
    b.addEventListener('click', () => {
      if (b.disabled) return;
      lBtns.forEach((x) => x.classList.remove('sel'));
      pickedLeft = { i, b, p };
      b.classList.add('sel');
      status.textContent = p.left + ' 선택됨. 오른쪽에서 짝을 고르시오.';
    });
    leftCol.append(b);
    return b;
  });

  (block.rightOrder ?? pairs.map((_, i) => i)).forEach((i) => {
    const p = pairs[i];
    const b = el('button', 'wgt-chip wide', p.right);
    b.type = 'button';
    b.addEventListener('click', () => {
      if (b.disabled) return;
      if (!pickedLeft) {
        status.textContent = '먼저 왼쪽에서 하나 고르시오.';
        return;
      }
      const ok = pickedLeft.i === i;
      fb.className = 'wgt-fb on ' + (ok ? 'good' : 'bad');
      fb.textContent = ok
        ? ('맞다. ' + (p.explain ?? '')).trim()
        : ('짝이 아니다. ' + pickedLeft.p.left + josa(pickedLeft.p.left, '을', '를') + ' 다시 보자.');
      if (ok) {
        pickedLeft.b.disabled = true;
        pickedLeft.b.classList.add('used', 'ok');
        b.disabled = true;
        b.classList.add('used', 'ok');
        done += 1;
        status.textContent = done === pairs.length ? '모두 짝지었다.' : done + ' / ' + pairs.length + ' 완료';
      } else {
        b.classList.add('shake');
        setTimeout(() => b.classList.remove('shake'), 400);
      }
      pickedLeft.b.classList.remove('sel');
      pickedLeft = null;
    });
    rightCol.append(b);
  });

  status.textContent = pairs.length + '쌍을 짝지으시오.';
  return { destroy() { container.textContent = ''; } };
}

/* ---------- join : 두 표 통합하기 ---------- */
function join(container, block) {
  const { body, status } = shell(container, block);
  const L = block.left;
  const R = block.right;
  const keyCol = block.key;
  const tables = el('div', 'wgt-two');
  body.append(tables);

  const drawTable = (t, highlight) => {
    const wrap = el('div', 'wgt-tbl');
    wrap.append(el('p', 'wgt-tbl-h', t.name));
    const tb = el('table');
    const tr = el('tr');
    t.head.forEach((h) => {
      const th = el('th', h === highlight ? 'key' : null, h);
      th.scope = 'col';
      tr.append(th);
    });
    const thead = el('thead');
    thead.append(tr);
    tb.append(thead);
    const tbody = el('tbody');
    t.rows.forEach((r) => {
      const row = el('tr');
      r.forEach((c, ci) => row.append(el('td', t.head[ci] === highlight ? 'key' : null, String(c))));
      tbody.append(row);
    });
    tb.append(tbody);
    wrap.append(tb);
    return wrap;
  };

  const render = (hl) => {
    tables.textContent = '';
    tables.append(drawTable(L, hl), drawTable(R, hl));
  };
  render(null);

  const keys = el('div', 'wgt-keys');
  const out = el('div', 'wgt-out');
  const fb = feedback(body);
  const cands = block.candidates ?? [...new Set([...L.head, ...R.head])];

  cands.forEach((c) => {
    const b = el('button', 'wgt-chip', c);
    b.type = 'button';
    b.addEventListener('click', () => {
      keys.querySelectorAll('button').forEach((x) => x.classList.remove('sel'));
      b.classList.add('sel');
      render(c);
      const ok = c === keyCol;
      fb.className = 'wgt-fb on ' + (ok ? 'good' : 'bad');
      fb.textContent = ok
        ? (block.explainOk ?? '두 표에 모두 있고 행을 구별하는 열이다. 이 열을 기준으로 통합할 수 있다.')
        : ((block.explainNo && block.explainNo[c]) ?? '이 열로는 두 표를 짝지을 수 없다. 두 표에 모두 있고 값이 겹치지 않는 열을 찾아보자.');
      out.textContent = '';
      if (!ok) {
        status.textContent = c + ro(c) + '는 통합할 수 없다.';
        return;
      }
      out.append(el('p', 'wgt-tbl-h', block.resultName ?? '통합 결과'));
      const li = L.head.indexOf(keyCol);
      const ri = R.head.indexOf(keyCol);
      const head = [keyCol,
        ...L.head.filter((h) => h !== keyCol),
        ...R.head.filter((h) => h !== keyCol)];
      const tb = el('table');
      const tr = el('tr');
      head.forEach((h) => { const th = el('th', null, h); th.scope = 'col'; tr.append(th); });
      const thead = el('thead');
      thead.append(tr);
      tb.append(thead);
      const tbody = el('tbody');
      L.rows.forEach((lr) => {
        const mate = R.rows.find((rr) => String(rr[ri]) === String(lr[li]));
        const row = el('tr');
        if (!mate) row.className = 'unmatched';
        const vals = [lr[li],
          ...lr.filter((_, i) => i !== li),
          ...(mate ? mate.filter((_, i) => i !== ri) : R.head.filter((h) => h !== keyCol).map(() => '—'))];
        vals.forEach((v) => row.append(el('td', null, String(v))));
        tbody.append(row);
      });
      tb.append(tbody);
      out.append(tb);
      if (block.note) out.append(el('p', 'wgt-note', block.note));
      status.textContent = '통합되었다.';
    });
    keys.append(b);
  });

  body.append(el('p', 'wgt-prompt', block.keyPrompt ?? '두 표를 잇는 기준 열을 고르시오.'), keys, out);
  status.textContent = '기준 열을 고르시오.';
  return { destroy() { container.textContent = ''; } };
}

const KINDS = { classify, order, match, join };

/**
 * 받침 유무에 따라 조사를 고른다. "학년 를" 처럼 어긋난 문장이 학생에게 보이면 안 된다.
 * 한글 음절은 유니코드에서 (초성, 중성, 종성) 순서로 배열되어 있어
 * (코드 - 0xAC00) % 28 이 0 이면 종성이 없다.
 */
export function ro(word) {
  const w = String(word ?? '').trim();
  const last = w.charCodeAt(w.length - 1);
  if (Number.isNaN(last) || last < 0xac00 || last > 0xd7a3) return '로';
  const fin = (last - 0xac00) % 28;
  // 받침이 없거나 'ㄹ'(코드 8)이면 '로', 그 밖에는 '으로'.
  return fin === 0 || fin === 8 ? '로' : '으로';
}

export function josa(word, withFinal, withoutFinal) {
  const w = String(word ?? '').trim();
  const last = w.charCodeAt(w.length - 1);
  if (Number.isNaN(last)) return withoutFinal;
  // 한글 음절 영역이 아니면(숫자·영문 등) 판단하지 않고 받침 없는 쪽을 쓴다.
  if (last < 0xac00 || last > 0xd7a3) return withoutFinal;
  return (last - 0xac00) % 28 === 0 ? withoutFinal : withFinal;
}

export function mountWidget(container, block) {
  const fn = KINDS[block.kind];
  if (!fn) {
    console.warn('[widget] 지원하지 않는 종류:', block && block.kind);
    container.textContent = '';
    container.append(el('p', 'wgt-error', '지원하지 않는 활동입니다.'));
    return { destroy() {} };
  }
  try {
    return fn(container, block);
  } catch (e) {
    console.error('[widget] 렌더 실패', block.kind, e);
    container.textContent = '';
    container.append(el('p', 'wgt-error', '이 활동을 표시할 수 없습니다.'));
    return { destroy() {} };
  }
}

export function mountAllWidgets(root = document) {
  root.querySelectorAll('.widget-mount[data-widget]').forEach((n) => {
    let block;
    try {
      block = JSON.parse(n.dataset.widget);
    } catch (e) {
      console.warn('[widget] 데이터 파싱 실패', e);
      return;
    }
    mountWidget(n, block);
  });
}
