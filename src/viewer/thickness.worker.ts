/**
 * 在后台线程里算壁厚。Benchy 要几秒钟，放在主线程会让界面卡住（不能旋转、点按钮没反应）。
 * Web Worker 有自己的线程，算完把结果发回来；三角形数组用“转移”（transfer）而不是复制，几乎不花时间。
 */
import { computeThickness } from './thickness';

export interface ThicknessRequest {
  tris: Float64Array;
  maxDistance: number;
}

export type ThicknessMessage =
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; thickness: Float32Array };

self.onmessage = (e: MessageEvent<ThicknessRequest>) => {
  const { tris, maxDistance } = e.data;
  const thickness = computeThickness(tris, {
    maxDistance,
    progressEvery: 2000,
    onProgress: (done, total) => self.postMessage({ type: 'progress', done, total } satisfies ThicknessMessage),
  });
  self.postMessage({ type: 'done', thickness } satisfies ThicknessMessage, { transfer: [thickness.buffer] });
};
