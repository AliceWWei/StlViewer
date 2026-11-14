/**
 * BVH（Bounding Volume Hierarchy，包围盒层次树）：给“射线打到哪个三角形”加速。
 *
 * 不加速时，一条射线要和所有三角形逐个求交：Benchy 有 22 万个三角形，壁厚分析要发上百万条射线，
 * 总共上千亿次计算，根本算不完。
 *
 * BVH 把三角形按位置分成两堆（用 SAH 选切分位置，见下面），每堆再分两堆……每个节点记录“这一堆三角形的包围盒”。
 * 射线先和包围盒求交，打不中整个盒子就跳过里面的所有三角形，
 * 平均每条射线只需要检查几十个三角形，复杂度从 O(n) 降到大约 O(log n)。
 *
 * 数据都放在扁平的 TypedArray 里（而不是一棵对象树），内存连续、没有垃圾回收压力，
 * 也可以原样发给 Web Worker。
 */

/** 叶子节点最多放几个三角形 */
const LEAF_SIZE = 4;

export interface BVH {
  /** 三角形坐标，每 9 个数字一个三角形（和 geometry.ts 一样） */
  tris: Float64Array;
  /** 每个节点的包围盒：minX, minY, minZ, maxX, maxY, maxZ */
  bounds: Float64Array;
  /**
   * 每个节点 2 个整数。
   * 内部节点：[左孩子编号, 右孩子编号]（右孩子编号为正）
   * 叶子节点：[三角形起始位置, -三角形数量]（第二个数为负数表示叶子）
   */
  nodes: Int32Array;
  /** 叶子里的三角形编号（按节点顺序排列） */
  order: Uint32Array;
  nodeCount: number;
}

export function buildBVH(input: ArrayLike<number>): BVH {
  const tris = Float64Array.from(input);
  const n = Math.floor(tris.length / 9);
  const order = new Uint32Array(n);
  const centroids = new Float64Array(n * 3);
  // 每个三角形自己的包围盒，建树时要反复用，先算好
  const triBounds = new Float64Array(n * 6);
  for (let t = 0; t < n; t++) {
    order[t] = t;
    for (let k = 0; k < 3; k++) {
      const a = tris[t * 9 + k], b = tris[t * 9 + 3 + k], c = tris[t * 9 + 6 + k];
      centroids[t * 3 + k] = (a + b + c) / 3;
      triBounds[t * 6 + k] = Math.min(a, b, c);
      triBounds[t * 6 + 3 + k] = Math.max(a, b, c);
    }
  }

  // 节点数最多 2n - 1（每次分裂多出一个节点）
  const maxNodes = Math.max(1, 2 * n - 1);
  const bounds = new Float64Array(maxNodes * 6);
  const nodes = new Int32Array(maxNodes * 2);
  let nodeCount = 0;

  // 用栈代替递归，避免很深的树把调用栈撑爆
  const stack: [node: number, start: number, end: number][] = [];
  const newNode = () => nodeCount++;
  const root = newNode();
  stack.push([root, 0, n]);

  while (stack.length) {
    const [node, start, end] = stack.pop()!;
    // 这一堆三角形的包围盒，以及三角形中心点的包围盒（用来决定沿哪个轴切）
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    let cMin0 = Infinity, cMin1 = Infinity, cMin2 = Infinity, cMax0 = -Infinity, cMax1 = -Infinity, cMax2 = -Infinity;
    for (let i = start; i < end; i++) {
      const t = order[i];
      const o = t * 6;
      if (triBounds[o] < minX) minX = triBounds[o];
      if (triBounds[o + 1] < minY) minY = triBounds[o + 1];
      if (triBounds[o + 2] < minZ) minZ = triBounds[o + 2];
      if (triBounds[o + 3] > maxX) maxX = triBounds[o + 3];
      if (triBounds[o + 4] > maxY) maxY = triBounds[o + 4];
      if (triBounds[o + 5] > maxZ) maxZ = triBounds[o + 5];
      const cx = centroids[t * 3], cy = centroids[t * 3 + 1], cz = centroids[t * 3 + 2];
      if (cx < cMin0) cMin0 = cx; if (cx > cMax0) cMax0 = cx;
      if (cy < cMin1) cMin1 = cy; if (cy > cMax1) cMax1 = cy;
      if (cz < cMin2) cMin2 = cz; if (cz > cMax2) cMax2 = cz;
    }
    bounds.set([minX, minY, minZ, maxX, maxY, maxZ], node * 6);

    const count = end - start;
    if (count <= LEAF_SIZE) {
      nodes[node * 2] = start;
      nodes[node * 2 + 1] = -count;
      continue;
    }

    // 选切分位置：SAH（表面积启发式）。
    // 射线打中一个盒子的概率大约和盒子的表面积成正比，所以“左盒表面积 × 左边三角形数 + 右盒表面积 × 右边三角形数”
    // 越小，平均要检查的三角形越少。把每个轴按三角形中心分成 BINS 个格子，试每个格子边界作为切分位置。
    const cMin = [cMin0, cMin1, cMin2];
    const cExt = [cMax0 - cMin0, cMax1 - cMin1, cMax2 - cMin2];
    let bestAxis = -1, bestSplit = 0, bestCost = Infinity;
    for (let axis = 0; axis < 3; axis++) {
      if (cExt[axis] <= 0) continue;
      binCount.fill(0);
      binBounds.fill(Infinity);
      for (let b = 0; b < BINS; b++) for (let k = 3; k < 6; k++) binBounds[b * 6 + k] = -Infinity;
      const scale = BINS / cExt[axis];
      for (let i = start; i < end; i++) {
        const t = order[i];
        const b = Math.min(BINS - 1, Math.floor((centroids[t * 3 + axis] - cMin[axis]) * scale));
        binCount[b]++;
        for (let k = 0; k < 3; k++) {
          const lo = triBounds[t * 6 + k], hi = triBounds[t * 6 + 3 + k];
          if (lo < binBounds[b * 6 + k]) binBounds[b * 6 + k] = lo;
          if (hi > binBounds[b * 6 + 3 + k]) binBounds[b * 6 + 3 + k] = hi;
        }
      }
      // 从左往右累加，得到“前 i 个格子”的三角形数和表面积；再从右往左同样算一遍
      leftArea.fill(0);
      let acc = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      let accCount = 0;
      for (let b = 0; b < BINS - 1; b++) {
        acc = grow(acc, binBounds, b);
        accCount += binCount[b];
        leftArea[b] = accCount ? surfaceArea(acc) * accCount : 0;
      }
      acc = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      accCount = 0;
      for (let b = BINS - 1; b > 0; b--) {
        acc = grow(acc, binBounds, b);
        accCount += binCount[b];
        const cost = leftArea[b - 1] + (accCount ? surfaceArea(acc) * accCount : 0);
        if (cost < bestCost) {
          bestCost = cost;
          bestAxis = axis;
          bestSplit = b; // 格子编号 < b 的放左边
        }
      }
    }

    let mid = -1;
    if (bestAxis >= 0) {
      const scale = BINS / cExt[bestAxis];
      let i = start, j = end - 1;
      while (i <= j) {
        const b = Math.min(BINS - 1, Math.floor((centroids[order[i] * 3 + bestAxis] - cMin[bestAxis]) * scale));
        if (b < bestSplit) i++;
        else {
          const t = order[i]; order[i] = order[j]; order[j] = t;
          j--;
        }
      }
      mid = i;
    }
    if (mid <= start || mid >= end) {
      // 所有三角形中心都挤在一起（或者 SAH 切不开）：退回到按数量对半分
      const axis = cExt[0] >= cExt[1] && cExt[0] >= cExt[2] ? 0 : cExt[1] >= cExt[2] ? 1 : 2;
      if (cExt[axis] === 0) {
        nodes[node * 2] = start;
        nodes[node * 2 + 1] = -count;
        continue;
      }
      mid = (start + end) >> 1;
      quickSelect(order, centroids, axis, start, end - 1, mid);
    }

    const left = newNode();
    const right = newNode();
    nodes[node * 2] = left;
    nodes[node * 2 + 1] = right;
    stack.push([left, start, mid], [right, mid, end]);
  }

  return { tris, bounds, nodes, order, nodeCount };
}

const BINS = 16;
const binCount = new Int32Array(BINS);
const binBounds = new Float64Array(BINS * 6);
const leftArea = new Float64Array(BINS);

function grow(acc: number[], b: Float64Array, i: number) {
  if (b[i * 6] === Infinity) return acc; // 空格子
  return [
    Math.min(acc[0], b[i * 6]), Math.min(acc[1], b[i * 6 + 1]), Math.min(acc[2], b[i * 6 + 2]),
    Math.max(acc[3], b[i * 6 + 3]), Math.max(acc[4], b[i * 6 + 4]), Math.max(acc[5], b[i * 6 + 5]),
  ];
}

function surfaceArea(b: number[]) {
  const x = b[3] - b[0], y = b[4] - b[1], z = b[5] - b[2];
  return 2 * (x * y + y * z + z * x);
}

/** 让 order[start..end] 中第 k 个位置放上按中心坐标排第 k 的三角形，左边都不大于它，右边都不小于它 */
function quickSelect(order: Uint32Array, c: Float64Array, axis: number, lo: number, hi: number, k: number) {
  while (lo < hi) {
    const pivot = c[order[(lo + hi) >> 1] * 3 + axis];
    let i = lo, j = hi;
    while (i <= j) {
      while (c[order[i] * 3 + axis] < pivot) i++;
      while (c[order[j] * 3 + axis] > pivot) j--;
      if (i <= j) {
        const t = order[i]; order[i] = order[j]; order[j] = t;
        i++; j--;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else return;
  }
}

/** 遍历用的栈，所有射线共用一个，避免每条射线都分配内存（树的深度远小于 128） */
const STACK = new Int32Array(128);

export interface Hit {
  /** 沿射线的距离（方向向量是单位向量时就是实际距离） */
  t: number;
  /** 打中的三角形编号 */
  triangle: number;
}

/**
 * 射线和包围盒求交（slab 方法）：射线依次穿过 x、y、z 三组平行平面，
 * 三段区间的交集非空就说明打中了盒子。返回进入盒子的距离，没打中返回 Infinity。
 */
function hitBox(b: Float64Array, i: number, ox: number, oy: number, oz: number, ix: number, iy: number, iz: number, tMax: number) {
  // 这个函数每条射线要调用上百次，用 if 代替 Math.min / Math.max，快不少
  let tNear = (b[i] - ox) * ix, tFar = (b[i + 3] - ox) * ix;
  if (tNear > tFar) { const s = tNear; tNear = tFar; tFar = s; }
  let t0 = (b[i + 1] - oy) * iy, t1 = (b[i + 4] - oy) * iy;
  if (t0 > t1) { const s = t0; t0 = t1; t1 = s; }
  if (t0 > tNear) tNear = t0;
  if (t1 < tFar) tFar = t1;
  t0 = (b[i + 2] - oz) * iz; t1 = (b[i + 5] - oz) * iz;
  if (t0 > t1) { const s = t0; t0 = t1; t1 = s; }
  if (t0 > tNear) tNear = t0;
  if (t1 < tFar) tFar = t1;
  // 射线正好贴着盒子的面时会出现 NaN（0 × Infinity），比较结果都是 false，等于当作打中：宁可多查也不漏
  if (tFar < 0 || tFar < tNear || tNear > tMax) return Infinity;
  return tNear > 0 ? tNear : 0;
}

/**
 * Möller–Trumbore 射线三角形求交：用重心坐标 (u, v) 表示交点，
 * 解一个 3×3 线性方程组，u ≥ 0、v ≥ 0、u + v ≤ 1 就说明交点在三角形内。
 * 双面都算（不管三角形朝哪边）。
 */
export function rayTriangle(tris: ArrayLike<number>, t: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): number {
  const i = t * 9;
  const e1x = tris[i + 3] - tris[i], e1y = tris[i + 4] - tris[i + 1], e1z = tris[i + 5] - tris[i + 2];
  const e2x = tris[i + 6] - tris[i], e2y = tris[i + 7] - tris[i + 1], e2z = tris[i + 8] - tris[i + 2];
  const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-12) return Infinity; // 射线和三角形平行
  const inv = 1 / det;
  const sx = ox - tris[i], sy = oy - tris[i + 1], sz = oz - tris[i + 2];
  const u = (sx * px + sy * py + sz * pz) * inv;
  if (u < 0 || u > 1) return Infinity;
  const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < 0 || u + v > 1) return Infinity;
  const dist = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return dist > 0 ? dist : Infinity;
}

/** 最近的交点。skip 是要忽略的三角形（通常是射线出发的那个三角形） */
export function raycast(
  bvh: BVH,
  origin: ArrayLike<number>,
  dir: ArrayLike<number>,
  skip = -1,
  tMax = Infinity,
): Hit | null {
  const { tris, bounds, nodes, order } = bvh;
  if (bvh.nodeCount === 0 || order.length === 0) return null;
  const ox = origin[0], oy = origin[1], oz = origin[2];
  const dx = dir[0], dy = dir[1], dz = dir[2];
  const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
  let best = tMax;
  let bestTri = -1;

  const stack = STACK;
  let sp = 0;
  if (hitBox(bounds, 0, ox, oy, oz, ix, iy, iz, best) === Infinity) return null;
  stack[sp++] = 0;
  while (sp > 0) {
    const node = stack[--sp];
    const a = nodes[node * 2], b = nodes[node * 2 + 1];
    if (b < 0) {
      for (let k = a; k < a - b; k++) {
        const t = order[k];
        if (t === skip) continue;
        const d = rayTriangle(tris, t, ox, oy, oz, dx, dy, dz);
        if (d < best) {
          best = d;
          bestTri = t;
        }
      }
      continue;
    }
    // 两个孩子都检查，先压远的、后压近的，这样先处理近的，能更早缩小 best，剪掉更多节点
    const ta = hitBox(bounds, a * 6, ox, oy, oz, ix, iy, iz, best);
    const tb = hitBox(bounds, b * 6, ox, oy, oz, ix, iy, iz, best);
    if (ta <= tb) {
      if (tb !== Infinity) stack[sp++] = b;
      if (ta !== Infinity) stack[sp++] = a;
    } else {
      if (ta !== Infinity) stack[sp++] = a;
      if (tb !== Infinity) stack[sp++] = b;
    }
  }
  return bestTri < 0 ? null : { t: best, triangle: bestTri };
}
