/**
 * 单位换算。
 *
 * 有两个不同的“单位”，容易搞混：
 * 1. 文件单位：文件里的数字是什么单位。STL 和 OBJ 只有数字没有单位，切片软件默认按毫米理解；
 *    如果模型是用英寸或米导出的，放进来就会小 25.4 倍或 1000 倍，这是很常见的坑。
 *    3MF 会在文件里写明单位，可以自动换算。读进来以后统一换算成毫米，内部计算都用毫米。
 * 2. 显示单位：界面上用什么单位显示长度、面积、体积，只影响显示，不影响计算。
 * 界面上显示的单位名称在 i18n.ts 里。
 */
export const UNITS = {
  mm: { toMm: 1, threeMF: 'millimeter', symbol: 'mm' },
  cm: { toMm: 10, threeMF: 'centimeter', symbol: 'cm' },
  m: { toMm: 1000, threeMF: 'meter', symbol: 'm' },
  inch: { toMm: 25.4, threeMF: 'inch', symbol: 'in' },
  um: { toMm: 0.001, threeMF: 'micron', symbol: 'µm' },
} as const;

export type UnitName = keyof typeof UNITS;

/**
 * 按“如果按毫米理解，模型有多大”来猜单位是否可疑。
 * 3D 打印的零件一般在几毫米到几百毫米之间，太小或太大都值得提醒一下。
 */
export function suggestUnit(maxDimensionMm: number): UnitName | null {
  if (maxDimensionMm <= 0) return null;
  if (maxDimensionMm < 1) return 'm'; // 比如 0.05，多半是用米导出的 50 mm 零件
  if (maxDimensionMm < 8) return 'inch'; // 比如 2.4，多半是 2.4 英寸 ≈ 61 mm
  if (maxDimensionMm > 5000) return 'um';
  return null;
}

// ───────────────────────── 显示单位 ─────────────────────────

export const DISPLAY_UNITS = {
  mm: { mmPer: 1, length: 'mm', area: 'mm²', volume: 'cm³', mm3Per: 1000, digits: 1 },
  cm: { mmPer: 10, length: 'cm', area: 'cm²', volume: 'cm³', mm3Per: 1000, digits: 2 },
  inch: { mmPer: 25.4, length: 'in', area: 'in²', volume: 'in³', mm3Per: 25.4 ** 3, digits: 2 },
} as const;

export type DisplayUnit = keyof typeof DISPLAY_UNITS;

export function isDisplayUnit(v: unknown): v is DisplayUnit {
  return typeof v === 'string' && v in DISPLAY_UNITS;
}

/** 千分位 + 固定小数位。固定用 en-US 格式（1,234.5），中英文界面都一样，结果也稳定可测 */
export function formatNumber(n: number, digits = 1): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** 毫米 → 显示单位的数值 */
export function toDisplayLength(mm: number, unit: DisplayUnit): number {
  return mm / DISPLAY_UNITS[unit].mmPer;
}

/** 长度：25.4 mm → "1.00 in" */
export function formatLength(mm: number, unit: DisplayUnit, digits: number = DISPLAY_UNITS[unit].digits): string {
  return `${formatNumber(toDisplayLength(mm, unit), digits)} ${DISPLAY_UNITS[unit].length}`;
}

/** 三个方向的尺寸：60 × 31 × 48 mm */
export function formatSize(sizeMm: readonly number[], unit: DisplayUnit): string {
  const d = DISPLAY_UNITS[unit];
  return `${sizeMm.map((v) => formatNumber(v / d.mmPer, d.digits)).join(' × ')} ${d.length}`;
}

/** 面积：645.16 mm² → "1.00 in²" */
export function formatArea(mm2: number, unit: DisplayUnit, digits: number = DISPLAY_UNITS[unit].digits): string {
  const d = DISPLAY_UNITS[unit];
  return `${formatNumber(mm2 / d.mmPer ** 2, digits)} ${d.area}`;
}

/** 体积：毫米单位用 cm³（切片软件的习惯），英寸用 in³。1000 mm³ → "1.00 cm³" */
export function formatVolume(mm3: number, unit: DisplayUnit, digits = 2): string {
  const d = DISPLAY_UNITS[unit];
  return `${formatNumber(mm3 / d.mm3Per, digits)} ${d.volume}`;
}
