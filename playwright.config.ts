import { defineConfig, devices } from '@playwright/test';

/**
 * 端到端测试：启动真实的浏览器，像用户一样操作页面。
 * 单元测试（Vitest）测单个函数，这里测“从打开文件到看到结果”的完整流程。
 *
 * 运行：npx playwright test
 * 测试前会用独立的输出目录构建一次（base 为 /），再用 vite preview 起一个本地服务器。
 */
const PORT = 4173;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  expect: {
    // 截图对比：WebGL 用软件渲染（SwiftShader），允许极少量抗锯齿像素差异
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, threshold: 0.2 },
  },
  use: {
    baseURL: `http://localhost:${PORT}/`,
    locale: 'en-US', // 默认语言跟着浏览器走，固定成英文让断言稳定
    viewport: { width: 1280, height: 800 },
    trace: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
        launchOptions: {
          // 没有 GPU 的环境（CI、容器）里用软件实现的 WebGL
          args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
        },
      },
    },
  ],
  webServer: {
    command: `npx vite build --outDir dist-e2e && npx vite preview --outDir dist-e2e --port ${PORT} --strictPort`,
    // build 和 preview 都要用根路径；否则在 GitHub Actions 里会用 /StlViewer/，资源全部 404
    env: { VITE_BASE: '/' },
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
