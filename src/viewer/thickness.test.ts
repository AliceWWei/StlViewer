import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { toTriangleArray } from './geometry';
import { computeThickness, summarizeThickness, thicknessColor } from './thickness';

function loadSample(name: string) {
  const buf = readFileSync(new URL(`../../public/samples/${name}`, import.meta.url));
  return toTriangleArray(new STLLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));
}

function box(w: number, h: number, d: number, x = 0, y = 0, z = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return toTriangleArray(g);
}

function flipAll(t: Float64Array) {
  for (let i = 0; i < t.length; i += 9) {
    for (let k = 0; k < 3; k++) [t[i + 3 + k], t[i + 6 + k]] = [t[i + 6 + k], t[i + 3 + k]];
  }
  return t;
}

function concat(...parts: Float64Array[]) {
  const out = new Float64Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** 三角形法线（不归一化）的哪个分量最大 */
function faceAxis(t: ArrayLike<number>, f: number) {
  const i = f * 9;
  const e1 = [t[i + 3] - t[i], t[i + 4] - t[i + 1], t[i + 5] - t[i + 2]];
  const e2 = [t[i + 6] - t[i], t[i + 7] - t[i + 1], t[i + 8] - t[i + 2]];
  const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]].map(Math.abs);
  return n.indexOf(Math.max(...n));
}

describe('computeThickness', () => {
  it('measures a 2 mm plate as 2 mm on its large faces', () => {
    const plate = box(40, 40, 2);
    const th = computeThickness(plate);
    for (let f = 0; f < th.length; f++) {
      if (faceAxis(plate, f) === 2) expect(th[f]).toBeCloseTo(2, 5);
    }
  });

  it('measures every wall of a hollow box, inside and out', () => {
    // 外面 20 mm 的立方体，里面挖掉 16 mm 的空腔：四面八方的墙都是 2 mm
    const hollow = concat(box(20, 20, 20), flipAll(box(16, 16, 16)));
    const th = computeThickness(hollow);
    for (let f = 0; f < th.length; f++) expect(th[f]).toBeCloseTo(2, 5);
  });

  it('flags only the thin fin next to a thick block', () => {
    const block = box(20, 20, 10);
    const fin = box(0.5, 20, 10, 15, 0, 0); // 0.5 mm 厚的薄片，和方块分开放
    const tris = concat(block, fin);
    const th = computeThickness(tris);
    const s = summarizeThickness(tris, th, 0.8);
    expect(s.min).toBeCloseTo(0.5, 5);
    // 只有薄片的两个大面（20 × 10，各两个三角形）比 0.8 mm 薄
    expect(s.thinTriangles).toBe(4);
    expect(s.thinArea).toBeCloseTo(2 * 20 * 10, 3);
    expect(s.unmeasured).toBe(0);
  });

  it('cannot measure an open surface', () => {
    const plane = toTriangleArray(new THREE.PlaneGeometry(10, 10));
    const th = computeThickness(plane);
    expect([...th].every(Number.isNaN)).toBe(true);
    expect(summarizeThickness(plane, th, 0.8).unmeasured).toBe(2);
  });

  it('runs on Benchy in a few seconds and finds its thin features', () => {
    const benchy = loadSample('3DBenchy.stl');
    const start = performance.now();
    let progressCalls = 0;
    const th = computeThickness(benchy, { maxDistance: 10, onProgress: () => progressCalls++ });
    const seconds = (performance.now() - start) / 1000;
    const s = summarizeThickness(benchy, th, 0.8);
    console.log(`Benchy: ${seconds.toFixed(2)} s, min ${s.min.toFixed(3)} mm, thin area ${s.thinArea.toFixed(1)} mm², thin tris ${s.thinTriangles}, unmeasured ${s.unmeasured}`);
    expect(seconds).toBeLessThan(15);
    expect(progressCalls).toBeGreaterThan(10);
    // Benchy 是封闭的，几乎所有面都能测到
    expect(s.unmeasured / th.length).toBeLessThan(0.01);
    // Benchy 的船身墙大约 1.2 mm，比 0.8 mm 厚；但旗杆孔、烟囱口等处有薄的细节
    expect(s.min).toBeLessThan(0.8);
  }, 60_000);
});

describe('thicknessColor', () => {
  it('is red below the minimum, green well above it, grey when unmeasured', () => {
    expect(thicknessColor(0.5, 0.8, 'heatmap')).toEqual([0.9, 0.15, 0.12]);
    expect(thicknessColor(3, 0.8, 'heatmap').map((v) => +v.toFixed(6))).toEqual([0.2, 0.75, 0.35]);
    expect(thicknessColor(0.9, 0.8, 'passFail')).toEqual([0.2, 0.75, 0.35]);
    expect(thicknessColor(NaN, 0.8, 'heatmap')).toEqual([0.45, 0.45, 0.48]);
  });
});

describe('summarizeThickness', () => {
  it('ignores tiny slivers when reporting the thinnest spot', () => {
    // 一个大三角形 2 mm 厚，一个 0.00005 mm² 的细长三角形测出 0.01 mm
    const tris = [0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 0, 0.01, 0, 0, 0, 0.01, 0];
    const s = summarizeThickness(tris, [2, 0.01], 0.8);
    expect(s.min).toBe(2);
    expect(s.thinTriangles).toBe(1);
  });
});

describe('computeThickness with a distance cap', () => {
  it('marks thick areas as Infinity but open surfaces as unmeasured', () => {
    const thick = computeThickness(box(30, 30, 30), { maxDistance: 10 });
    expect([...thick].every((v) => v === Infinity)).toBe(true);
    // 一个单独的平面：射线射出去什么也打不到，有上限时也不能当成“很厚”
    const plane = computeThickness(toTriangleArray(new THREE.PlaneGeometry(10, 10)), { maxDistance: 1 });
    expect([...plane].every(Number.isNaN)).toBe(true);
  });

  it('gives the same thin values with and without the cap', () => {
    const part = loadSample('prusa-fan-shroud.stl');
    const a = computeThickness(part);
    const b = computeThickness(part, { maxDistance: 10 });
    for (let f = 0; f < a.length; f++) if (a[f] < 5) expect(b[f]).toBeCloseTo(a[f], 4);
  });
});
