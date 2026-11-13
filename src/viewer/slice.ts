/**
 * 切片：用一个水平面 z = h 去切三角形网格，得到这一层的截面轮廓。
 * 这就是切片软件的第一步（后面才是生成外墙和填充路径）。
 *
 * 1. 每个跨过平面的三角形，和平面相交得到一条线段
 * 2. 按端点把线段首尾相连，拼成闭合的轮廓（多边形）
 * 3. 判断轮廓之间的嵌套关系：最外层是实体，套在里面的是孔，再里面又是实体……
 *
 * 所有坐标都是文件坐标，Z 轴朝上，输入格式和 geometry.ts 一样（每 9 个数字一个三角形）。
 */

export type Point2 = [number, number];

export interface Contour {
  points: Point2[];
  /** 有向面积的绝对值 */
  area: number;
  /** 嵌套深度：0 = 最外层，1 = 孔，2 = 孔里的岛…… 偶数是实体，奇数是孔 */
  depth: number;
  /** 首尾是否接上了。网格有破洞时，切出来的线段可能连不成闭合的圈 */
  closed: boolean;
}

export interface SliceResult {
  contours: Contour[];
  /** 截面实体面积 = 实体轮廓面积 − 孔的面积 */
  area: number;
  /** 没能闭合的轮廓数量 */
  openContours: number;
}

/** 求所有和平面 z = h 相交的线段 */
export function intersectPlane(tris: ArrayLike<number>, h: number): [Point2, Point2][] {
  const segments: [Point2, Point2][] = [];
  for (let i = 0; i + 8 < tris.length; i += 9) {
    // 每个顶点到平面的有符号距离。正好落在平面上的顶点算作“上方”，
    // 这样每个三角形要么不相交，要么恰好有两条边穿过平面，不会出现退化情况
    const d = [tris[i + 2] - h, tris[i + 5] - h, tris[i + 8] - h];
    const above = d.map((v) => v >= 0);
    if (above[0] === above[1] && above[1] === above[2]) continue;

    const pts: Point2[] = [];
    for (let e = 0; e < 3; e++) {
      let a = e, b = (e + 1) % 3;
      if (above[a] === above[b]) continue;
      // 相邻两个三角形共用这条边，但顶点顺序相反。固定先后顺序再插值，
      // 保证两边算出的交点逐位相同，后面才能按端点拼接
      if (lexGreater(tris, i + a * 3, i + b * 3)) [a, b] = [b, a];
      const t = d[a] / (d[a] - d[b]); // 线性插值：边上 z 正好等于 h 的位置
      const ax = tris[i + a * 3], ay = tris[i + a * 3 + 1];
      const bx = tris[i + b * 3], by = tris[i + b * 3 + 1];
      pts.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
    }
    // 顶点正好在平面上、另两个顶点都在下方时，两个交点重合成一个点，这种零长度线段丢掉
    if (pts.length === 2 && Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]) > 1e-9) {
      segments.push([pts[0], pts[1]]);
    }
  }
  return segments;
}

function lexGreater(t: ArrayLike<number>, p: number, q: number) {
  for (let k = 0; k < 3; k++) if (t[p + k] !== t[q + k]) return t[p + k] > t[q + k];
  return false;
}

/** 把线段按端点首尾相连，拼成轮廓 */
export function joinSegments(segments: [Point2, Point2][], tolerance = 1e-6): { points: Point2[]; closed: boolean }[] {
  const key = (p: Point2) => `${Math.round(p[0] / tolerance)},${Math.round(p[1] / tolerance)}`;
  // 每个端点 → 用到它的线段编号
  const byPoint = new Map<string, number[]>();
  segments.forEach(([a, b], i) => {
    for (const p of [a, b]) {
      const k = key(p);
      const list = byPoint.get(k);
      if (list) list.push(i);
      else byPoint.set(k, [i]);
    }
  });

  const used = new Uint8Array(segments.length);
  const loops: { points: Point2[]; closed: boolean }[] = [];

  // 从 seg 的一端 start 出发，沿着相连的线段一直走
  const walk = (seg: number, start: Point2): Point2[] => {
    const path: Point2[] = [start];
    let current = seg;
    let at = start;
    while (current >= 0) {
      used[current] = 1;
      const [a, b] = segments[current];
      const next = key(a) === key(at) ? b : a;
      path.push(next);
      at = next;
      current = (byPoint.get(key(next)) ?? []).find((s) => !used[s]) ?? -1;
    }
    return path;
  };

  for (let i = 0; i < segments.length; i++) {
    if (used[i]) continue;
    const [a] = segments[i];
    let path = walk(i, a);
    const closed = path.length > 3 && key(path[0]) === key(path[path.length - 1]);
    if (!closed) {
      // 没闭合：从起点往反方向再走一段，把两边接起来，得到完整的开口折线
      const back = (byPoint.get(key(a)) ?? []).find((s) => !used[s]);
      if (back !== undefined) path = [...walk(back, a).reverse(), ...path.slice(1)];
    } else {
      path.pop(); // 去掉和起点重复的终点
    }
    loops.push({ points: path, closed });
  }
  return loops;
}

/** 鞋带公式求多边形有向面积 */
export function polygonArea(points: Point2[]): number {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

/** 射线法判断点是否在多边形内部：从点向右发射线，穿过边的次数为奇数就在内部 */
export function pointInPolygon(p: Point2, poly: Point2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function sliceAt(tris: ArrayLike<number>, h: number): SliceResult {
  const loops = joinSegments(intersectPlane(tris, h));
  const contours: Contour[] = loops.map((l) => ({
    points: l.points,
    closed: l.closed,
    area: Math.abs(polygonArea(l.points)),
    depth: 0,
  }));

  // 嵌套深度 = 有多少个其他闭合轮廓包住了它
  const closedOnes = contours.filter((c) => c.closed && c.points.length >= 3);
  for (const c of closedOnes) {
    const probe = c.points[0];
    c.depth = closedOnes.filter((o) => o !== c && o.area > c.area && pointInPolygon(probe, o.points)).length;
  }

  const area = closedOnes.reduce((sum, c) => sum + (c.depth % 2 === 0 ? c.area : -c.area), 0);
  return { contours, area, openContours: contours.length - closedOnes.length };
}

/** 层数 = 模型高度 ÷ 层高（向上取整） */
export function layerCount(heightMm: number, layerHeightMm: number): number {
  return Math.max(1, Math.ceil(heightMm / layerHeightMm - 1e-9));
}
