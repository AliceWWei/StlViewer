import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test as base, expect, type Page } from '@playwright/test';

const samplePath = (name: string) => fileURLToPath(new URL(`../public/samples/${name}`, import.meta.url));
const fixturePath = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

/**
 * 每个测试都会收集页面里的 JS 报错和 console.error，测试结束时必须为空：
 * 很多 WebGL / Three.js 的问题不会让页面崩掉，只会在控制台里报错。
 */
const test = base.extend<{ pageErrors: string[] }>({
  pageErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      await use(errors);
      expect(errors, 'page should not log errors').toEqual([]);
    },
    { auto: true },
  ],
});

/** 侧栏里 <dt>标签</dt><dd>值</dd> 的值 */
function field(page: Page, label: string) {
  return page
    .locator('aside dt')
    .filter({ hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) })
    .locator('xpath=following-sibling::dd[1]');
}

async function loadSample(page: Page, file: string) {
  await page.locator('aside select').first().selectOption(file);
  await expect(field(page, 'File')).toHaveText(file, { timeout: 30_000 });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.viewer canvas')).toBeVisible();
});

test('loads a sample model and shows its statistics', async ({ page }) => {
  await loadSample(page, '3DBenchy.stl');
  await expect(field(page, 'Triangles')).toHaveText('225,706');
  await expect(field(page, 'Size')).toHaveText('60.0 × 31.0 × 48.0 mm');
  await expect(page.getByText('Surface is closed (watertight)')).toBeVisible();
  await expect(field(page, 'Volume')).toHaveText('15.55 cm³');
});

test('opens a file chosen with the file picker', async ({ page }) => {
  await page.locator('input[type=file]').setInputFiles(samplePath('box.stl'));
  await expect(field(page, 'File')).toHaveText('box.stl');
  await expect(field(page, 'Triangles')).toHaveText('12');
  await expect(field(page, 'Size')).toHaveText('20.0 × 10.0 × 30.0 mm');
  await expect(field(page, 'Volume')).toHaveText('6.00 cm³');
});

test('opens a file dragged into the window', async ({ page }) => {
  const b64 = readFileSync(samplePath('box.stl')).toString('base64');
  // 在页面里构造一个带文件的 DataTransfer，模拟从资源管理器拖进来
  const dataTransfer = await page.evaluateHandle(
    ({ b64, name }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], name));
      return dt;
    },
    { b64, name: 'dragged-box.stl' },
  );
  await page.dispatchEvent('.app', 'dragover', { dataTransfer });
  await expect(page.locator('.drop-overlay')).toHaveText('Drop to load the model');
  await page.dispatchEvent('.app', 'drop', { dataTransfer });
  await expect(field(page, 'File')).toHaveText('dragged-box.stl');
  await expect(field(page, 'Triangles')).toHaveText('12');
  await expect(page.locator('.drop-overlay')).toHaveCount(0);
});

test('rotating and zooming change the view without errors', async ({ page }) => {
  await loadSample(page, 'gear.stl');
  const canvas = page.locator('.viewer canvas');
  const before = await canvas.screenshot();

  const box = (await canvas.boundingBox())!;
  const cx = box.x + box.width * 0.6;
  const cy = box.y + box.height * 0.5;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 200, cy + 60, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(800);
  const rotated = await canvas.screenshot();
  expect(rotated.equals(before)).toBe(false);

  await page.mouse.wheel(0, -600);
  await page.waitForTimeout(800);
  const zoomed = await canvas.screenshot();
  expect(zoomed.equals(rotated)).toBe(false);
});

test('switches between English and Chinese', async ({ page }) => {
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByText('Open file', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: '切换到中文' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.getByText('打开文件', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Switch to English' })).toHaveText('EN');

  // 选择会被记住
  await page.reload();
  await expect(page.getByText('打开文件', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Switch to English' }).click();
  await expect(page.getByText('Open file', { exact: true })).toBeVisible();
  // 英文界面里除了切换按钮的简称之外不应该有汉字
  const text = await page.locator('aside').innerText();
  expect(text.match(/[一-鿿]/g)).toBeNull();
});

test('shows a friendly error for unsupported or empty files', async ({ page }) => {
  const input = page.locator('input[type=file]');
  await input.setInputFiles(fixturePath('notes.txt'));
  await expect(page.locator('aside .error')).toHaveText(
    'Unsupported file format: notes.txt (only .stl / .obj / .3mf)',
  );

  await input.setInputFiles(fixturePath('empty.obj'));
  await expect(page.locator('aside .error')).toHaveText('No mesh found in the file');

  // 之后再打开正常文件，错误提示消失
  await input.setInputFiles(samplePath('box.stl'));
  await expect(field(page, 'File')).toHaveText('box.stl');
  await expect(page.locator('aside .error')).toHaveCount(0);
});

test('reads the unit declared in a 3MF file', async ({ page }) => {
  await loadSample(page, 'bracket.3mf');
  await expect(field(page, 'Size')).toHaveText('30.0 × 20.0 × 40.0 mm');
  await expect(field(page, 'Volume')).toHaveText('6.50 cm³');
});

test('converts an STL exported in inches', async ({ page }) => {
  await loadSample(page, 'gear-inch.stl');
  await expect(field(page, 'Size')).toHaveText('2.4 × 2.4 × 0.4 mm');
  await page.getByRole('button', { name: /^Convert from/ }).click();
  await expect(field(page, 'Size')).toHaveText('61.7 × 61.7 × 10.0 mm');
});

test('overhang analysis finds the underside of the L bracket arm', async ({ page }) => {
  await loadSample(page, 'bracket.3mf');
  await page.getByLabel('Highlight overhangs that need support').check();
  // 横臂下面 25 × 20 mm = 500 mm²
  await expect(field(page, 'Overhang area')).toHaveText('500.0 mm²');
});

test('slice preview shows the cross-section of the box', async ({ page }) => {
  await loadSample(page, 'box.stl');
  await page.getByLabel('View cross-sections layer by layer').check();
  await expect(field(page, 'Layer')).toContainText('/ 150');
  await expect(field(page, 'Section area')).toHaveText('200.0 mm²');
  await expect(field(page, 'Contours')).toHaveText('1 solid, 0 holes');
  await expect(page.locator('.slice-canvas')).toBeVisible();
});

test('renders the model the same as the reference screenshot', async ({ page }) => {
  // 参考截图是在 Linux + SwiftShader 下生成的，其他系统的渲染细节会不同
  test.skip(process.platform !== 'linux', 'reference screenshot is Linux-only');
  await loadSample(page, 'gear.stl');
  await page.addStyleTag({ content: '.panel { visibility: hidden !important; }' });
  await page.waitForTimeout(1200);
  await expect(page.locator('.viewer canvas')).toHaveScreenshot('gear.png');
});

test('measures the distance between two clicked points', async ({ page }) => {
  await loadSample(page, 'box.stl');
  await page.getByLabel('Measure distance (click two points)').check();
  await expect(page.getByText('Click the first point; Esc to clear')).toBeVisible();
  const box = (await page.locator('.viewer canvas').boundingBox())!;
  // 模型被相机对准在画面中间，点中间偏上和偏下两个点
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.42);
  await expect(page.getByText('Click the second point; Esc to clear')).toBeVisible();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.62);
  await expect(field(page, 'Distance')).toHaveText(/^\d+\.\d{2} mm$/);
  await page.keyboard.press('Escape');
  await expect(page.getByText('Click the first point; Esc to clear')).toBeVisible();
});

test('every sample in the list loads', async ({ page }) => {
  test.setTimeout(180_000);
  const files = await page.locator('aside select').first().locator('option').evaluateAll((os) =>
    os.map((o) => (o as HTMLOptionElement).value).filter(Boolean),
  );
  expect(files.length).toBeGreaterThanOrEqual(16);
  for (const file of files) {
    await loadSample(page, file);
    await expect(field(page, 'Triangles')).toHaveText(/^[\d,]+$/);
    await expect(page.locator('aside .error')).toHaveCount(0);
  }
});

test('repairs the open teapot and exports it as STL', async ({ page }) => {
  await loadSample(page, 'teapot.stl');
  await expect(page.getByText('Surface is not closed', { exact: false })).toBeVisible();
  await expect(field(page, 'Open edges')).toHaveText('192');

  await page.getByRole('button', { name: 'Repair mesh' }).click();
  await expect(page.locator('.repair-report')).toContainText('filled 6 holes (192 new triangles)');
  await expect(field(page, 'Open edges')).toHaveText('0');
  await expect(page.getByText('Surface is closed (watertight)')).toBeVisible();
  await expect(field(page, 'Triangles')).toHaveText('9,312');

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export STL' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('teapot-repaired.stl');
  const bytes = readFileSync(await file.path());
  // 二进制 STL：84 字节头 + 每个三角形 50 字节
  expect(bytes.readUInt32LE(80)).toBe(9312);
  expect(bytes.length).toBe(84 + 9312 * 50);

  // 导出的文件再打开，应该是封闭的
  await page.locator('input[type=file]').setInputFiles({ name: 'teapot-repaired.stl', mimeType: 'model/stl', buffer: bytes });
  await expect(field(page, 'File')).toHaveText('teapot-repaired.stl');
  await expect(page.getByText('Surface is closed (watertight)')).toBeVisible();
});

test('repair leaves large holes open and says so', async ({ page }) => {
  await loadSample(page, 'vase.stl');
  await page.getByRole('button', { name: 'Repair mesh' }).click();
  await expect(page.locator('.repair-report')).toContainText('Nothing to repair');
  await expect(page.locator('.repair-report')).toContainText('2 holes are too large to fill');
  await expect(field(page, 'Open edges')).toHaveText('192');
});

test('wall thickness analysis finds the thin walls of the fan shroud', async ({ page }) => {
  await loadSample(page, 'box.stl');
  await page.getByLabel('Analyze wall thickness (mark thin areas)').check();
  // 方块每个方向都至少 10 mm，比射线上限还厚
  await expect(field(page, 'Thinnest')).toHaveText('> 10.0 mm', { timeout: 30_000 });
  await expect(page.getByText('Every wall is thick enough')).toBeVisible();

  await loadSample(page, 'prusa-fan-shroud.stl');
  await expect(field(page, 'Thin area')).toHaveText(/^[\d,.]+ mm² \([\d.]+%\)$/, { timeout: 30_000 });
  await expect(page.getByText('Red areas are thinner than 0.8 mm')).toBeVisible();
  const thinAt08 = parseFloat((await field(page, 'Thin area').innerText()).replace(/,/g, ''));
  expect(thinAt08).toBeGreaterThan(10);

  // 最小壁厚调到 2 mm，太薄的面积应该变大
  await page.getByRole('slider', { name: 'Minimum wall' }).fill('2');
  await expect(page.getByText('Red areas are thinner than 2.0 mm')).toBeVisible();
  const thinAt2 = parseFloat((await field(page, 'Thin area').innerText()).replace(/,/g, ''));
  expect(thinAt2).toBeGreaterThan(thinAt08);

  await page.getByRole('combobox').filter({ hasText: 'Heatmap' }).selectOption('passFail');
  await expect(page.locator('.legend')).toContainText('OK');
});
