import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

export type SupportedFormat = 'stl' | 'obj';

export function detectFormat(fileName: string): SupportedFormat | null {
  const ext = fileName.split('.').pop()?.toLowerCase();
  return ext === 'stl' || ext === 'obj' ? ext : null;
}

/**
 * 把文件内容解析成一个 BufferGeometry。
 * STL 本身就是一堆三角形；OBJ 可能包含多个网格，这里把它们合并成一个，
 * 这样后面统一处理（居中、计算包围盒、统计三角形数）都只面对一个几何体。
 */
export async function parseModel(file: File): Promise<THREE.BufferGeometry> {
  const format = detectFormat(file.name);
  if (!format) throw new Error(`不支持的文件格式：${file.name}（只支持 .stl / .obj）`);

  if (format === 'stl') {
    // STL 有二进制和 ASCII 两种，STLLoader 接收 ArrayBuffer 会自动判断
    const buffer = await file.arrayBuffer();
    return new STLLoader().parse(buffer);
  }

  const text = await file.text();
  const group = new OBJLoader().parse(text);
  return mergeMeshes(group);
}

function mergeMeshes(root: THREE.Object3D): THREE.BufferGeometry {
  const positions: number[] = [];
  root.updateMatrixWorld(true);
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    // 转成非索引几何，保证每 3 个顶点就是一个三角形
    const geom = (child.geometry as THREE.BufferGeometry).toNonIndexed();
    geom.applyMatrix4(child.matrixWorld);
    const pos = geom.getAttribute('position');
    for (let i = 0; i < pos.count; i++) positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    geom.dispose();
  });
  if (positions.length === 0) throw new Error('OBJ 文件里没有找到网格');
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return merged;
}
