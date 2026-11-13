import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import {
  checkFit,
  checkMesh,
  computeBounds,
  computeOverhangArea,
  computeSignedVolume,
  computeSurfaceArea,
  estimateMaterialGrams,
  toTriangleArray,
  triangleCount,
} from './geometry';

function loadSample(name: string) {
  const buf = readFileSync(new URL(`../../public/samples/${name}`, import.meta.url));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return toTriangleArray(new STLLoader().parse(ab));
}

/** 把每个三角形的第 2、3 个顶点交换，三角形朝向就反过来了 */
function flip(tris: Float64Array) {
  const out = tris.slice();
  for (let i = 0; i < out.length; i += 9) {
    for (let k = 0; k < 3; k++) {
      [out[i + 3 + k], out[i + 6 + k]] = [out[i + 6 + k], out[i + 3 + k]];
    }
  }
  return out;
}

function box(w: number, h: number, d: number) {
  return toTriangleArray(new THREE.BoxGeometry(w, h, d));
}

describe('volume', () => {
  it('20×10×30 sample box is exactly 6000 mm³', () => {
    expect(computeSignedVolume(loadSample('box.stl'))).toBeCloseTo(6000, 6);
  });

  it('is negative when every triangle is flipped (inside-out mesh)', () => {
    expect(computeSignedVolume(flip(loadSample('box.stl')))).toBeCloseTo(-6000, 6);
  });

  it('works for indexed geometry (unit cube)', () => {
    expect(computeSignedVolume(box(1, 1, 1))).toBeCloseTo(1, 10);
  });

  it('does not change when the model is rotated or moved far from the origin', () => {
    const g = new THREE.BoxGeometry(20, 10, 30);
    g.rotateZ(0.7);
    g.rotateX(1.1);
    // 平移在 Float64 里做：BufferGeometry 用 Float32 存坐标，在 3e5 这种量级上
    // 精度只有约 0.03 mm，误差来自存储而不是算法
    const tris = toTriangleArray(g);
    for (let i = 0; i < tris.length; i += 3) {
      tris[i] += 1e5;
      tris[i + 1] -= 2e5;
      tris[i + 2] += 3e5;
    }
    expect(computeSignedVolume(tris)).toBeCloseTo(6000, 2);
  });

  it('approximates a sphere', () => {
    const r = 10;
    const v = computeSignedVolume(toTriangleArray(new THREE.SphereGeometry(r, 128, 64)));
    expect(v / ((4 / 3) * Math.PI * r ** 3)).toBeCloseTo(1, 2);
  });
});

describe('surface area', () => {
  it('box 20×10×30 is 2·(200 + 300 + 600) = 2200 mm²', () => {
    expect(computeSurfaceArea(loadSample('box.stl'))).toBeCloseTo(2200, 6);
  });
});

describe('bounds', () => {
  it('measures the sample box', () => {
    const b = computeBounds(loadSample('box.stl'));
    expect(b.size).toEqual([20, 10, 30]);
  });
});

describe('mesh check', () => {
  it('a closed box is watertight', () => {
    const r = checkMesh(box(10, 10, 10));
    expect(r).toEqual({ openEdges: 0, nonManifoldEdges: 0, degenerateTriangles: 0, watertight: true });
  });

  it('removing one triangle leaves 3 open edges', () => {
    const tris = loadSample('box.stl').slice(9);
    expect(triangleCount(tris)).toBe(11);
    const r = checkMesh(tris);
    expect(r.openEdges).toBe(3);
    expect(r.watertight).toBe(false);
  });

  it('a single surface with no thickness (the vase) is not watertight', () => {
    expect(checkMesh(loadSample('vase.stl')).watertight).toBe(false);
  });

  it('detects a non-manifold edge shared by three triangles', () => {
    const tris = new Float64Array([
      0, 0, 0, 1, 0, 0, 0, 1, 0,
      1, 0, 0, 0, 0, 0, 0, -1, 0,
      0, 0, 0, 1, 0, 0, 0, 0, 1,
    ]);
    expect(checkMesh(tris).nonManifoldEdges).toBe(1);
  });

  it('counts degenerate (zero-area) triangles', () => {
    const tris = new Float64Array([0, 0, 0, 0, 0, 0, 1, 0, 0]);
    expect(checkMesh(tris).degenerateTriangles).toBe(1);
  });
});

describe('overhang area', () => {
  it('a box resting on the bed needs no support', () => {
    const g = new THREE.BoxGeometry(20, 10, 30);
    g.translate(0, 0, 15);
    expect(computeOverhangArea(toTriangleArray(g))).toBeCloseTo(0, 6);
  });

  it('the downward face of a raised floating plate is an overhang', () => {
    // 一块 10×10 的板，朝下，离平台 5 mm，下面再放一个小立柱当作“最低点”
    const plate = new THREE.PlaneGeometry(10, 10);
    plate.rotateX(Math.PI); // 法线朝 -Z
    plate.translate(0, 0, 5);
    const post = new THREE.BoxGeometry(1, 1, 5);
    post.translate(20, 0, 2.5);
    const tris = new Float64Array([...toTriangleArray(plate), ...toTriangleArray(post)]);
    expect(computeOverhangArea(tris)).toBeCloseTo(100, 6);
  });

  it('a 30° slope (from vertical) is fine, a 60° slope needs support', () => {
    const slope = (deg: number) => {
      // 一个朝下的斜面：法线与竖直向下方向的夹角 = 90° − deg
      const g = new THREE.PlaneGeometry(10, 10);
      g.rotateX(Math.PI); // 朝下
      g.rotateX(((90 - deg) * Math.PI) / 180);
      g.translate(0, 0, 50);
      const anchor = new THREE.BoxGeometry(1, 1, 1);
      anchor.translate(100, 0, 0.5);
      return new Float64Array([...toTriangleArray(g), ...toTriangleArray(anchor)]);
    };
    expect(computeOverhangArea(slope(30))).toBeCloseTo(0, 6);
    expect(computeOverhangArea(slope(60))).toBeCloseTo(100, 3);
  });
});

describe('material estimate', () => {
  it('a solid-ish small cube is mostly shell', () => {
    // 10 mm 立方体：体积 1000 mm³，表面积 600 mm²，外壳 480 mm³，内部 520 × 20% = 104
    expect(estimateMaterialGrams(1000, 600, 1.24)).toBeCloseTo(((480 + 104) / 1000) * 1.24, 6);
  });

  it('never exceeds a fully solid part', () => {
    expect(estimateMaterialGrams(100, 10000, 1)).toBeCloseTo(0.1, 6);
  });
});

describe('printer fit', () => {
  it('fits directly', () => {
    expect(checkFit([100, 100, 100], [200, 200, 200]).fits).toBe(true);
  });

  it('fits after rotating 90° on the bed', () => {
    expect(checkFit([240, 200, 100], [210, 250, 220])).toEqual({
      fits: true,
      needsRotation: true,
      overflow: [0, 0, 0],
    });
  });

  it('reports how much it is too tall', () => {
    const r = checkFit([100, 100, 300], [250, 210, 220]);
    expect(r.fits).toBe(false);
    expect(r.overflow).toEqual([0, 0, 80]);
  });
});

describe('3DBenchy (real-world model)', () => {
  it('is watertight with a plausible volume', () => {
    const tris = loadSample('3DBenchy.stl');
    expect(triangleCount(tris)).toBe(225706);
    expect(checkMesh(tris).watertight).toBe(true);
    const v = computeSignedVolume(tris);
    expect(v).toBeGreaterThan(10_000);
    expect(v).toBeLessThan(30_000);
  });
});
