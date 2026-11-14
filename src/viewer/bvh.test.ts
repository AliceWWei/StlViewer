import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { toTriangleArray } from './geometry';
import { buildBVH, raycast, rayTriangle } from './bvh';

function loadSample(name: string) {
  const buf = readFileSync(new URL(`../../public/samples/${name}`, import.meta.url));
  return toTriangleArray(new STLLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));
}

/** 不加速，逐个三角形求交，用来核对 BVH 的结果 */
function bruteForce(tris: ArrayLike<number>, o: number[], d: number[]) {
  let best = Infinity, tri = -1;
  for (let t = 0; t < tris.length / 9; t++) {
    const dist = rayTriangle(tris, t, o[0], o[1], o[2], d[0], d[1], d[2]);
    if (dist < best) { best = dist; tri = t; }
  }
  return tri < 0 ? null : { t: best, triangle: tri };
}

/** 简单的可复现随机数，测试结果每次一样 */
function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function randomDir(r: () => number) {
  const z = r() * 2 - 1, a = r() * Math.PI * 2, s = Math.sqrt(1 - z * z);
  return [s * Math.cos(a), s * Math.sin(a), z];
}

describe('rayTriangle', () => {
  const tri = [0, 0, 0, 10, 0, 0, 0, 10, 0];
  it('hits from either side and returns the distance', () => {
    expect(rayTriangle(tri, 0, 1, 1, 5, 0, 0, -1)).toBeCloseTo(5);
    expect(rayTriangle(tri, 0, 1, 1, -3, 0, 0, 1)).toBeCloseTo(3);
  });
  it('misses outside the triangle, behind the ray, and when parallel', () => {
    expect(rayTriangle(tri, 0, 8, 8, 5, 0, 0, -1)).toBe(Infinity);
    expect(rayTriangle(tri, 0, 1, 1, 5, 0, 0, 1)).toBe(Infinity);
    expect(rayTriangle(tri, 0, 1, 1, 0, 1, 0, 0)).toBe(Infinity);
  });
});

describe('BVH raycast', () => {
  it('finds the far wall of a box from the inside', () => {
    const bvh = buildBVH(toTriangleArray(new THREE.BoxGeometry(20, 10, 30)));
    expect(raycast(bvh, [0, 0, 0], [1, 0, 0])!.t).toBeCloseTo(10);
    expect(raycast(bvh, [0, 0, 0], [0, 0, -1])!.t).toBeCloseTo(15);
    expect(raycast(bvh, [0, 0, 100], [0, 0, 1])).toBeNull();
  });

  it('respects the triangle to skip and the max distance', () => {
    const tris = toTriangleArray(new THREE.BoxGeometry(20, 10, 30));
    const bvh = buildBVH(tris);
    const hit = raycast(bvh, [0, 0, 0], [1, 0, 0])!;
    // 两个三角形组成一个面，跳过打中的那个，射线正好落在对角线上时会打中另一个
    expect(raycast(bvh, [0, 0, 0], [1, 0, 0], hit.triangle)?.triangle ?? -1).not.toBe(hit.triangle);
    expect(raycast(bvh, [0, 0, 0], [1, 0, 0], -1, 5)).toBeNull();
  });

  it('agrees with brute force on 150 random rays through Benchy', () => {
    const tris = loadSample('3DBenchy.stl');
    const bvh = buildBVH(tris);
    const r = rng(42);
    let hits = 0;
    for (let i = 0; i < 150; i++) {
      // 从包围盒里随机一点出发，往随机方向发射
      const o = [(r() - 0.5) * 60, (r() - 0.5) * 31, r() * 48];
      const d = randomDir(r);
      const a = raycast(bvh, o, d);
      const b = bruteForce(tris, o, d);
      if (b) hits++;
      expect(a === null).toBe(b === null);
      if (a && b) expect(a.t).toBeCloseTo(b.t, 6);
    }
    expect(hits).toBeGreaterThan(30); // 确实有不少射线打中了东西
  }, 60_000);

  it('is much faster than brute force', () => {
    const tris = loadSample('3DBenchy.stl');
    const bvh = buildBVH(tris);
    const r = rng(7);
    const start = performance.now();
    for (let i = 0; i < 20_000; i++) raycast(bvh, [(r() - 0.5) * 60, (r() - 0.5) * 31, r() * 48], randomDir(r));
    const perRay = (performance.now() - start) / 20_000;
    // 暴力法每条射线要检查 22 万个三角形（约几毫秒）；BVH 应该在 0.1 毫秒以内
    expect(perRay).toBeLessThan(0.1);
  });

  it('handles an empty mesh', () => {
    expect(raycast(buildBVH([]), [0, 0, 0], [1, 0, 0])).toBeNull();
  });
});
