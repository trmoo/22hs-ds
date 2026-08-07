/**
 * 사이트 내부 링크를 만든다.
 *
 * GitHub Pages 는 https://trmoo.github.io/22hs-ds/ 처럼 하위 경로에 배포되므로
 * 링크를 "/lesson/01-01/" 로 두면 도메인 루트를 가리켜 404 가 된다.
 * astro.config.mjs 의 base 값이 import.meta.env.BASE_URL 로 들어오므로 항상 그것을 앞에 붙인다.
 *
 *   url()                → "/22hs-ds/"        (로컬 개발에서는 "/")
 *   url('standards/')    → "/22hs-ds/standards/"
 *   url('/standards/')   → "/22hs-ds/standards/"   (앞 슬래시는 있어도 된다)
 */
const BASE = import.meta.env.BASE_URL || '/';

export function url(path = '') {
  const base = BASE.endsWith('/') ? BASE : `${BASE}/`;
  return base + String(path).replace(/^\/+/, '');
}

export { BASE };
