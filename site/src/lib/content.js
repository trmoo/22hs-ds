/**
 * 빌드 시점에 content/ 의 JSON을 읽어 페이지 생성에 쓸 형태로 정리한다.
 *
 * Vite의 import 제한(프로젝트 루트 밖 import 불가)을 피하려고 node:fs 로 직접 읽는다.
 * .astro 프런트매터는 빌드 시 Node에서 실행되므로 이 방식이 안전하다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONTENT = path.resolve(HERE, '../../../content');

const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf-8'));

export const curriculum = readJSON(path.join(CONTENT, 'curriculum.json'));

export const publishersDoc = fs.existsSync(path.join(CONTENT, 'publishers.json'))
  ? readJSON(path.join(CONTENT, 'publishers.json'))
  : { publishers: [] };

export const publishers = publishersDoc.publishers ?? [];

/** 차시 전체. 영역 → order 순으로 정렬한다. */
export const lessons = fs
  .readdirSync(path.join(CONTENT, 'lessons'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => readJSON(path.join(CONTENT, 'lessons', f)))
  .sort((a, b) => a.areaId - b.areaId || a.order - b.order);

export const standards = curriculum.standards;
export const areas = curriculum.areas;

const stdByCode = new Map(standards.map((s) => [s.code, s]));
export const getStandard = (code) => stdByCode.get(code);

export const areaById = new Map(areas.map((a) => [a.id, a]));

/** 영역별 차시 묶음 — 좌측 트리와 영역 페이지가 함께 쓴다. */
export const lessonsByArea = areas.map((a) => ({
  area: a,
  lessons: lessons.filter((l) => l.areaId === a.id),
}));

/** 이전/다음 차시 (영역 경계를 넘어 연속 이동한다) */
export function neighbors(id) {
  const i = lessons.findIndex((l) => l.id === id);
  return { prev: i > 0 ? lessons[i - 1] : null, next: i < lessons.length - 1 ? lessons[i + 1] : null };
}

/**
 * 성취기준 코드 → 각 출판사의 위치.
 * 우리 차시와 출판사 단원을 직접 잇지 않고 성취기준으로 조인한다(PLAN §5-3).
 */
export function crosswalkFor(codes) {
  const wanted = new Set(codes);
  return publishers.map((p) => {
    const hits = [];
    for (const u of p.units ?? []) {
      for (const c of u.chapters ?? []) {
        const matched = (c.standards ?? []).filter((s) => wanted.has(s));
        if (matched.length) {
          hits.push({
            unit: `${u.no}. ${u.name}`,
            chapter: `${c.no}. ${c.name}`,
            // 소단원 수준 매핑이 있으면 해당 성취기준을 다루는 소단원만 남긴다(씨마스).
            // 매핑이 없으면(YBM·천재) 중단원의 소단원을 그대로 보여 준다.
            sections: (c.sections ?? [])
              .filter((s) => !(s.standards ?? []).length || (s.standards ?? []).some((x) => wanted.has(x)))
              .map((s) => ({
                label: `${s.no} ${s.name}`,
                page: s.page,
                pinpoint: (s.standards ?? []).some((x) => wanted.has(x)),
              })),
            standards: matched,
            confidence: c.confidence ?? 'unknown',
            basis: c.basis ?? null,
          });
        }
      }
    }
    return { publisher: p, hits };
  });
}

/** 모든 term 블록을 모아 용어집을 만든다 */
export function glossary() {
  const out = [];
  for (const l of lessons) {
    for (const b of l.blocks ?? []) {
      if (b.type === 'term' && b.term) {
        out.push({ term: b.term, desc: b.desc, lessonId: l.id, lessonTitle: l.title });
      }
    }
  }
  // 같은 용어가 여러 차시에 나오면 첫 등장만 대표로 두고 나머지는 also에 모은다
  const byTerm = new Map();
  for (const t of out) {
    const key = t.term.replace(/\s*\(.*?\)\s*$/, '').trim();
    if (!byTerm.has(key)) byTerm.set(key, { ...t, key, also: [] });
    else byTerm.get(key).also.push({ lessonId: t.lessonId, lessonTitle: t.lessonTitle });
  }
  return [...byTerm.values()].sort((a, b) => a.key.localeCompare(b.key, 'ko'));
}

/** 검색 색인 — 빌드 시 만들어 클라이언트에 넘긴다 */
export function searchIndex() {
  const plain = (s) => String(s ?? '').replace(/[*`_]/g, '');
  return lessons.map((l) => {
    const parts = [l.title, l.lead, ...(l.keywords ?? []), ...(l.objectives ?? [])];
    for (const b of l.blocks ?? []) {
      if (b.md) parts.push(plain(b.md));
      if (b.text) parts.push(b.text);
      if (b.term) parts.push(`${b.term} ${b.desc ?? ''}`);
      if (b.label) parts.push(b.label);
      if (b.caption) parts.push(b.caption);
      if (b.type === 'quiz') for (const q of b.items ?? []) parts.push(q.q);
    }
    return {
      id: l.id,
      title: l.title,
      areaId: l.areaId,
      standards: l.standards ?? [],
      keywords: l.keywords ?? [],
      text: parts.join(' ').slice(0, 6000),
    };
  });
}

/** 차시 안의 heading 블록 → 우측 목차 항목 */
export function tocOf(lesson) {
  return (lesson.blocks ?? [])
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => b.type === 'heading')
    .map(({ b, i }) => ({ id: `sec-${i}`, level: b.level ?? 2, text: b.text }));
}

export const stats = {
  lessons: lessons.length,
  standards: standards.length,
  covered: new Set(lessons.flatMap((l) => l.standards ?? [])).size,
  blocks: lessons.reduce((n, l) => n + (l.blocks?.length ?? 0), 0),
  quizItems: lessons.reduce(
    (n, l) => n + (l.blocks ?? []).filter((b) => b.type === 'quiz').reduce((m, b) => m + (b.items?.length ?? 0), 0),
    0,
  ),
};
