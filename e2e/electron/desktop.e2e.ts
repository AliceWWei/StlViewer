import { fileURLToPath } from 'node:url';
import { _electron as electron, test as base, expect, type ElectronApplication, type Page } from '@playwright/test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const samplePath = (name: string) => fileURLToPath(new URL(`../../public/samples/${name}`, import.meta.url));

/**
 * 每个测试启动一个全新的应用。启动参数里可以带一个模型文件路径，
 * 和 Windows 上双击关联文件时传进来的参数一样。
 */
const test = base.extend<{ launch: (file?: string) => Promise<{ app: ElectronApplication; page: Page; errors: string[] }> }>({
  launch: async ({}, use) => {
    const apps: ElectronApplication[] = [];
    const allErrors: string[] = [];
    await use(async (file) => {
      const app = await electron.launch({
        cwd: root,
        args: [
          // CI / 容器里以 root 运行且没有 GPU：关掉 Chromium 的进程沙盒，WebGL 用软件渲染
          ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
          '--use-angle=swiftshader',
          '--enable-unsafe-swiftshader',
          '--ignore-gpu-blocklist',
          '.',
          ...(file ? [file] : []),
        ],
        env: { ...process.env, VITE_DEV_SERVER_URL: '' },
      });
      apps.push(app);
      const page = await app.firstWindow();
      page.on('pageerror', (e) => allErrors.push(e.message));
      page.on('console', (m) => {
        if (m.type() === 'error') allErrors.push(m.text());
      });
      await expect(page.locator('.viewer canvas')).toBeVisible();
      return { app, page, errors: allErrors };
    });
    for (const app of apps) await app.close();
    expect(allErrors, 'page should not log errors').toEqual([]);
  },
});

function field(page: Page, label: string) {
  return page
    .locator('aside dt')
    .filter({ hasText: new RegExp(`^${label}$`) })
    .locator('xpath=following-sibling::dd[1]');
}

/** 在主进程里找到 File 菜单的第一项（Open…）并点击，和用户点菜单或按 Ctrl+O 走同一个函数 */
function clickOpenMenu(app: ElectronApplication) {
  return app.evaluate(({ Menu }) => {
    const file = Menu.getApplicationMenu()!.items[0];
    file.submenu!.items[0].click();
  });
}

test('opens the model passed on the command line (file association)', async ({ launch }) => {
  const { page } = await launch(samplePath('box.stl'));
  await expect(field(page, 'File')).toHaveText('box.stl', { timeout: 30_000 });
  await expect(field(page, 'Triangles')).toHaveText('12');
  await expect(field(page, 'Size')).toHaveText('20.0 × 10.0 × 30.0 mm');
  await expect(page).toHaveTitle(/StlViewer|STL/i);
});

test('the page is isolated from Node.js and only sees the preload API', async ({ launch }) => {
  const { page } = await launch();
  const globals = await page.evaluate(() => ({
    require: typeof (window as unknown as { require?: unknown }).require,
    process: typeof (window as unknown as { process?: unknown }).process,
    desktop: Object.keys(window.desktop ?? {}).sort(),
  }));
  expect(globals).toEqual({
    require: 'undefined',
    process: 'undefined',
    desktop: ['onOpenFile', 'openFileDialog', 'platform', 'setLanguage'],
  });
});

test('File › Open… shows the native dialog and loads the chosen file', async ({ launch }) => {
  const { app, page } = await launch();
  // 真正的系统对话框没法在测试里操作，这里在主进程里把它换成直接返回一个文件
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as typeof dialog.showOpenDialog;
  }, samplePath('bracket.3mf'));
  await clickOpenMenu(app);
  await expect(field(page, 'File')).toHaveText('bracket.3mf', { timeout: 30_000 });
  await expect(field(page, 'Size')).toHaveText('30.0 × 20.0 × 40.0 mm');
});

test('cancelling the dialog keeps the current model', async ({ launch }) => {
  const { app, page } = await launch(samplePath('box.stl'));
  await expect(field(page, 'File')).toHaveText('box.stl', { timeout: 30_000 });
  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = (async () => ({ canceled: true, filePaths: [] })) as typeof dialog.showOpenDialog;
  });
  await clickOpenMenu(app);
  await page.waitForTimeout(500);
  await expect(field(page, 'File')).toHaveText('box.stl');
});

test('the native menu follows the app language', async ({ launch }) => {
  const { app, page } = await launch();
  const menuLabels = () => app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items.map((i) => i.label));

  // 先固定成英文，免得受上一次测试留下的语言设置影响
  if ((await page.locator('html').getAttribute('lang')) !== 'en') {
    await page.getByRole('button', { name: 'Switch to English' }).click();
  }
  await expect.poll(menuLabels).toEqual(['File', 'View', 'Help']);

  await page.getByRole('button', { name: '切换到中文' }).click();
  await expect.poll(menuLabels).toEqual(['文件', '查看', '帮助']);

  await page.getByRole('button', { name: 'Switch to English' }).click();
  await expect.poll(menuLabels).toEqual(['File', 'View', 'Help']);
});
