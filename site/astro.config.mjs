import { defineConfig } from 'astro/config';

// 포트는 실행 환경이 정한다(PORT). 하드코딩하면 다른 서버와 충돌한다.
const port = Number(process.env.PORT) || 4321;

// GitHub Pages 는 https://trmoo.github.io/22hs-ds/ 하위 경로에 배포된다.
// 로컬 개발·오프라인 배포(serve.py)에서는 루트로 두어야 하므로 환경변수로 가른다.
//   npm run build            → base '/'         (serve.py · USB 배포용)
//   BASE=/22hs-ds/ npm run build → base '/22hs-ds/' (GitHub Pages용)
const base = process.env.BASE || '/';

export default defineConfig({
  site: 'https://trmoo.github.io',
  base,
  outDir: './dist',
  build: { format: 'directory', assets: 'assets' },
  server: { port, host: true },
  devToolbar: { enabled: false },
});
