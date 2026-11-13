import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { toTriangleArray } from './geometry';
import { intersectPlane, layerCount, pointInPolygon, polygonArea, sliceAt } from './slice';

const tri = (g: THREE.BufferGeometry) => toTriangleArray(g);

describe('slice', () => {
  it('a 20×10×30 box sliced in the middle is one 20×10 rectangle', () => {
    const g = new THREE.BoxGeometry(20, 10, 30);
    const r = sliceAt(tri(g), 3.3);
    expect(r.contours).toHaveLength(1);
    expect(r.contours[0].closed).toBe(true);
    expect(r.area).toBeCloseTo(200, 6);
  });

  it('a sphere slice through the centre is close to a circle of radius r', () => {
    const r = sliceAt(tri(new THREE.SphereGeometry(10, 128, 64)), 0.01);
    expect(r.contours).toHaveLength(1);
    expect(r.area / (Math.PI * 100)).toBeCloseTo(1, 2);
  });

  it('a plane exactly through a ring of vertices still gives a closed loop', () => {
    // SphereGeometry 有一圈顶点正好在 z = 0（转过来之后），测试“顶点落在平面上”的情况
    const g = new THREE.SphereGeometry(10, 32, 16);
    g.rotateX(Math.PI / 2);
    const r = sliceAt(tri(g), 0);
    expect(r.openContours).toBe(0);
    expect(r.contours).toHaveLength(1);
  });

  it('a tube (hollow cylinder) gives an outer contour and a hole', () => {
    const shape = new THREE.Shape().absarc(0, 0, 10, 0, Math.PI * 2, false);
    shape.holes.push(new THREE.Path().absarc(0, 0, 6, 0, Math.PI * 2, true));
    const g = new THREE.ExtrudeGeometry(shape, { depth: 20, bevelEnabled: false, curveSegments: 128 });
    const r = sliceAt(tri(g), 10);
    expect(r.contours).toHaveLength(2);
    expect(r.contours.map((c) => c.depth).sort()).toEqual([0, 1]);
    expect(r.area / (Math.PI * (100 - 36))).toBeCloseTo(1, 2);
  });

  it('two separate boxes give two outer contours', () => {
    const a = new THREE.BoxGeometry(10, 10, 10);
    const b = new THREE.BoxGeometry(10, 10, 10);
    b.translate(30, 0, 0);
    const r = sliceAt(new Float64Array([...tri(a), ...tri(b)]), 0.5);
    expect(r.contours.map((c) => c.depth)).toEqual([0, 0]);
    expect(r.area).toBeCloseTo(200, 6);
  });

  it('a mesh with a hole gives an open contour', () => {
    const tris = tri(new THREE.BoxGeometry(10, 10, 10));
    // 删掉一个侧面的两个三角形（BoxGeometry 的第一个面是 +X 面）
    const r = sliceAt(tris.slice(18), 0.5);
    expect(r.openContours).toBe(1);
  });

  it('above or below the model gives nothing', () => {
    expect(intersectPlane(tri(new THREE.BoxGeometry(1, 1, 1)), 5)).toHaveLength(0);
  });
});

describe('polygon helpers', () => {
  const square: [number, number][] = [[0, 0], [2, 0], [2, 2], [0, 2]];
  it('shoelace area is signed by winding', () => {
    expect(polygonArea(square)).toBe(4);
    expect(polygonArea([...square].reverse())).toBe(-4);
  });
  it('point in polygon', () => {
    expect(pointInPolygon([1, 1], square)).toBe(true);
    expect(pointInPolygon([3, 1], square)).toBe(false);
  });
  it('layer count', () => {
    expect(layerCount(48, 0.2)).toBe(240);
    expect(layerCount(0.05, 0.2)).toBe(1);
  });
});

import { suggestUnit } from './units';
describe('unit suggestion', () => {
  it('flags tiny and huge models', () => {
    expect(suggestUnit(2.4)).toBe('inch');
    expect(suggestUnit(0.06)).toBe('m');
    expect(suggestUnit(60)).toBeNull();
    expect(suggestUnit(60000)).toBe('um');
  });
});
