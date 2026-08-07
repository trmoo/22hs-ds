/**
 * 제한된 마크다운 렌더러.
 *
 * CLAUDE.md 는 본문 md 필드에 "제한된 마크다운"만 허용한다. 라이브러리를 쓰지 않고
 * 필요한 문법만 직접 처리한다. HTML은 먼저 이스케이프하므로 콘텐츠에 태그를 써도 주입되지 않는다.
 *
 * 지원: **강조**, `코드`, 문단 분리(빈 줄), 목록(- / 1.), 줄바꿈
 */

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/** 인라인 문법만 적용 (표 셀·캡션 등에 쓴다) */
export function inline(src) {
  let t = escapeHtml(src);
  t = t.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return t;
}

/**
 * 본문에 나온 용어를 툴팁 버튼으로 감싼다.
 *
 * term 블록으로 정의한 용어가 본문에 다시 나올 때 hover·키보드로 정의를 볼 수 있게 한다.
 * 용어당 첫 등장 한 번만 감싼다(같은 문장이 버튼으로 뒤덮이면 읽기 어렵다).
 * 이미 만들어진 태그 안(<code>, <strong> 등)을 건드리지 않도록 태그 밖 텍스트만 치환한다.
 */
export function linkTerms(html, terms) {
  if (!terms?.length) return html;

  // 긴 용어를 먼저 처리해야 짧은 용어가 긴 용어를 쪼개지 않는다
  const list = terms
    .map((t) => ({ ...t, plain: t.term.replace(/\s*\(.*?\)\s*$/, '').trim() }))
    .filter((t) => t.plain.length >= 2)
    .sort((a, b) => b.plain.length - a.plain.length);

  const used = new Set();
  // 태그와 텍스트를 번갈아 훑는다
  return html.replace(/(<[^>]+>)|([^<]+)/g, (m, tag, text) => {
    if (tag) return tag;
    let out = text;
    for (const t of list) {
      if (used.has(t.plain)) continue;
      const i = out.indexOf(t.plain);
      if (i < 0) continue;
      used.add(t.plain);
      const before = out.slice(0, i);
      const after = out.slice(i + t.plain.length);
      const desc = escapeHtml(t.desc).replace(/"/g, '&quot;');
      const label = escapeHtml(t.term).replace(/"/g, '&quot;');
      out = `${before}<button type="button" class="term-ref" data-term="${label}" data-desc="${desc}">${t.plain}</button>${after}`;
    }
    return out;
  });
}

/** 블록 문법까지 적용 (prose·callout 본문에 쓴다) */
export function markdown(src) {
  const lines = String(src ?? '').split('\n');
  const out = [];
  let list = null; // 'ul' | 'ol'

  const closeList = () => {
    if (list) { out.push(`</${list}>`); list = null; }
  };

  let para = [];
  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${inline(para.join(' '))}</p>`);
      para = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { flushPara(); closeList(); continue; }

    const ul = line.match(/^\s*[-*•]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);

    if (ul || ol) {
      flushPara();
      const want = ul ? 'ul' : 'ol';
      if (list !== want) { closeList(); out.push(`<${want}>`); list = want; }
      out.push(`<li>${inline((ul || ol)[1])}</li>`);
      continue;
    }

    closeList();
    para.push(line.trim());
  }
  flushPara();
  closeList();
  return out.join('\n');
}
