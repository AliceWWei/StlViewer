import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // GitHub Pages 把站点放在 /<仓库名>/ 下面，所以资源路径要带上这个前缀。
  // VITE_BASE 可以覆盖它：端到端测试在 CI 里也用根路径 /（vite preview 同样读这个配置）
  base: process.env.VITE_BASE ?? (process.env.GITHUB_ACTIONS ? '/StlViewer/' : '/'),
})
