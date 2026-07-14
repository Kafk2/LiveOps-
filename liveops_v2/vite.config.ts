import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

// base:'./' — 相对 base，保证 GitHub Pages 子路径下资源不 404（见 plan 部署修订）
export default defineConfig({
  base: './',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  server: {
    port: 5173,
    open: false,
  },
  // public/ 里的 data/ 随构建产物部署，Pages 端可 fetch 读取（见 plan 部署策略）
  publicDir: 'public',
});
