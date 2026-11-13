import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { toTriangleArray } from './geometry';
import { buildAdjacency, findFacePatch, isFacingDown } from './orient';

const box = () => toTriangleArray(new THREE.BoxGeometry(20, 10, 30));

function loadSample(name: string) {
  const buf = readFileSync(new URL(`../../public/samples/${name}`, import.meta.url));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return toTriangleArray(new STLLoader().parse(ab));
}

/** 找一个法线最接近 dir 的三角形 */
function triangleFacing(tris: Float64Array, dir: [number, number, number]) {
  let best = -1, bestDot = -Infinity;
  for (let t = 0; t < tris.length / 9; t++) {
    const i = t * 9;
    const a = new THREE.Vector3(tris[i], tris[i + 1], tris[i + 2]);
    const b = new THREE.Vector3(tris[i + 3], tris[i + 4], tris[i + 5]);
    const c = new THREE.Vector3(tris[i + 6], tris[i + 7], tris[i + 8]);
    const n = b.sub(a).cross(c.sub(a)).normalize();
    const d = n.dot(new THREE.Vector3(...dir));
    if (d > bestDot) { bestDot = d; best = t; }
  }
  return best;
}

describe('buildAdjacency', () => {
  it('长方体每个三角形有 3 个邻居', () => {
    const adj = buildAdjacency(box());
    for (let t = 0; t < 12; t++) expect(adj.offsets[t + 1] - adj.offsets[t]).toBe(3);
  });
});

describe('findFacePatch', () => {
  it('长方体的一个面由 2 个三角形组成，法线就是这个面的朝向', () => {
    const tris = box();
    const start = triangleFacing(tris, [0, -1, 0]);
    const patch = findFacePatch(tris, buildAdjacency(tris), start);
    expect(patch.triangles.length).toBe(2);
    expect(patch.area).toBeCloseTo(20 * 30);
    expect(patch.normal[1]).toBeCloseTo(-1);
  });

  it('flip 时法线反过来', () => {
    const tris = box();
    const start = triangleFacing(tris, [0, -1, 0]);
    const patch = findFacePatch(tris, buildAdjacency(tris), start, 12, true);
    expect(patch.normal[1]).toBeCloseTo(1);
  });

  it('曲面上取一片的平均朝向：球面上点一个三角形，平均法线指向这一片的中心', () => {
    const tris = toTriangleArray(new THREE.SphereGeometry(10, 64, 32));
    const start = triangleFacing(tris, [0.3, -0.9, 0.3]);
    const patch = findFacePatch(tris, buildAdjacency(tris), start, 15);
    expect(patch.triangles.length).toBeGreaterThan(10);
    const len = Math.hypot(...patch.normal);
    expect(len).toBeCloseTo(1);
  });

  it('Benchy 的船底是一大片平面，已经朝下', () => {
    const tris = loadSample('3DBenchy.stl');
    const start = triangleFacing(tris, [0, 0, -1]);
    const patch = findFacePatch(tris, buildAdjacency(tris), start);
    // 船底平面一共约 448 mm²，被船底刻字分成了几块，点到的这一块也有两百多 mm²
    expect(patch.area).toBeGreaterThan(100);
    expect(patch.triangles.length).toBeGreaterThan(10);
    expect(isFacingDown(patch.normal)).toBe(true);
  });
});

describe('isFacingDown', () => {
  it('判断是否已经朝正下方', () => {
    expect(isFacingDown([0, 0, -1])).toBe(true);
    expect(isFacingDown([0, 0.1, -1])).toBe(false);
    expect(isFacingDown([0, 0, 1])).toBe(false);
  });
});
