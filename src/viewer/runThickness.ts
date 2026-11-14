/**
 * 启动一次壁厚计算：优先用 Web Worker，创建失败（比如某些 file:// 环境）时退回主线程。
 * 返回取消函数：换模型或关掉分析时调用，旧的计算结果不会再回来。
 */
import { computeThickness } from './thickness';
import type { ThicknessMessage, ThicknessRequest } from './thickness.worker';

export function runThickness(
  tris: Float64Array,
  maxDistance: number,
  onProgress: (fraction: number) => void,
  onDone: (thickness: Float32Array) => void,
): () => void {
  let cancelled = false;
  let worker: Worker | null = null;
  try {
    worker = new Worker(new URL('./thickness.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    worker = null;
  }

  if (worker) {
    const w = worker;
    w.onmessage = (e: MessageEvent<ThicknessMessage>) => {
      if (cancelled) return;
      if (e.data.type === 'progress') onProgress(e.data.done / e.data.total);
      else {
        onDone(e.data.thickness);
        w.terminate();
      }
    };
    w.onerror = (e) => {
      // Worker 脚本加载失败：退回主线程
      e.preventDefault();
      w.terminate();
      if (!cancelled) fallback();
    };
    // 复制一份再转移，调用方的数组还要继续用
    const copy = tris.slice();
    w.postMessage({ tris: copy, maxDistance } satisfies ThicknessRequest, [copy.buffer]);
    return () => {
      cancelled = true;
      w.terminate();
    };
  }

  fallback();
  return () => {
    cancelled = true;
  };

  function fallback() {
    // 让界面先刷新出“分析中”，再开始算
    setTimeout(() => {
      if (cancelled) return;
      const result = computeThickness(tris, { maxDistance });
      if (!cancelled) onDone(result);
    }, 30);
  }
}
