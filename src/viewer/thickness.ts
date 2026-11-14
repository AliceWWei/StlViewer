/**
 * 壁厚分析：模型每个地方有多厚。太薄的墙打印机打不出来（喷嘴挤出的线有宽度），
 * 或者打出来一碰就断。
 *
 * 方法（形状直径函数，Shape Diameter Function，Shapira 等 2008）：
 * 从每个三角形的中心，沿法线的反方向（往模型里面）发一小束射线（默认 5 条），看多远打到对面的表面。
 * - 只发一条射线不可靠：靠近棱角的点，射线可能斜着打到相邻的面上，得到假的“很薄”。
 * - 所以在一个圆锥里发多条，把每条的距离投影回法线方向（距离 × cosθ，就是“垂直深度”），
 *   再取中位数。平板的两面平行时，每条的投影都等于板厚；个别打到侧面的射线是离群值，被中位数忽略。
 * - 射线打到的面，法线应该和射线同向（从里面穿出去）。如果反向，说明打到的是另一个物体的外表面
 *   或者网格朝向乱了，这条不算。
 *
 * 结果是每个三角形一个厚度值（和输入同一单位），没有任何射线打中时为 NaN（比如网格不封闭，射线射出去了）。
 */
import { buildBVH, raycast, type BVH } from './bvh';

export interface ThicknessOptions {
  /** 圆锥半角，默认 30° */
  coneAngleDeg?: number;
  /** 圆锥边上的射线数，加上中心一条。默认 4（共 5 条）：5 条取中位数，能容忍 2 条离群值 */
  ringRays?: number;
  /**
   * 射线最远走多远（和输入同一单位）。比这更厚的地方记为 Infinity（“很厚”）。
   * 我们只关心薄的地方，限制距离以后射线很快就停下，BVH 能跳过绝大部分节点，速度快很多。
   */
  maxDistance?: number;
  /** 每处理这么多个三角形回调一次进度 */
  progressEvery?: number;
  onProgress?: (done: number, total: number) => void;
}

export function computeThickness(tris: ArrayLike<number>, options: ThicknessOptions = {}, prebuilt?: BVH): Float32Array {
  const bvh = prebuilt ?? buildBVH(tris);
  const t = bvh.tris;
  const n = Math.floor(t.length / 9);
  const cone = ((options.coneAngleDeg ?? 30) * Math.PI) / 180;
  const ring = options.ringRays ?? 4;
  const every = options.progressEvery ?? 5000;
  const maxDistance = options.maxDistance ?? Infinity;
  const out = new Float32Array(n);

  // 圆锥里的方向，先在“法线 = +z”的局部坐标里定好，之后转到每个三角形的坐标系
  const local: [number, number, number][] = [[0, 0, 1]];
  for (let k = 0; k < ring; k++) {
    const a = (k / ring) * Math.PI * 2;
    local.push([Math.sin(cone) * Math.cos(a), Math.sin(cone) * Math.sin(a), Math.cos(cone)]);
  }

  const depths: number[] = [];
  const origin = [0, 0, 0];
  const dir = [0, 0, 0];
  for (let f = 0; f < n; f++) {
    const i = f * 9;
    const e1x = t[i + 3] - t[i], e1y = t[i + 4] - t[i + 1], e1z = t[i + 5] - t[i + 2];
    const e2x = t[i + 6] - t[i], e2y = t[i + 7] - t[i + 1], e2z = t[i + 8] - t[i + 2];
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-12) {
      out[f] = NaN; // 退化三角形没有法线
      continue;
    }
    // 往里：法线的反方向
    nx = -nx / len; ny = -ny / len; nz = -nz / len;

    // 以 w = 往里的方向，构造两个和它垂直的单位向量 u、v
    const ax = Math.abs(nx) < 0.9 ? 1 : 0, ay = ax ? 0 : 1;
    let ux = ay * nz, uy = -ax * nz, uz = ax * ny - ay * nx;
    const ul = Math.hypot(ux, uy, uz);
    ux /= ul; uy /= ul; uz /= ul;
    const vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux;

    const cx = (t[i] + t[i + 3] + t[i + 6]) / 3;
    const cy = (t[i + 1] + t[i + 4] + t[i + 7]) / 3;
    const cz = (t[i + 2] + t[i + 5] + t[i + 8]) / 3;
    origin[0] = cx; origin[1] = cy; origin[2] = cz;

    depths.length = 0;
    for (const [lx, ly, lz] of local) {
      dir[0] = lx * ux + ly * vx + lz * nx;
      dir[1] = lx * uy + ly * vy + lz * ny;
      dir[2] = lx * uz + ly * vz + lz * nz;
      let d = exitDistance(bvh, origin, dir, f, maxDistance / lz);
      if (d === Infinity && maxDistance !== Infinity) {
        // 在上限之内没打中：可能是“比上限还厚”，也可能射线从破洞射出去了（不封闭的模型）。
        // 不设上限再打一次，确实能从里面穿出去才算“很厚”
        if (Number.isNaN(exitDistance(bvh, origin, dir, f, Infinity))) d = NaN;
      }
      if (!Number.isNaN(d)) depths.push(d * lz); // lz = cosθ：投影到法线方向的深度
    }
    out[f] = depths.length ? median(depths) : NaN;
    if (options.onProgress && (f + 1) % every === 0) options.onProgress(f + 1, n);
  }
  options.onProgress?.(n, n);
  return out;
}

/**
 * 射线从模型里面穿出去的距离。
 * 没打中任何东西：Infinity（在 tMax 以内没有）或者 NaN（tMax 为 Infinity 时，说明射线射出去了）。
 * 打中的面法线和射线反向（打到的是外表面，不是从里面穿出去）也算 NaN。
 */
function exitDistance(bvh: BVH, origin: number[], dir: number[], skip: number, tMax: number) {
  const hit = raycast(bvh, origin, dir, skip, tMax);
  if (!hit) return tMax === Infinity ? NaN : Infinity;
  if (hit.t < 1e-9) return NaN;
  const t = bvh.tris;
  const h = hit.triangle * 9;
  const f1x = t[h + 3] - t[h], f1y = t[h + 4] - t[h + 1], f1z = t[h + 5] - t[h + 2];
  const f2x = t[h + 6] - t[h], f2y = t[h + 7] - t[h + 1], f2z = t[h + 8] - t[h + 2];
  const hx = f1y * f2z - f1z * f2y, hy = f1z * f2x - f1x * f2z, hz = f1x * f2y - f1y * f2x;
  return hx * dir[0] + hy * dir[1] + hz * dir[2] > 0 ? hit.t : NaN;
}

function median(values: number[]) {
  values.sort((a, b) => a - b);
  const m = values.length >> 1;
  return values.length % 2 ? values[m] : (values[m - 1] + values[m]) / 2;
}

export interface ThicknessSummary {
  /**
   * 最薄处：从最薄的三角形开始累加面积，累计到 minSpotArea 时的厚度。
   * 直接取最小值没有意义：棱角上常有面积只有 0.00001 mm² 的细长三角形，测出来几乎是 0，
   * 但这么小的一点对打印没有影响。
   */
  min: number;
  /** 比阈值薄的面积 */
  thinArea: number;
  /** 比阈值薄的三角形数量 */
  thinTriangles: number;
  /** 没测到（射线没有打中）的三角形数量 */
  unmeasured: number;
}

function triangleArea(tris: ArrayLike<number>, f: number) {
  const i = f * 9;
  const e1x = tris[i + 3] - tris[i], e1y = tris[i + 4] - tris[i + 1], e1z = tris[i + 5] - tris[i + 2];
  const e2x = tris[i + 6] - tris[i], e2y = tris[i + 7] - tris[i + 1], e2z = tris[i + 8] - tris[i + 2];
  return Math.hypot(e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x) / 2;
}

/** 汇总：最薄多少、有多少面积低于最小壁厚。minSpotArea 和 tris 同一单位（默认按毫米：1 mm²，大约一个 1 × 1 mm 的小斑点） */
export function summarizeThickness(
  tris: ArrayLike<number>,
  thickness: ArrayLike<number>,
  minWall: number,
  minSpotArea = 1,
): ThicknessSummary {
  let thinArea = 0, thinTriangles = 0, unmeasured = 0;
  const measured: number[] = [];
  for (let f = 0; f < thickness.length; f++) {
    const v = thickness[f];
    if (Number.isNaN(v)) {
      unmeasured++;
      continue;
    }
    measured.push(f);
    if (v < minWall) {
      thinTriangles++;
      thinArea += triangleArea(tris, f);
    }
  }
  measured.sort((a, b) => thickness[a] - thickness[b]);
  let min = NaN, acc = 0;
  for (const f of measured) {
    acc += triangleArea(tris, f);
    min = thickness[f];
    if (acc >= minSpotArea) break;
  }
  return { min, thinArea, thinTriangles, unmeasured };
}

/**
 * 厚度 → 颜色（0~1 的 RGB）。
 * 热力图：比最小壁厚薄是红色；从最小壁厚到 3 倍最小壁厚，红 → 黄 → 绿渐变；更厚的都是绿色。
 * 通过 / 不通过：只有红和绿。没测到的是灰色。
 */
export function thicknessColor(value: number, minWall: number, mode: 'heatmap' | 'passFail'): [number, number, number] {
  if (Number.isNaN(value)) return [0.45, 0.45, 0.48];
  const red: [number, number, number] = [0.9, 0.15, 0.12];
  const yellow: [number, number, number] = [0.95, 0.8, 0.15];
  const green: [number, number, number] = [0.2, 0.75, 0.35];
  if (value < minWall) return red;
  if (mode === 'passFail') return green;
  // 刚过阈值是橙色（只是勉强够），1.5 倍是黄色，3 倍及以上是绿色
  const orange: [number, number, number] = [0.95, 0.5, 0.12];
  const s = Math.min(1, (value - minWall) / (2 * minWall));
  const [a, b, k] = s < 0.25 ? [orange, yellow, s / 0.25] : [yellow, green, (s - 0.25) / 0.75];
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}
