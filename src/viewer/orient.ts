/**
 * “放平”用的纯几何计算，不依赖渲染，方便单元测试。
 *
 * 为什么不能直接用点到的那个三角形的法线：
 * 曲面（比如船身）是由成千上万个很小的三角形拼成的，每个三角形的朝向都略有不同，
 * 只用一个三角形，模型会被转到一个“歪”的角度。
 * 这里从点到的三角形出发，向相邻三角形扩散，把朝向相差不超过 maxAngleDeg 的一片都找出来，
 * 再按面积加权求平均法线，得到这一片表面整体的朝向。
 */
import type { Vec3 } from './geometry';

/**
 * 三角形邻接表（CSR 格式）：三角形 t 的邻居是 neighbors[offsets[t] .. offsets[t+1])。
 * 两个三角形共用一条边才算相邻。STL 里相邻三角形的顶点是重复存的，先按坐标焊接再找共用边。
 */
export interface Adjacency {
  offsets: Int32Array;
  neighbors: Int32Array;
}

export function buildAdjacency(tris: ArrayLike<number>, tolerance = 1e-4): Adjacency {
  const count = Math.floor(tris.length / 9);
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

  const BIG = 2 ** 26;
  const firstOwner = new Map<number, number>(); // 边 → 第一个用到它的三角形
  const pairs: number[] = []; // 相邻的三角形对 (a, b, a, b, ...)
  for (let t = 0; t < count; t++) {
    const i = t * 9;
    const a = vertexId(i), b = vertexId(i + 3), c = vertexId(i + 6);
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      if (p === q) continue;
      const key = Math.min(p, q) * BIG + Math.max(p, q);
      const other = firstOwner.get(key);
      if (other === undefined) firstOwner.set(key, t);
      else if (other !== t) pairs.push(other, t);
    }
  }

  const degree = new Int32Array(count + 1);
  for (const t of pairs) degree[t + 1]++;
  const offsets = new Int32Array(count + 1);
  for (let t = 0; t < count; t++) offsets[t + 1] = offsets[t] + degree[t + 1];
  const fill = offsets.slice(0, count);
  const neighbors = new Int32Array(pairs.length);
  for (let k = 0; k < pairs.length; k += 2) {
    const a = pairs[k], b = pairs[k + 1];
    neighbors[fill[a]++] = b;
    neighbors[fill[b]++] = a;
  }
  return { offsets, neighbors };
}

/** 三角形 t 的 AB × AC（方向是法线，长度是面积的 2 倍） */
function cross(tris: ArrayLike<number>, t: number): Vec3 {
  const i = t * 9;
  const abx = tris[i + 3] - tris[i], aby = tris[i + 4] - tris[i + 1], abz = tris[i + 5] - tris[i + 2];
  const acx = tris[i + 6] - tris[i], acy = tris[i + 7] - tris[i + 1], acz = tris[i + 8] - tris[i + 2];
  return [aby * acz - abz * acy, abz * acx - abx * acz, abx * acy - aby * acx];
}

export interface FacePatch {
  /** 这一片表面包含的三角形编号 */
  triangles: number[];
  /** 面积加权的平均单位法线 */
  normal: Vec3;
  /** 总面积 */
  area: number;
}

/**
 * 从三角形 start 出发，找出相连、并且法线和 start 相差不超过 maxAngleDeg 的一片三角形。
 * 和“起点”比较而不是和“上一个邻居”比较，否则在平滑曲面上会一路扩散到整个模型。
 * flip = true 时把 start 的法线反过来用（三角形朝向存反了、从背面点到时用）。
 */
export function findFacePatch(
  tris: ArrayLike<number>,
  adjacency: Adjacency,
  start: number,
  maxAngleDeg = 12,
  flip = false,
): FacePatch {
  const sign = flip ? -1 : 1;
  const s = cross(tris, start);
  const sl = Math.hypot(s[0], s[1], s[2]) || 1;
  const seed: Vec3 = [(s[0] / sl) * sign, (s[1] / sl) * sign, (s[2] / sl) * sign];
  const minDot = Math.cos((maxAngleDeg * Math.PI) / 180);

  const visited = new Set<number>([start]);
  const queue = [start];
  const triangles: number[] = [];
  const sum: Vec3 = [0, 0, 0];
  let area = 0;
  while (queue.length > 0) {
    const t = queue.pop()!;
    const c = cross(tris, t);
    const len = Math.hypot(c[0], c[1], c[2]);
    triangles.push(t);
    area += len / 2;
    // 叉积长度就是面积的 2 倍，直接相加就是面积加权
    sum[0] += c[0] * sign;
    sum[1] += c[1] * sign;
    sum[2] += c[2] * sign;

    for (let k = adjacency.offsets[t]; k < adjacency.offsets[t + 1]; k++) {
      const nb = adjacency.neighbors[k];
      if (visited.has(nb)) continue;
      visited.add(nb);
      const n = cross(tris, nb);
      const nl = Math.hypot(n[0], n[1], n[2]);
      if (nl === 0) continue; // 退化三角形没有朝向
      const dot = ((n[0] * seed[0] + n[1] * seed[1] + n[2] * seed[2]) * sign) / nl;
      if (dot >= minDot) queue.push(nb);
    }
  }

  const l = Math.hypot(sum[0], sum[1], sum[2]);
  const normal: Vec3 = l > 0 ? [sum[0] / l, sum[1] / l, sum[2] / l] : seed;
  return { triangles, normal, area };
}

/** 法线 n 是否已经（几乎）朝正下方：up 是“向上”方向，默认文件坐标的 +Z */
export function isFacingDown(n: Vec3, toleranceDeg = 1, up: Vec3 = [0, 0, 1]): boolean {
  const len = Math.hypot(n[0], n[1], n[2]) || 1;
  const down = -(n[0] * up[0] + n[1] * up[1] + n[2] * up[2]) / len;
  return down >= Math.cos((toleranceDeg * Math.PI) / 180);
}
