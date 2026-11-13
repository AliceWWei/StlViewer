import { useEffect, useRef } from 'react';
import type { Bounds } from '../viewer/geometry';
import type { Contour } from '../viewer/slice';

interface Props {
  contours: Contour[];
  bounds: Bounds;
  size?: number;
}

/**
 * 俯视的 2D 截面图。用 Canvas 的 even-odd 填充规则：
 * 一个点被奇数层轮廓包住就填色，偶数层就不填，所以孔会自动留空。
 * 按整个模型的 XY 范围缩放，拖动滑块时截面不会忽大忽小。
 */
export function SliceCanvas({ contours, bounds, size = 248 }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    const pad = 10;
    const [w, h] = [bounds.size[0] || 1, bounds.size[1] || 1];
    const scale = (size - pad * 2) / Math.max(w, h);
    const ox = pad + (size - pad * 2 - w * scale) / 2;
    const oy = pad + (size - pad * 2 - h * scale) / 2;
    // 文件坐标 Y 朝上，Canvas 的 y 朝下，所以要翻转
    const tx = (x: number) => ox + (x - bounds.min[0]) * scale;
    const ty = (y: number) => size - (oy + (y - bounds.min[1]) * scale);

    // 模型 XY 范围的虚线框，作为参照
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = '#3a3d45';
    ctx.strokeRect(tx(bounds.min[0]), ty(bounds.max[1]), w * scale, h * scale);
    ctx.setLineDash([]);

    const closed = contours.filter((c) => c.closed);
    ctx.beginPath();
    for (const c of closed) {
      c.points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(tx(x), ty(y)) : ctx.lineTo(tx(x), ty(y))));
      ctx.closePath();
    }
    ctx.fillStyle = 'rgba(240, 138, 60, 0.85)';
    ctx.fill('evenodd');
    ctx.strokeStyle = '#ffe0b0';
    ctx.lineWidth = 1;
    ctx.stroke();

    // 没闭合的轮廓（网格有破洞）画成红色
    ctx.strokeStyle = '#ff3b30';
    ctx.lineWidth = 2;
    for (const c of contours.filter((c) => !c.closed)) {
      ctx.beginPath();
      c.points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(tx(x), ty(y)) : ctx.lineTo(tx(x), ty(y))));
      ctx.stroke();
    }
  }, [contours, bounds, size]);

  return <canvas ref={ref} className="slice-canvas" style={{ width: size, height: size }} />;
}
