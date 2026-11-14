/**
 * 网格修复：把“看起来是一个模型、其实有小毛病”的三角网格整理成切片软件喜欢的样子。
 *
 * 1. 焊接顶点：STL 里每个三角形各存一份顶点，坐标几乎相同的点合并成同一个顶点，
 *    这样才知道哪些三角形是相邻的（共用一条边）。
 * 2. 删除退化三角形（两个角焊到了同一个点，面积为 0）和完全重复的三角形。
 * 3. 统一法线方向：相邻三角形共用一条边时，两边走这条边的方向应该相反
 *    （一个是 a→b，另一个是 b→a），这样两个面的法线才朝同一侧。
 *    从一个三角形出发做广度优先搜索，方向不对的邻居就翻过来。
 * 4. 补小洞：只被一个三角形用到的边连起来就是洞的边界，
 *    边数不多的洞用“中心点 + 扇形”补上，新三角形的方向和周围一致。
 * 5. 法线朝外：封闭的壳体积为正说明法线朝外；套在别的壳里面的壳（空腔）体积应该为负。
 *
 * 输入输出格式和 geometry.ts 一样：每 9 个数字一个三角形。
 */

export interface RepairOptions {
  /** 焊接容差（文件单位）。和 checkMesh 一样，默认 1e-4 */
  tolerance?: number;
  /** 边数不超过这个值的洞才补，更大的洞通常是模型本身缺了一块，自动补会补错 */
  maxHoleEdges?: number;
}

export interface RepairReport {
  /** 原来的顶点数（每个三角形 3 个） */
  originalVertices: number;
  /** 焊接后剩下的顶点数 */
  weldedVertices: number;
  removedDegenerate: number;
  removedDuplicate: number;
  /** 被翻转的原有三角形数量 */
  flippedTriangles: number;
  filledHoles: number;
  /** 补洞新增的三角形 */
  addedTriangles: number;
  /** 太大没有补的洞 */
  skippedHoles: number;
}

export interface RepairResult {
  tris: Float32Array;
  report: RepairReport;
}

type Face = [number, number, number];

const edgeKey = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);

export function repairMesh(tris: ArrayLike<number>, options: RepairOptions = {}): RepairResult {
  const tolerance = options.tolerance ?? 1e-4;
  const maxHoleEdges = options.maxHoleEdges ?? 64;
  const triCount = Math.floor(tris.length / 9);

  // ── 1. 焊接顶点 ──
  const ids = new Map<string, number>();
  const positions: number[] = [];
  const vertexId = (i: number) => {
    const x = tris[i], y = tris[i + 1], z = tris[i + 2];
    const key = `${Math.round(x / tolerance)},${Math.round(y / tolerance)},${Math.round(z / tolerance)}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = positions.length / 3;
      ids.set(key, id);
      positions.push(x, y, z);
    }
    return id;
  };

  // ── 2. 删除退化和重复的三角形 ──
  let faces: Face[] = [];
  let removedDegenerate = 0;
  let removedDuplicate = 0;
  const seen = new Set<string>();
  for (let t = 0; t < triCount; t++) {
    const a = vertexId(t * 9), b = vertexId(t * 9 + 3), c = vertexId(t * 9 + 6);
    if (a === b || b === c || a === c) {
      removedDegenerate++;
      continue;
    }
    // 同样三个顶点的三角形，不管方向如何都算重复（正反两面贴在一起也会造成非流形边）
    const key = [a, b, c].sort((p, q) => p - q).join(',');
    if (seen.has(key)) {
      removedDuplicate++;
      continue;
    }
    seen.add(key);
    faces.push([a, b, c]);
  }
  const originalFaceCount = faces.length;
  const original = faces.map((f) => [...f] as Face);

  // ── 3. 统一方向 ──
  orientConsistently(faces);

  // ── 4. 补小洞 ──
  const { added, filled, skipped } = fillHoles(faces, positions, maxHoleEdges);
  faces = faces.concat(added);

  // ── 5. 让每个壳的法线朝外 ──
  orientOutward(faces, positions);

  let flippedTriangles = 0;
  for (let i = 0; i < originalFaceCount; i++) {
    if (!sameWinding(original[i], faces[i])) flippedTriangles++;
  }

  const out = new Float32Array(faces.length * 9);
  faces.forEach((f, i) => {
    for (let k = 0; k < 3; k++) {
      out[i * 9 + k * 3] = positions[f[k] * 3];
      out[i * 9 + k * 3 + 1] = positions[f[k] * 3 + 1];
      out[i * 9 + k * 3 + 2] = positions[f[k] * 3 + 2];
    }
  });

  return {
    tris: out,
    report: {
      originalVertices: triCount * 3,
      weldedVertices: positions.length / 3,
      removedDegenerate,
      removedDuplicate,
      flippedTriangles,
      filledHoles: filled,
      addedTriangles: added.length,
      skippedHoles: skipped,
    },
  };
}

/** 两个三角形的顶点相同时，绕行方向是否一致（a,b,c 和 b,c,a 是同一个方向） */
function sameWinding(f: Face, g: Face) {
  const i = g.indexOf(f[0]);
  return g[(i + 1) % 3] === f[1];
}

/** 三角形 f 是否按 a→b 的方向经过这条边 */
function hasDirectedEdge(f: Face, a: number, b: number) {
  return (f[0] === a && f[1] === b) || (f[1] === a && f[2] === b) || (f[2] === a && f[0] === b);
}

function flip(f: Face) {
  const t = f[1];
  f[1] = f[2];
  f[2] = t;
}

/** 每条边 → 用到它的三角形编号 */
function buildEdgeMap(faces: Face[]) {
  const map = new Map<string, number[]>();
  faces.forEach((f, i) => {
    for (let k = 0; k < 3; k++) {
      const key = edgeKey(f[k], f[(k + 1) % 3]);
      const list = map.get(key);
      if (list) list.push(i);
      else map.set(key, [i]);
    }
  });
  return map;
}

/**
 * 广度优先搜索：只沿着恰好被两个三角形共用的边走（非流形边两边关系不确定，跳过），
 * 邻居和当前三角形以相同方向经过共用边，说明它是反的，翻过来。
 * 返回每个三角形属于第几个连通块（壳）。
 */
function orientConsistently(faces: Face[]): Int32Array {
  const edges = buildEdgeMap(faces);
  const component = new Int32Array(faces.length).fill(-1);
  let next = 0;
  for (let start = 0; start < faces.length; start++) {
    if (component[start] >= 0) continue;
    const id = next++;
    component[start] = id;
    const queue = [start];
    while (queue.length) {
      const fi = queue.pop()!;
      const f = faces[fi];
      for (let k = 0; k < 3; k++) {
        const a = f[k], b = f[(k + 1) % 3];
        const users = edges.get(edgeKey(a, b))!;
        if (users.length !== 2) continue;
        const ni = users[0] === fi ? users[1] : users[0];
        if (component[ni] >= 0) continue;
        if (hasDirectedEdge(faces[ni], a, b)) flip(faces[ni]);
        component[ni] = id;
        queue.push(ni);
      }
    }
  }
  return component;
}

/**
 * 找洞并补上。三角形按 a→b 经过一条边界边，洞就在这条边的另一侧，
 * 所以洞的边界按 b→a 的方向首尾相连成一圈。
 */
function fillHoles(faces: Face[], positions: number[], maxHoleEdges: number) {
  const edges = buildEdgeMap(faces);
  // 洞边界：起点 → 终点（一个点可能是好几个洞的交点，所以存列表）
  const outgoing = new Map<number, number[]>();
  for (const [key, users] of edges) {
    if (users.length !== 1) continue;
    const f = faces[users[0]];
    for (let k = 0; k < 3; k++) {
      const a = f[k], b = f[(k + 1) % 3];
      if (edgeKey(a, b) !== key) continue;
      const list = outgoing.get(b);
      if (list) list.push(a);
      else outgoing.set(b, [a]);
    }
  }

  const added: Face[] = [];
  let filled = 0;
  let skipped = 0;
  for (const startVertex of [...outgoing.keys()]) {
    while ((outgoing.get(startVertex)?.length ?? 0) > 0) {
      const loop = [startVertex];
      let at = outgoing.get(startVertex)!.pop()!;
      let ok = true;
      while (at !== startVertex) {
        loop.push(at);
        const nextList = outgoing.get(at);
        if (!nextList || nextList.length === 0 || loop.length > 100_000) {
          ok = false; // 边界没闭合（不应该发生，除非网格很乱），放弃这一圈
          break;
        }
        at = nextList.pop()!;
      }
      if (!ok) continue;
      if (loop.length > maxHoleEdges) {
        skipped++;
        continue;
      }
      filled++;
      if (loop.length === 3) {
        added.push([loop[0], loop[1], loop[2]]);
        continue;
      }
      // 在洞的中心加一个点，和每条边界边组成一个三角形
      let cx = 0, cy = 0, cz = 0;
      for (const v of loop) {
        cx += positions[v * 3];
        cy += positions[v * 3 + 1];
        cz += positions[v * 3 + 2];
      }
      const c = positions.length / 3;
      positions.push(cx / loop.length, cy / loop.length, cz / loop.length);
      for (let i = 0; i < loop.length; i++) added.push([loop[i], loop[(i + 1) % loop.length], c]);
    }
  }
  return { added, filled, skipped };
}

/** 壳的有向体积：法线朝外时为正 */
function shellVolume(faces: Face[], members: number[], p: number[]) {
  let v = 0;
  for (const fi of members) {
    const [a, b, c] = faces[fi];
    const ax = p[a * 3], ay = p[a * 3 + 1], az = p[a * 3 + 2];
    const bx = p[b * 3], by = p[b * 3 + 1], bz = p[b * 3 + 2];
    const cx = p[c * 3], cy = p[c * 3 + 1], cz = p[c * 3 + 2];
    v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return v / 6;
}

/**
 * 从点 q 沿 +x 方向发一条射线，数穿过多少个三角形：奇数说明在这个壳里面。
 * 和 slice.ts 里二维的 pointInPolygon 是同一个思路，只是升到了三维。
 */
function insideShell(q: [number, number, number], faces: Face[], members: number[], p: number[]) {
  let crossings = 0;
  for (const fi of members) {
    const [a, b, c] = faces[fi];
    // 投影到 yz 平面，判断 (q.y, q.z) 是否在三角形里（重心坐标）
    const ay = p[a * 3 + 1], az = p[a * 3 + 2];
    const by = p[b * 3 + 1], bz = p[b * 3 + 2];
    const cy = p[c * 3 + 1], cz = p[c * 3 + 2];
    const d = (by - ay) * (cz - az) - (cy - ay) * (bz - az);
    if (Math.abs(d) < 1e-18) continue;
    const u = ((q[1] - ay) * (cz - az) - (cy - ay) * (q[2] - az)) / d;
    const v = ((by - ay) * (q[2] - az) - (q[1] - ay) * (bz - az)) / d;
    if (u < 0 || v < 0 || u + v > 1) continue;
    const x = p[a * 3] + u * (p[b * 3] - p[a * 3]) + v * (p[c * 3] - p[a * 3]);
    if (x > q[0]) crossings++;
  }
  return crossings % 2 === 1;
}

/** 壳上几个分散的点：x / y / z 方向最远的顶点。稍微偏一点，避免射线正好擦过别的三角形的边 */
function shellProbes(faces: Face[], members: number[], p: number[]): [number, number, number][] {
  const extremes = new Array<number>(6).fill(faces[members[0]][0]);
  for (const fi of members) {
    for (const v of faces[fi]) {
      for (let k = 0; k < 3; k++) {
        if (p[v * 3 + k] < p[extremes[k * 2] * 3 + k]) extremes[k * 2] = v;
        if (p[v * 3 + k] > p[extremes[k * 2 + 1] * 3 + k]) extremes[k * 2 + 1] = v;
      }
    }
  }
  return [...new Set(extremes)].map((v) => [p[v * 3], p[v * 3 + 1] + 1.234e-7, p[v * 3 + 2] + 2.345e-7]);
}

function orientOutward(faces: Face[], positions: number[]) {
  const component = orientConsistently(faces);
  const shells: number[][] = [];
  component.forEach((id, fi) => (shells[id] ??= []).push(fi));
  if (shells.length > 200) {
    // 碎成很多块的网格（比如扫描数据）逐个做包含测试太慢，只按自身体积判断
    for (const members of shells) {
      if (shellVolume(faces, members, positions) < 0) for (const fi of members) flip(faces[fi]);
    }
    return;
  }
  shells.forEach((members, id) => {
    // 嵌套深度：被几个别的壳包住。偶数是实体的外表面（体积应为正），奇数是空腔（应为负）
    let depth = 0;
    if (shells.length > 1) {
      const probes = shellProbes(faces, members, positions);
      // 只有所有探测点都在里面才算“被包住”。
      // 像茶壶的壶嘴和壶身这种互相穿插的壳，一部分点在里面、一部分在外面，不算空腔
      shells.forEach((other, oid) => {
        if (oid !== id && probes.every((q) => insideShell(q, faces, other, positions))) depth++;
      });
    }
    const volume = shellVolume(faces, members, positions);
    const wantPositive = depth % 2 === 0;
    if (volume !== 0 && volume > 0 !== wantPositive) for (const fi of members) flip(faces[fi]);
  });
}

/**
 * 写成二进制 STL：80 字节文件头 + 三角形数量 + 每个三角形 50 字节（法线、3 个顶点、2 字节属性）。
 * 法线由顶点按右手定则算出来，和顶点顺序保持一致。
 */
export function toBinarySTL(tris: ArrayLike<number>, header = 'Exported by StlViewer'): ArrayBuffer {
  const count = Math.floor(tris.length / 9);
  const buffer = new ArrayBuffer(84 + count * 50);
  const view = new DataView(buffer);
  // 文件头不能以 "solid" 开头，否则有些程序会把它当成 ASCII STL
  const text = header.replace(/^solid/i, 'Solid_').slice(0, 80);
  for (let i = 0; i < text.length; i++) view.setUint8(i, text.charCodeAt(i) & 0x7f);
  view.setUint32(80, count, true);
  let o = 84;
  for (let t = 0; t < count; t++) {
    const i = t * 9;
    const ux = tris[i + 3] - tris[i], uy = tris[i + 4] - tris[i + 1], uz = tris[i + 5] - tris[i + 2];
    const vx = tris[i + 6] - tris[i], vy = tris[i + 7] - tris[i + 1], vz = tris[i + 8] - tris[i + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    for (const v of [nx, ny, nz]) { view.setFloat32(o, v, true); o += 4; }
    for (let k = 0; k < 9; k++) { view.setFloat32(o, tris[i + k], true); o += 4; }
    view.setUint16(o, 0, true);
    o += 2;
  }
  return buffer;
}
