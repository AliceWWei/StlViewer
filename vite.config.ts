import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // GitHub Pages 把站点放在 /<仓库名>/ 下面，所以资源路径要带上这个前缀
  base: process.env.GITHUB_ACTIONS ? '/stl-viewer/' : '/',
})
