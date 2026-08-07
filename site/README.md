# 데이터 과학 웹 교과서 — 사이트

`content/` 의 JSON을 읽어 정적 사이트를 만든다. 콘텐츠와 코드가 분리되어 있어
차시를 고칠 때 HTML을 건드리지 않는다.

## 개발

```bash
cd site
npm install
npm run dev      # http://localhost:4321
```

## 빌드와 배포

```bash
npm run build    # site/dist/ 에 정적 파일 생성 (25개 페이지)
```

`dist/` 를 그대로 웹 서버에 올리거나, 파이썬만으로 열 수 있다.

```bash
python serve.py  # 학교 전산실·USB 배포용. Node 불필요
```

## 검증

```bash
node test/chart.test.mjs      # 차트 모듈 (22개 검사)
node test/pyrunner.test.mjs   # 파이썬 실행기, 특히 오프라인 폴백 (24개 검사)
python ../scripts/validate.py # 콘텐츠 스키마·성취기준 매핑·[확인필요]
```

## 구조

```
src/
├─ lib/
│  ├─ content.js      빌드 시 ../content/*.json 을 읽어 정리 (성취기준 조인 포함)
│  └─ md.js           제한된 마크다운 + 용어 툴팁 삽입
├─ layouts/Textbook.astro   3단 레이아웃 셸 (모든 페이지 공유)
├─ components/
│  ├─ UnitTree.astro  좌측 단원 트리 (교육과정 기준 라벨)
│  └─ Blocks.astro    본문 블록 렌더러 — 유일한 렌더 경로
├─ scripts/           브라우저에서 도는 부분
│  ├─ app.js          드로어·테마·목차 스파이·진도
│  ├─ chart.js        공용 차트 (scatter/line/bar/hist/box)
│  ├─ pyrunner.js     Pyodide 실행기 + 오프라인 폴백
│  ├─ quiz.js         즉시 채점
│  ├─ term.js         용어 툴팁 (키보드 접근 가능)
│  └─ search.js       검색·필터
└─ pages/
   ├─ index.astro           과목 처음
   ├─ lesson/[id].astro     차시 19개 (성취기준 코드가 URL)
   ├─ standards.astro       성취기준 일람
   ├─ crosswalk.astro       교과서 대조표
   ├─ glossary.astro        용어집
   ├─ search.astro          검색
   ├─ about.astro           집필 근거와 출처
   └─ search-index.json.js  검색 색인 (정적 파일로 분리)
```

## 설계상 지킨 것

- **출판사 중립.** 교과서를 고르는 기능을 두지 않는다. 특정 교과서를 기본값으로 두면 화면이
  그 교과서 중심으로 읽히므로, 차시마다 3사 위치를 나란히 보여 주는 방식만 남겼다.

- **차트 데이터를 클라이언트가 만들지 않는다.** 리사이즈는 다시 그리기만 한다.
  (참고한 기존 사이트는 리사이즈 때 데이터를 재생성해 통계값이 바뀌는 버그가 있었다.)
- **차트 색·폰트는 CSS 변수와 본문 폰트를 따른다.** 테마를 바꾸면 차트도 바뀐다.
- **모든 차트에 데이터 표 대체본**이 붙는다. 스크린리더와 인쇄 양쪽을 위한 것이다.
- **파이썬 실행기는 지연 로드**하고, 실패하면 예상 출력을 보여 준다.
- 퀴즈 정답은 스키마에서 필수이며 `scripts/validate.py` 가 빌드 전에 검사한다.
