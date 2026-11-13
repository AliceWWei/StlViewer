import { describe, expect, it } from 'vitest';
import { MESSAGES } from './i18n';

/** 把嵌套的对照表展开成 “路径 → 值” 列表，函数用示例参数调用一次得到文字 */
function flatten(obj: Record<string, unknown>, prefix = ''): [string, string][] {
  return Object.entries(obj).flatMap(([k, v]): [string, string][] => {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'function') return [[path, String(v('1', '1'))]];
    if (v && typeof v === 'object') return flatten(v as Record<string, unknown>, path);
    return [[path, String(v)]];
  });
}

describe('i18n', () => {
  const zh = flatten(MESSAGES.zh);
  const en = flatten(MESSAGES.en);

  it('中英文的 key 完全一致', () => {
    expect(en.map(([k]) => k).sort()).toEqual(zh.map(([k]) => k).sort());
  });

  it('没有空字符串', () => {
    for (const [k, v] of [...zh, ...en]) expect(v.trim(), k).not.toBe('');
  });

  it('英文里没有残留中文', () => {
    // 汉字和全角标点（，：（）“”）都不应该出现在英文里
    for (const [k, v] of en) expect(v, k).not.toMatch(/[一-鿿　-〿＀-￯“”]/);
  });
});
