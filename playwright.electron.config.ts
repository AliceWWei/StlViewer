import { defineConfig } from '@playwright/test';

/**
 * 桌面版的端到端测试：用 Playwright 的 _electron 直接启动 Electron 主进程，
 * 同时能控制页面（renderer）和在主进程里执行代码（比如替换系统对话框）。
 *
 * 运行：npm run e2e:electron（会先用相对路径 base 构建 dist/）
 * Linux 上没有显示器时需要 xvfb-run。
 */
export default defineConfig({
  testDir: './e2e/electron',
  testMatch: '**/*.e2e.ts',
  forbidOnly: !!process.env.CI,
  workers: 1, // 应用是单实例的，同时开两个会互相抢
  retries: 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report-electron' }]] : 'list',
  timeout: 60_000,
  use: { trace: 'off' },
});
