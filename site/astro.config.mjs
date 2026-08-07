import { defineConfig } from 'astro/config';

// 포트는 실행 환경이 정한다(PORT). 하드코딩하면 다른 서버와 충돌한다.
const port = Number(process.env.PORT) || 4321;

export default defineConfig({
  base: '/',
  outDir: './dist',
  build: { format: 'directory', assets: 'assets' },
  server: { port, host: true },
  devToolbar: { enabled: false },
});
