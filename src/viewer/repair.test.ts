import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { checkMesh, computeSignedVolume, toTriangleArray } from './geometry';
import { repairMesh, toBinarySTL } from './repair';

function loadSample(name: string) {
  const buf = readFileSync(new URL(`../../public/samples/${name}`, import.meta.url));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return toTriangleArray(new STLLoader().parse(ab));
}

function box(w: number, h: number, d: number, offset = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(offset, offset, offset);
  return toTriangleArray(g);
}

/** 把第 t 个三角形的方向反过来 */
function flipTriangle(tris: Float64Array, t: number) {
  const i = t * 9;
  for (let k = 0; k < 3; k++) [tris[i + 3 + k], tris[i + 6 + k]] = [tris[i + 6 + k], tris[i + 3 + k]];
}

function concat(...parts: ArrayLike<number>[]) {
  const out = new Float64Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

describe('repairMesh', () => {
  it('leaves a clean closed mesh unchanged', () => {
    const { tris, report } = repairMesh(box(20, 10, 30));
    expect(report).toMatchObject({
      weldedVertices: 8,
      removedDegenerate: 0,
      removedDuplicate: 0,
      flippedTriangles: 0,
      filledHoles: 0,
      addedTriangles: 0,
    });
    expect(computeSignedVolume(tris)).toBeCloseTo(6000, 3);
  });

  it('welds vertices that differ by less than the tolerance', () => {
    const t = box(10, 10, 10);
    for (let i = 0; i < t.length; i++) t[i] += (i % 7) * 1e-6; // 导出精度造成的微小误差
    expect(checkMesh(t, 1e-7).watertight).toBe(false);
    const { tris, report } = repairMesh(t);
    expect(report.weldedVertices).toBe(8);
    expect(checkMesh(tris).watertight).toBe(true);
  });

  it('removes degenerate and duplicate triangles', () => {
    const t = box(10, 10, 10);
    const degenerate = [0, 0, 0, 0, 0, 0, 1, 1, 1];
    const { tris, report } = repairMesh(concat(t, t.slice(0, 9), degenerate));
    expect(report.removedDegenerate).toBe(1);
    expect(report.removedDuplicate).toBe(1);
    expect(tris.length / 9).toBe(12);
    expect(checkMesh(tris).watertight).toBe(true);
  });

  it('flips a single inverted triangle back', () => {
    const t = box(10, 10, 10);
    flipTriangle(t, 5);
    const { tris, report } = repairMesh(t);
    expect(report.flippedTriangles).toBe(1);
    expect(computeSignedVolume(tris)).toBeCloseTo(1000, 3);
  });

  it('turns an inside-out model the right way round', () => {
    const t = box(10, 10, 10);
    for (let i = 0; i < 12; i++) flipTriangle(t, i);
    expect(computeSignedVolume(t)).toBeCloseTo(-1000, 3);
    const { tris, report } = repairMesh(t);
    expect(report.flippedTriangles).toBe(12);
    expect(computeSignedVolume(tris)).toBeCloseTo(1000, 3);
  });

  it('keeps the inner wall of a hollow box facing into the cavity', () => {
    const outer = box(20, 20, 20);
    const inner = box(10, 10, 10);
    for (let i = 0; i < 12; i++) flipTriangle(inner, i); // 空腔的法线朝里（指向空腔）
    const { tris, report } = repairMesh(concat(outer, inner));
    expect(report.flippedTriangles).toBe(0);
    expect(computeSignedVolume(tris)).toBeCloseTo(8000 - 1000, 3);
  });

  it('fills a small hole so the mesh becomes watertight with the same volume', () => {
    const t = box(20, 10, 30);
    // 去掉一个面（两个三角形），留下一个 4 条边的方洞
    const holed = concat(t.slice(0, 2 * 9), t.slice(4 * 9));
    expect(checkMesh(holed).openEdges).toBe(4);
    const { tris, report } = repairMesh(holed);
    expect(report.filledHoles).toBe(1);
    expect(report.addedTriangles).toBe(4);
    expect(checkMesh(tris).watertight).toBe(true);
    expect(computeSignedVolume(tris)).toBeCloseTo(6000, 3);
  });

  it('fills a triangular hole with one triangle', () => {
    const { tris, report } = repairMesh(box(10, 10, 10).slice(9));
    expect(report).toMatchObject({ filledHoles: 1, addedTriangles: 1 });
    expect(checkMesh(tris).watertight).toBe(true);
  });

  it('leaves holes larger than the limit open', () => {
    const t = box(10, 10, 10);
    const holed = concat(t.slice(0, 2 * 9), t.slice(4 * 9));
    const { report } = repairMesh(holed, { maxHoleEdges: 3 });
    expect(report).toMatchObject({ filledHoles: 0, skippedHoles: 1 });
  });

  it('does not try to close the large open top of the sample vase', () => {
    const vase = loadSample('vase.stl');
    const { tris, report } = repairMesh(vase);
    expect(report.skippedHoles).toBeGreaterThan(0);
    expect(tris.length).toBe(vase.length);
  });

  it('does not change real printer parts that are already clean', () => {
    const part = loadSample('prusa-fan-shroud.stl');
    const { tris, report } = repairMesh(part);
    expect(report.flippedTriangles).toBe(0);
    expect(report.addedTriangles).toBe(0);
    expect(computeSignedVolume(tris)).toBeCloseTo(computeSignedVolume(part), 0);
  });
});

describe('toBinarySTL', () => {
  it('writes a file that STLLoader reads back with the same triangles', () => {
    const t = box(20, 10, 30);
    const buffer = toBinarySTL(t, 'solid test');
    expect(buffer.byteLength).toBe(84 + 12 * 50);
    // 文件头不能以 solid 开头，否则可能被当成 ASCII STL
    expect(new TextDecoder().decode(buffer.slice(0, 5))).not.toBe('solid');
    const back = toTriangleArray(new STLLoader().parse(buffer));
    expect(back.length).toBe(t.length);
    for (let i = 0; i < t.length; i++) expect(back[i]).toBeCloseTo(t[i], 5);
  });
});

describe('repairMesh on the sample teapot', () => {
  it('closes the open patches without turning intersecting parts inside out', () => {
    const teapot = loadSample('teapot.stl');
    expect(checkMesh(teapot).watertight).toBe(false);
    const { tris, report } = repairMesh(teapot);
    expect(report.flippedTriangles).toBe(0);
    expect(report.filledHoles).toBeGreaterThan(0);
    expect(checkMesh(tris).watertight).toBe(true);
    expect(computeSignedVolume(tris)).toBeGreaterThan(0);
  });
});
