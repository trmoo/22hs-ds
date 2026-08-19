#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
「데이터 과학」 웹 교과서 — 콘텐츠 검증 스크립트

검사 항목
  1. JSON 유효성 / 스키마 필수 필드
  2. 성취기준 매핑 — 차시마다 1개 이상, 존재하는 코드만
  3. 커버리지 — 성취기준 19개가 모두 1개 이상 차시에 연결됐는지
  4. 퀴즈 계약 — answer/explain 필수, 선택지 범위, 타입별 규칙
  5. 블록 계약 — 타입 유효성, code.expect 필수, chart.data 값 존재, figure.src
  6. [확인필요] 전수 수집 (파일 + JSON 경로)
  7. 문체 규칙 (CLAUDE.md §4) 기계 점검

사용법
  python scripts/validate.py                # 리포트 생성 + 콘솔 요약
  python scripts/validate.py --strict       # ERROR가 있으면 종료코드 1
출력
  docs/validation-report.md
"""

import json
import os
import re
import sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CURRICULUM = os.path.join(ROOT, "content", "curriculum.json")
LESSON_DIR = os.path.join(ROOT, "content", "lessons")
# 삽화 SVG 는 본문에 인라인되므로 site/src/figures 에 둔다(public 이 아니다).
FIGURE_DIR = os.path.join(ROOT, "site", "src", "figures")
REPORT = os.path.join(ROOT, "docs", "validation-report.md")

# ── 규칙 상수 ────────────────────────────────────────────────────────────────
MARKER = "[확인필요]"

LESSON_REQUIRED = ["id", "areaId", "order", "title", "lead",
                   "standards", "periods", "objectives", "keywords", "blocks", "status"]

BLOCK_TYPES = {"prose", "heading", "callout", "term",
               "table", "chart", "code", "quiz", "figure", "widget"}

WIDGET_KINDS = {"classify", "order", "match", "join"}
BLANK_RE = re.compile(r"\{\{([^{}|]+?)(?:\|\|([^{}]*?))?\}\}")
BLANK_MIN, BLANK_MAX = 6, 14

CALLOUT_VARIANTS = {"concept", "warn", "tip", "activity"}
CHART_KINDS = {"scatter", "line", "bar", "hist", "box"}

BLOCKS_MIN, BLOCKS_MAX = 12, 24
QUIZ_MIN, QUIZ_MAX = 3, 4
TERM_MIN, TERM_MAX = 2, 5
SENTENCE_MAX = 60

# 구어체·금지 표현 (CLAUDE.md §4-1, §4-4)
STYLE_BANNED = [
    (r"해요[.!?\s]", "구어체 '~해요'"),
    (r"에요[.!?\s]", "구어체 '~에요'"),
    (r"이죠[.!?\s]", "구어체 '~이죠'"),
    (r"죠[.!?\s]", "구어체 '~죠'"),
    (r"봅시다", "구어체 '~봅시다'"),
    (r"봐요", "구어체 '~봐요'"),
    (r"여러분", "'여러분' 사용"),
    (r"놀랍게도", "과장 표현"),
    (r"무려", "과장 표현"),
    (r"데이터를\s*씻", "'씻는다' → '전처리한다'"),
    (r"청소한다", "'청소한다' → '전처리한다'"),
    (r"정답은\s*없", "'정답은 없다' → '문제와 목적에 따라 다르다'"),
    (r"\$\$?[^$]+\$\$?", "LaTeX 수식 (텍스트로 쓸 것)"),
]

EMOJI = re.compile(
    "[\U0001F300-\U0001FAFF\U00002600-\U000027BF\U0001F000-\U0001F0FF⬀-⯿️]"
)
STD_CODE = re.compile(r"^12데과0[1-4]-0[1-9]$")


class Issue:
    __slots__ = ("sev", "where", "msg")

    def __init__(self, sev, where, msg):
        self.sev, self.where, self.msg = sev, where, msg


issues = []
stats_blank = {}
markers = []          # [확인필요] 목록
stats = {}


def add(sev, where, msg):
    issues.append(Issue(sev, where, msg))


def walk_strings(node, path=""):
    """JSON 트리의 모든 문자열을 (경로, 값)으로 순회."""
    if isinstance(node, dict):
        for k, v in node.items():
            yield from walk_strings(v, f"{path}.{k}" if path else k)
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from walk_strings(v, f"{path}[{i}]")
    elif isinstance(node, str):
        yield path, node


def strip_md(text):
    """문장 길이를 잴 때 서식 기호는 세지 않는다."""
    text = re.sub(r"`[^`]*`", "", text)            # 인라인 코드
    text = re.sub(r"\*\*|__", "", text)            # 강조
    text = re.sub(r"^\s*([-*•]|\d+\.)\s+", "", text, flags=re.M)   # 목록 표지
    return text


def split_sentences(text):
    text = strip_md(text)
    parts = re.split(r"(?<=[.!?])\s+|\n+", text)
    return [p.strip() for p in parts if p.strip()]


OBJ_END = re.compile(r"수\s*있다\.?$")


# ── 교육과정 로드 ────────────────────────────────────────────────────────────
if not os.path.exists(CURRICULUM):
    print(f"치명적: {CURRICULUM} 이 없습니다.", file=sys.stderr)
    sys.exit(2)

with open(CURRICULUM, encoding="utf-8") as f:
    cur = json.load(f)

all_codes = [s["code"] for s in cur["standards"]]
code_area = {s["code"]: s["areaId"] for s in cur["standards"]}
area_name = {a["id"]: f'{a["no"]}. {a["name"]}' for a in cur["areas"]}

for c in all_codes:
    if not STD_CODE.match(c):
        add("ERROR", "curriculum.json", f"성취기준 코드 형식 위반: {c}")

# ── 차시 파일 로드 ───────────────────────────────────────────────────────────
lesson_files = sorted(
    f for f in os.listdir(LESSON_DIR) if f.endswith(".json")
) if os.path.isdir(LESSON_DIR) else []

lessons = {}
for fn in lesson_files:
    p = os.path.join(LESSON_DIR, fn)
    try:
        with open(p, encoding="utf-8") as f:
            lessons[fn] = json.load(f)
    except json.JSONDecodeError as e:
        add("ERROR", fn, f"JSON 파싱 실패: {e}")
    except Exception as e:  # noqa
        add("ERROR", fn, f"읽기 실패: {e}")

# ── 차시별 검사 ──────────────────────────────────────────────────────────────
covered = defaultdict(list)          # code -> [파일]

for fn, L in lessons.items():
    W = fn

    # 필수 필드
    for k in LESSON_REQUIRED:
        if k not in L:
            add("ERROR", W, f"필수 필드 누락: {k}")

    # id ↔ 파일명
    if L.get("id") and f'{L["id"]}.json' != fn:
        add("ERROR", W, f'id({L["id"]})와 파일명이 불일치')

    # 성취기준
    stds = L.get("standards")
    if not isinstance(stds, list) or not stds:
        add("ERROR", W, "standards 가 비어 있음 (1개 이상 필수)")
    else:
        for c in stds:
            if c not in code_area:
                add("ERROR", W, f"존재하지 않는 성취기준 코드: {c}")
            else:
                covered[c].append(fn)
                if L.get("areaId") and code_area[c] != L["areaId"]:
                    add("ERROR", W,
                        f"areaId({L['areaId']})와 성취기준 {c}의 영역({code_area[c]}) 불일치")

    # 목표·키워드
    objs = L.get("objectives") or []
    if not (2 <= len(objs) <= 4):
        add("WARN", W, f"objectives {len(objs)}개 (권장 2~4)")
    for o in objs:
        if not OBJ_END.search(o.rstrip()):
            add("WARN", W, f"학습 목표가 '~수 있다'로 끝나지 않음: …{o.rstrip()[-24:]}")
    if not (L.get("keywords") or []):
        add("WARN", W, "keywords 비어 있음")

    if L.get("status") not in ("draft", "review", "done"):
        add("WARN", W, f'status 값 확인: {L.get("status")}')

    # 블록
    blocks = L.get("blocks") or []
    if not (BLOCKS_MIN <= len(blocks) <= BLOCKS_MAX):
        add("WARN", W, f"blocks {len(blocks)}개 (권장 {BLOCKS_MIN}~{BLOCKS_MAX})")

    counts = defaultdict(int)
    quiz_items = 0

    for i, b in enumerate(blocks):
        BW = f"{fn} blocks[{i}]"
        t = b.get("type")
        if t not in BLOCK_TYPES:
            add("ERROR", BW, f"알 수 없는 블록 타입: {t}")
            continue
        counts[t] += 1

        if t == "prose" and not b.get("md"):
            add("ERROR", BW, "prose.md 누락")

        elif t == "heading":
            if b.get("level") not in (2, 3):
                add("ERROR", BW, "heading.level 은 2 또는 3")
            if not b.get("text"):
                add("ERROR", BW, "heading.text 누락")

        elif t == "callout":
            if b.get("variant") not in CALLOUT_VARIANTS:
                add("ERROR", BW, f'callout.variant 확인: {b.get("variant")}')
            if not b.get("label"):
                add("WARN", BW, "callout.label 누락")
            if not b.get("md"):
                add("ERROR", BW, "callout.md 누락")

        elif t == "term":
            if not b.get("term") or not b.get("desc"):
                add("ERROR", BW, "term.term / term.desc 필수")

        elif t == "table":
            head, rows = b.get("head"), b.get("rows")
            if not head or not rows:
                add("ERROR", BW, "table.head / table.rows 필수")
            elif any(len(r) != len(head) for r in rows):
                add("ERROR", BW, "table 행의 열 수가 head와 다름")

        elif t == "chart":
            if b.get("kind") not in CHART_KINDS:
                add("ERROR", BW, f'chart.kind 확인: {b.get("kind")}')
            d = b.get("data")
            if not isinstance(d, (list, dict)) or not d:
                add("ERROR", BW, "chart.data 가 값으로 들어 있지 않음")
            elif isinstance(d, list):
                # x·y 가 data 원소의 키로 실재하는지 (CLAUDE.md §3-7)
                for key in ("x", "y"):
                    kn = b.get(key)
                    if kn and isinstance(d[0], dict) and kn not in d[0]:
                        add("ERROR", BW, f'chart.{key}="{kn}" 가 data 원소의 키에 없음')
            if not b.get("xLabel") or not b.get("yLabel"):
                add("WARN", BW, "chart 축 라벨 권장(xLabel/yLabel)")
            if not b.get("caption"):
                add("WARN", BW, "chart.caption 권장 — 데이터의 출처·성격을 밝힐 것(§3-7)")

        elif t == "code":
            if b.get("lang") != "python":
                add("WARN", BW, f'code.lang: {b.get("lang")}')
            if not b.get("source"):
                add("ERROR", BW, "code.source 누락")
            if not b.get("expect"):
                add("ERROR", BW, "code.expect 누락 (오프라인 폴백에 필수)")

        elif t == "figure":
            src = b.get("src")
            if not src:
                add("ERROR", BW, "figure.src 누락")
            elif src == MARKER and not b.get("note"):
                add("WARN", BW, "figure 가 [확인필요]인데 note(필요한 그림 설명) 없음")
            elif src != MARKER:
                # 경로만 적고 파일을 안 만들면 화면에 깨진 그림이 남는다.
                name = os.path.basename(src)
                if not src.lower().endswith(".svg"):
                    add("WARN", BW, f"figure.src 가 SVG 가 아니다: {src} (인라인되지 않아 어두운 화면에서 어긋난다)")
                elif not os.path.isfile(os.path.join(FIGURE_DIR, name)):
                    add("ERROR", BW, f"figure.src 파일이 없다: site/src/figures/{name}")
            if not b.get("alt"):
                add("ERROR", BW, "figure.alt 누락 (접근성)")

        elif t == "widget":
            k = b.get("kind")
            if k not in WIDGET_KINDS:
                add("ERROR", BW, f"widget.kind 확인: {k}")
            if not b.get("title"):
                add("WARN", BW, "widget.title 권장")
            if k == "classify":
                bins = {x.get("id") for x in (b.get("bins") or [])}
                if len(bins) < 2:
                    add("ERROR", BW, "classify 는 bins 2개 이상 필요")
                for it in (b.get("items") or []):
                    if it.get("bin") not in bins:
                        add("ERROR", BW, f'classify item "{it.get("text")}" 의 bin 이 bins 에 없음')
                    if not it.get("explain"):
                        add("WARN", BW, f'classify item "{it.get("text")}" 에 explain 없음 — 오답 이유를 알려줄 수 없다')
            elif k == "order":
                items = b.get("items") or []
                sh = b.get("shuffled")
                if len(items) < 3:
                    add("ERROR", BW, "order 는 items 3개 이상 필요")
                if sh is None:
                    add("ERROR", BW, "order.shuffled 누락 — 표시 순서를 데이터로 고정해야 한다")
                elif sorted(sh) != list(range(len(items))):
                    add("ERROR", BW, f"order.shuffled 가 items 인덱스 순열이 아님: {sh}")
            elif k == "match":
                pairs = b.get("pairs") or []
                ro = b.get("rightOrder")
                if len(pairs) < 2:
                    add("ERROR", BW, "match 는 pairs 2개 이상 필요")
                if ro is None:
                    add("ERROR", BW, "match.rightOrder 누락 — 오른쪽 표시 순서를 고정해야 한다")
                elif sorted(ro) != list(range(len(pairs))):
                    add("ERROR", BW, f"match.rightOrder 가 pairs 인덱스 순열이 아님: {ro}")
            elif k == "join":
                for side in ("left", "right"):
                    t2 = b.get(side) or {}
                    if not t2.get("head") or not t2.get("rows"):
                        add("ERROR", BW, f"join.{side}.head / rows 필수")
                    elif any(len(r) != len(t2["head"]) for r in t2["rows"]):
                        add("ERROR", BW, f"join.{side} 행의 열 수가 head 와 다름")
                key = b.get("key")
                for side in ("left", "right"):
                    head = (b.get(side) or {}).get("head") or []
                    if key and head and key not in head:
                        add("ERROR", BW, f'join.key "{key}" 가 {side}.head 에 없음')
                cands = b.get("candidates") or []
                if key and cands and key not in cands:
                    add("ERROR", BW, "join.candidates 에 정답 key 가 없음")

        elif t == "quiz":
            items = b.get("items") or []
            quiz_items += len(items)
            if not items:
                add("ERROR", BW, "quiz.items 비어 있음")
            for j, q in enumerate(items):
                QW = f"{BW}.items[{j}]"
                if not q.get("q"):
                    add("ERROR", QW, "문항 q 누락")
                if "answer" not in q:
                    add("ERROR", QW, "answer 누락 — 학생이 정답을 맞힐 수 없음")
                if not q.get("explain"):
                    add("ERROR", QW, "explain(해설) 누락")
                qt = q.get("type")
                if qt == "mc":
                    ch = q.get("choices") or []
                    if len(ch) < 2:
                        add("ERROR", QW, "mc 선택지 2개 이상 필요")
                    a = q.get("answer")
                    if not isinstance(a, int) or not (0 <= a < len(ch)):
                        add("ERROR", QW, f"mc answer 인덱스 범위 오류: {a} / 선택지 {len(ch)}")
                elif qt == "ox":
                    if not isinstance(q.get("answer"), bool):
                        add("ERROR", QW, "ox answer 는 true/false")
                else:
                    add("ERROR", QW, f"알 수 없는 문항 type: {qt}")

    # 빈칸 — 학생이 직접 채우는 자리가 있는지
    blank_total = 0
    for b in blocks:
        for key in ("md",):
            if b.get(key):
                for m in BLANK_RE.finditer(b[key]):
                    blank_total += 1
                    ans, hint = m.group(1), m.group(2)
                    if not ans.strip():
                        add("ERROR", W, "빈칸의 정답이 비어 있음")
                    if len(ans) > 40:
                        add("WARN", W, f"빈칸 정답이 너무 김({len(ans)}자) — 낱말 단위로 비울 것: {ans[:24]}…")
                    if hint is not None and not hint.strip():
                        add("WARN", W, f'빈칸 "{ans[:14]}" 의 힌트가 비어 있음')
    stats_blank[fn] = blank_total
    if blank_total == 0:
        add("WARN", W, "본문 빈칸이 없음 — 학생이 채울 자리를 두는 것을 권장(§3-6-1)")
    elif not (BLANK_MIN <= blank_total <= BLANK_MAX):
        add("WARN", W, f"빈칸 {blank_total}개 (권장 {BLANK_MIN}~{BLANK_MAX})")

    if not (QUIZ_MIN <= quiz_items <= QUIZ_MAX):
        add("WARN", W, f"확인 문제 {quiz_items}문항 (권장 {QUIZ_MIN}~{QUIZ_MAX})")
    if not (TERM_MIN <= counts["term"] <= TERM_MAX):
        add("WARN", W, f'term {counts["term"]}개 (권장 {TERM_MIN}~{TERM_MAX})')

    # 조작 뒤 해석 확인 — chart/code 이후 2블록 안에 설명이 오는지
    # (chart→code→prose 처럼 조작이 연달아 오는 것은 허용한다)
    def explains(bl):
        return bl.get("type") == "prose" or (
            bl.get("type") == "callout" and bl.get("variant") in ("concept", "tip", "warn"))

    for i, b in enumerate(blocks):
        if b.get("type") in ("chart", "code", "widget"):
            look = blocks[i + 1:i + 3]
            if not any(explains(x) or x.get("type") in ("chart", "code", "widget") for x in look):
                add("WARN", f"{fn} blocks[{i}]",
                    f'{b.get("type")} 뒤 2블록 안에 결과를 설명하는 prose/callout이 없음')

    stats[fn] = {
        "title": L.get("title", ""),
        "areaId": L.get("areaId"),
        "standards": stds if isinstance(stds, list) else [],
        "blocks": len(blocks),
        "quiz": quiz_items,
        "term": counts["term"],
        "chart": counts["chart"],
        "code": counts["code"],
        "figure": counts["figure"],
        "widget": counts["widget"],
        "status": L.get("status"),
    }

    # [확인필요] + 문체
    for path, val in walk_strings(L):
        if MARKER in val:
            markers.append((fn, path, val.strip()[:160]))

        in_callout_label = re.search(r"blocks\[\d+\]\.label$", path)
        if not in_callout_label and EMOJI.search(val):
            add("WARN", f"{fn} {path}", "이모지는 callout.label 에만 허용")

        for pat, why in STYLE_BANNED:
            if re.search(pat, val):
                add("WARN", f"{fn} {path}", f"문체: {why}")
                break

        if path.endswith((".md", ".lead", ".desc", ".explain")) or path == "lead":
            for s in split_sentences(val):
                if len(s) > SENTENCE_MAX:
                    add("WARN", f"{fn} {path}", f"문장 {len(s)}자 (최대 {SENTENCE_MAX}) — {s[:34]}…")

# ── 커버리지 ─────────────────────────────────────────────────────────────────
missing = [c for c in all_codes if c not in covered]
for c in missing:
    add("ERROR", "coverage", f"성취기준 {c} 가 어느 차시에도 매핑되지 않음 ({area_name[code_area[c]]})")

expected_files = [f"{c[4:]}.json" for c in all_codes]   # "12데과01-01" → "01-01.json"
absent = [f for f in expected_files if f not in lessons]
for f in absent:
    add("ERROR", "files", f"차시 파일 없음: {f}")

# ── 리포트 ───────────────────────────────────────────────────────────────────
E = [i for i in issues if i.sev == "ERROR"]
Wn = [i for i in issues if i.sev == "WARN"]

lines = []
A = lines.append
A("# 콘텐츠 검증 리포트")
A("")
A("> `scripts/validate.py` 자동 생성. **손으로 고치지 않는다.**")
A("")
A("## 요약")
A("")
A("| 항목 | 값 |")
A("|---|---|")
A(f"| 차시 파일 | {len(lessons)} / {len(all_codes)} |")
A(f"| 성취기준 커버리지 | **{len(all_codes) - len(missing)} / {len(all_codes)}**"
  f"{' ✅' if not missing else ' ❌'} |")
A(f"| ERROR | **{len(E)}** |")
A(f"| WARN | {len(Wn)} |")
A(f"| `[확인필요]` | {len(markers)}건 |")
A(f"| 총 블록 | {sum(s['blocks'] for s in stats.values())} |")
A(f"| 총 확인 문제 | {sum(s['quiz'] for s in stats.values())} |")
A(f"| 총 빈칸 | {sum(stats_blank.values())} |")
A(f"| 총 조작 위젯 | {sum(s['widget'] for s in stats.values())} |")
A("")

A("## 1. 성취기준 커버리지")
A("")
A("| 성취기준 | 영역 | 연결된 차시 |")
A("|---|---|---|")
for c in all_codes:
    got = covered.get(c) or []
    mark = ", ".join(f"`{g}`" for g in got) if got else "**❌ 없음**"
    A(f"| `{c}` | {area_name[code_area[c]]} | {mark} |")
A("")
if missing:
    A(f"**매핑 누락 {len(missing)}건: " + ", ".join(f"`{c}`" for c in missing) + "**")
else:
    A("성취기준 19개 전부가 1개 이상 차시에 매핑되어 있다.")
A("")

A("## 2. 차시 현황")
A("")
A("| 파일 | 제목 | 성취기준 | 블록 | 문제 | 용어 | 차트 | 코드 | 그림 | 위젯 | 빈칸 | 상태 |")
A("|---|---|---|---|---|---|---|---|---|---|---|---|")
for fn in sorted(stats):
    s = stats[fn]
    A(f"| `{fn}` | {s['title']} | {', '.join(s['standards'])} | {s['blocks']} | "
      f"{s['quiz']} | {s['term']} | {s['chart']} | {s['code']} | {s['figure']} | "
      f"{s['widget']} | {stats_blank.get(fn, 0)} | {s['status']} |")
A("")

A("## 3. ERROR — 반드시 고쳐야 함")
A("")
if E:
    A("| 위치 | 내용 |")
    A("|---|---|")
    for i in E:
        A(f"| `{i.where}` | {i.msg} |")
else:
    A("없음.")
A("")

A("## 4. WARN — 검토 권장")
A("")
if Wn:
    by = defaultdict(list)
    for i in Wn:
        by[i.where.split()[0]].append(i)
    for k in sorted(by):
        A(f"**`{k}`** ({len(by[k])}건)")
        A("")
        for i in by[k][:40]:
            A(f"- {i.msg}" + (f"  ·  `{i.where.split(' ',1)[1]}`" if " " in i.where else ""))
        if len(by[k]) > 40:
            A(f"- … 외 {len(by[k]) - 40}건")
        A("")
else:
    A("없음.")
A("")

A("## 5. `[확인필요]` 후속 작업 목록")
A("")
if markers:
    A("| 파일 | 위치 | 내용 |")
    A("|---|---|---|")
    for fn, path, val in markers:
        safe = val.replace("|", "\\|")
        A(f"| `{fn}` | `{path}` | {safe} |")
else:
    A("없음.")
A("")

os.makedirs(os.path.dirname(REPORT), exist_ok=True)
with open(REPORT, "w", encoding="utf-8") as f:
    f.write("\n".join(lines) + "\n")

# ── 콘솔 요약 ────────────────────────────────────────────────────────────────
out = sys.stdout
print(f"차시 파일      : {len(lessons)} / {len(all_codes)}", file=out)
print(f"커버리지       : {len(all_codes) - len(missing)} / {len(all_codes)}"
      + ("  OK" if not missing else "  MISSING: " + ", ".join(missing)), file=out)
print(f"ERROR          : {len(E)}", file=out)
print(f"WARN           : {len(Wn)}", file=out)
print(f"[확인필요]     : {len(markers)}", file=out)
print(f"리포트         : {os.path.relpath(REPORT, ROOT)}", file=out)

if "--strict" in sys.argv and E:
    sys.exit(1)
