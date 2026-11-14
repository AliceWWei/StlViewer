import { describe, expect, it } from 'vitest';
import {
  formatArea,
  formatLength,
  formatNumber,
  formatSize,
  formatVolume,
  isDisplayUnit,
  suggestUnit,
  toDisplayLength,
} from './units';

describe('显示单位换算', () => {
  it('长度', () => {
    expect(formatLength(25.4, 'inch')).toBe('1.00 in');
    expect(formatLength(25.4, 'mm')).toBe('25.4 mm');
    expect(formatLength(25.4, 'cm')).toBe('2.54 cm');
    expect(formatLength(1234.5, 'mm')).toBe('1,234.5 mm');
    expect(toDisplayLength(254, 'inch')).toBeCloseTo(10);
  });

  it('尺寸', () => {
    expect(formatSize([60, 31, 48], 'mm')).toBe('60.0 × 31.0 × 48.0 mm');
    expect(formatSize([25.4, 50.8, 0], 'inch')).toBe('1.00 × 2.00 × 0.00 in');
  });

  it('面积', () => {
    expect(formatArea(645.16, 'inch')).toBe('1.00 in²');
    expect(formatArea(100, 'cm')).toBe('1.00 cm²');
    expect(formatArea(100, 'mm')).toBe('100.0 mm²');
  });

  it('体积', () => {
    expect(formatVolume(1000, 'mm')).toBe('1.00 cm³');
    expect(formatVolume(1000, 'cm')).toBe('1.00 cm³');
    expect(formatVolume(16387.064, 'inch')).toBe('1.00 in³');
  });

  it('formatNumber 和 isDisplayUnit', () => {
    expect(formatNumber(2.4349, 2)).toBe('2.43');
    expect(isDisplayUnit('inch')).toBe(true);
    expect(isDisplayUnit('m')).toBe(false);
    expect(isDisplayUnit(null)).toBe(false);
  });
});

describe('suggestUnit', () => {
  it('按毫米理解太小或太大时提示', () => {
    expect(suggestUnit(0.05)).toBe('m');
    expect(suggestUnit(2.43)).toBe('inch');
    expect(suggestUnit(60)).toBe(null);
    expect(suggestUnit(60000)).toBe('um');
  });
});
