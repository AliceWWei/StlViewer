/**
 * 单位换算。STL 和 OBJ 文件里只有数字，没有单位，切片软件默认按毫米理解。
 * 如果模型是用英寸或米导出的，放进来就会小 25.4 倍或 1000 倍，这是很常见的坑。
 * 3MF 会在文件里写明单位，可以自动换算。界面上显示的单位名称在 i18n.ts 里。
 */
export const UNITS = {
  mm: { toMm: 1, threeMF: 'millimeter' },
  cm: { toMm: 10, threeMF: 'centimeter' },
  m: { toMm: 1000, threeMF: 'meter' },
  inch: { toMm: 25.4, threeMF: 'inch' },
  um: { toMm: 0.001, threeMF: 'micron' },
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
