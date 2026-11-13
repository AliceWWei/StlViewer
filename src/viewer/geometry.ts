/**
 * 纯几何计算：不依赖 React、不依赖渲染，只处理三角形数据，方便单元测试。
 *
 * 所有函数都接收“三角形顶点数组”：每 9 个数字是一个三角形
 * [x0,y0,z0, x1,y1,z1, x2,y2,z2, ...]，单位和文件一致（STL 通常是 mm）。
 */
import type * as THREE from 'three';

export type Vec3 = [number, number, number];

/** 把 BufferGeometry（有索引或无索引）展开成三角形顶点数组 */
export function toTriangleArray(geometry: THREE.BufferGeometry): Float64Array {
  const pos = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const count = index ? index.count : pos.count;
  const out = new Float64Array(count * 3);
  for (let i = 0; i < count; i++) {
    const v = index ? index.getX(i) : i;
    out[i * 3] = pos.getX(v);
    out[i * 3 + 1] = pos.getY(v);
    out[i * 3 + 2] = pos.getZ(v);
  }
  return out;
}

export function triangleCount(tris: ArrayLike<number>): number {
  return Math.floor(tris.length / 9);
}

export interface Bounds {
  min: Vec3;
  max: Vec3;
  size: Vec3;
}

export function computeBounds(tris: ArrayLike<number>): Bounds {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tris.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = tris[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

/**
 * 有符号四面体法求体积。
 * 每个三角形和参考点 O 组成一个四面体，体积 = (a·(b×c))/6（a、b、c 是三个顶点减去 O）。
 * 三角形朝外时为正、朝内时为负，对封闭网格求和后，模型外面的部分正负抵消，剩下的就是真实体积。
 * 参考点取包围盒中心：数学上取任意点结果都一样，但坐标离原点很远时，
 * 先减去中心能减小浮点误差。
 */
export function computeSignedVolume(tris: ArrayLike<number>): number {
  const { min, max } = computeBounds(tris);
  const ox = (min[0] + max[0]) / 2;
  const oy = (min[1] + max[1]) / 2;
  const oz = (min[2] + max[2]) / 2;
  let sum = 0;
  for (let i = 0; i + 8 < tris.length; i += 9) {
    const ax = tris[i] - ox, ay = tris[i + 1] - oy, az = tris[i + 2] - oz;
    const bx = tris[i + 3] - ox, by = tris[i + 4] - oy, bz = tris[i + 5] - oz;
    const cx = tris[i + 6] - ox, cy = tris[i + 7] - oy, cz = tris[i + 8] - oz;
    // a · (b × c)
    sum += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
  }
  return sum / 6;
}

/** 表面积 = 每个三角形 |AB × AC| / 2 之和 */
export function computeSurfaceArea(tris: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i + 8 < tris.length; i += 9) {
    const [nx, ny, nz] = crossOfTriangle(tris, i);
    sum += Math.hypot(nx, ny, nz) / 2;
  }
  return sum;
}

function crossOfTriangle(tris: ArrayLike<number>, i: number): Vec3 {
  const abx = tris[i + 3] - tris[i], aby = tris[i + 4] - tris[i + 1], abz = tris[i + 5] - tris[i + 2];
  const acx = tris[i + 6] - tris[i], acy = tris[i + 7] - tris[i + 1], acz = tris[i + 8] - tris[i + 2];
  return [aby * acz - abz * acy, abz * acx - abx * acz, abx * acy - aby * acx];
}

export interface MeshCheck {
  /** 只被 1 个三角形用到的边：说明表面有破洞 */
  openEdges: number;
  /** 被 3 个以上三角形共用的边：非流形，切片软件无法判断内外 */
  nonManifoldEdges: number;
  /** 面积几乎为 0 的三角形 */
  degenerateTriangles: number;
  /** 封闭（水密）：每条边恰好被两个三角形共用 */
  watertight: boolean;
}

/**
 * 网格健康检查。
 * STL 里每个三角形各自存一份顶点，相邻三角形的“同一个点”其实是重复存了好几次，
 * 所以先按坐标把相同的点合并（焊接），再统计每条边被几个三角形用到。
 */
export function checkMesh(tris: ArrayLike<number>, tolerance = 1e-4): MeshCheck {
  const ids = new Map<string, number>();
  const vertexId = (i: number) => {
    const key = `${Math.round(tris[i] / tolerance)},${Math.round(tris[i + 1] / tolerance)},${Math.round(tris[i + 2] / tolerance)}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = ids.size;
      ids.set(key, id);
    }
    return id;
  };

  const edgeCount = new Map<number, number>();
  const BIG = 2 ** 26; // 顶点编号上限，用来把一对编号拼成一个数字当 key
  let degenerateTriangles = 0;

  for (let i = 0; i + 8 < tris.length; i += 9) {
    const a = vertexId(i), b = vertexId(i + 3), c = vertexId(i + 6);
    if (a === b || b === c || a === c) {
      degenerateTriangles++;
      continue;
    }
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const key = Math.min(p, q) * BIG + Math.max(p, q);
      edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1);
    }
  }

  let openEdges = 0;
  let nonManifoldEdges = 0;
  for (const n of edgeCount.values()) {
    if (n === 1) openEdges++;
    else if (n > 2) nonManifoldEdges++;
  }
  return {
    openEdges,
    nonManifoldEdges,
    degenerateTriangles,
    watertight: openEdges === 0 && nonManifoldEdges === 0,
  };
}

/**
 * 悬垂面积：需要支撑的表面面积。
 * 一个面需要支撑，当它朝下、并且和竖直方向的夹角超过 maxAngleDeg（常用 45°）。
 * 用法线判断：设 down 为竖直向下的单位向量，n 为面的单位法线，
 * 竖直的墙 n·down = 0，完全朝下的天花板 n·down = 1，
 * 所以条件是 n·down > sin(maxAngleDeg)。
 * 贴在打印平台上的底面有平台托着，不算。
 */
export function computeOverhangArea(
  tris: ArrayLike<number>,
  maxAngleDeg = 45,
  up: Vec3 = [0, 0, 1],
  bedTolerance = 0.05,
): number {
  const threshold = Math.sin((maxAngleDeg * Math.PI) / 180);
  let bedHeight = Infinity;
  for (let i = 0; i < tris.length; i += 3) {
    bedHeight = Math.min(bedHeight, tris[i] * up[0] + tris[i + 1] * up[1] + tris[i + 2] * up[2]);
  }

  let area = 0;
  for (let i = 0; i + 8 < tris.length; i += 9) {
    const [nx, ny, nz] = crossOfTriangle(tris, i);
    const len = Math.hypot(nx, ny, nz);
    if (len === 0) continue;
    const downDot = -(nx * up[0] + ny * up[1] + nz * up[2]) / len;
    if (downDot <= threshold) continue;

    const h = (k: number) => tris[k] * up[0] + tris[k + 1] * up[1] + tris[k + 2] * up[2];
    const onBed = Math.max(h(i), h(i + 3), h(i + 6)) - bedHeight < bedTolerance;
    if (!onBed) area += len / 2;
  }
  return area;
}

export interface Material {
  name: string;
  density: number; // g/cm³
}

export const MATERIALS: Material[] = [
  { name: 'PLA', density: 1.24 },
  { name: 'PETG', density: 1.27 },
  { name: 'ABS', density: 1.04 },
];

/**
 * 粗略估算打印用料（克）。切片软件会生成外墙和内部填充，这里用一个简化模型：
 * 外壳体积 ≈ 表面积 × 壁厚，内部体积 ≈ (总体积 − 外壳) × 填充率。
 * 输入单位是 mm 和 mm³。
 */
export function estimateMaterialGrams(
  volumeMm3: number,
  areaMm2: number,
  density: number,
  { wallMm = 0.8, infill = 0.2 } = {},
): number {
  const volume = Math.abs(volumeMm3);
  const shell = Math.min(volume, areaMm2 * wallMm);
  const inner = (volume - shell) * infill;
  return ((shell + inner) / 1000) * density; // mm³ → cm³ → g
}

export interface Printer {
  name: string;
  build: Vec3; // X × Y × Z（mm），Z 是高度
}

export const PRINTERS: Printer[] = [
  { name: 'Stratasys F170', build: [254, 254, 254] },
  { name: 'Stratasys F370', build: [355, 254, 355] },
  { name: 'Prusa MK4', build: [250, 210, 220] },
  { name: 'Bambu Lab X1C', build: [256, 256, 256] },
  { name: 'Creality Ender-3', build: [220, 220, 250] },
];

export interface FitResult {
  fits: boolean;
  /** 模型绕竖直轴转 90° 后能放下 */
  needsRotation: boolean;
  /** 每个方向超出多少 mm（不超出为 0） */
  overflow: Vec3;
}

/** 检查模型包围盒能否放进打印机成型空间（允许在平台上转 90°） */
export function checkFit(size: Vec3, build: Vec3): FitResult {
  const over = (s: Vec3): Vec3 => [
    Math.max(0, s[0] - build[0]),
    Math.max(0, s[1] - build[1]),
    Math.max(0, s[2] - build[2]),
  ];
  const ok = (o: Vec3) => o[0] === 0 && o[1] === 0 && o[2] === 0;
  const straight = over(size);
  if (ok(straight)) return { fits: true, needsRotation: false, overflow: straight };
  const rotated = over([size[1], size[0], size[2]]);
  if (ok(rotated)) return { fits: true, needsRotation: true, overflow: rotated };
  return { fits: false, needsRotation: false, overflow: straight };
}
