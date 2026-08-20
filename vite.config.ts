import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 相对路径 base，便于部署到 GitHub Pages 的子路径（username.github.io/repo/）
export default defineConfig({
  base: './',
  plugins: [react()],
});
