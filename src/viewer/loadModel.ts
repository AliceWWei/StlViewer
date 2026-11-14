import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
import { strFromU8, unzipSync } from 'three/examples/jsm/libs/fflate.module.js';
import { UNITS, type UnitName } from './units';

/** 读取模型失败的原因。只给出错误类型，具体文字由界面按当前语言显示 */
export class ModelLoadError extends Error {
  readonly code: 'unsupported' | 'noMesh';
  readonly fileName: string;
  constructor(code: 'unsupported' | 'noMesh', fileName = '') {
    super(code === 'unsupported' ? `Unsupported file format: ${fileName}` : 'No mesh found in the file');
    this.code = code;
    this.fileName = fileName;
  }
}

export type SupportedFormat = 'stl' | 'obj' | '3mf';

export function detectFormat(fileName: string): SupportedFormat | null {
  const ext = fileName.split('.').pop()?.toLowerCase();
  return ext === 'stl' || ext === 'obj' || ext === '3mf' ? ext : null;
}

export interface ParsedModel {
  geometry: THREE.BufferGeometry;
  /** 文件自己声明的单位（只有 3MF 有；STL / OBJ 不带单位，只能靠猜） */
  unit: UnitName | null;
}

/**
 * 把文件内容解析成一个 BufferGeometry。
 * STL 本身就是一堆三角形；OBJ 和 3MF 可能包含多个网格，这里把它们合并成一个，
 * 这样后面统一处理（居中、计算包围盒、统计三角形数）都只面对一个几何体。
 */
export async function parseModel(file: File): Promise<ParsedModel> {
  const format = detectFormat(file.name);
  if (!format) throw new ModelLoadError('unsupported', file.name);

  if (format === 'stl') {
    // STL 有二进制和 ASCII 两种，STLLoader 接收 ArrayBuffer 会自动判断
    const buffer = await file.arrayBuffer();
    return { geometry: new STLLoader().parse(buffer), unit: null };
  }

  if (format === 'obj') {
    const group = new OBJLoader().parse(await file.text());
    return { geometry: mergeMeshes(group), unit: null };
  }

  // 3MF 其实是一个 zip 包，里面的 3D/3dmodel.model 是 XML，记录了顶点、三角形、单位和摆放位置
  const buffer = await file.arrayBuffer();
  const group = new ThreeMFLoader().parse(buffer);
  return { geometry: mergeMeshes(group), unit: read3mfUnit(buffer) };
}

/** 读取 3MF 模型文件 <model unit="..."> 里声明的单位，默认是毫米 */
export function read3mfUnit(buffer: ArrayBuffer): UnitName {
  const files = unzipSync(new Uint8Array(buffer));
  const modelPath = Object.keys(files).find((p) => /\.model$/i.test(p));
  if (!modelPath) return 'mm';
  const xml = strFromU8(files[modelPath]);
  const unit = /<model[^>]*\sunit="([a-z]+)"/i.exec(xml)?.[1]?.toLowerCase() ?? 'millimeter';
  return (Object.keys(UNITS) as UnitName[]).find((k) => UNITS[k].threeMF === unit) ?? 'mm';
}

function mergeMeshes(root: THREE.Object3D): THREE.BufferGeometry {
  const positions: number[] = [];
  root.updateMatrixWorld(true);
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    // 转成非索引几何，保证每 3 个顶点就是一个三角形
    const geom = (child.geometry as THREE.BufferGeometry).toNonIndexed();
    // 3MF 里每个零件可以有自己的摆放矩阵，合并前要先乘上
    geom.applyMatrix4(child.matrixWorld);
    const pos = geom.getAttribute('position');
    for (let i = 0; i < pos.count; i++) positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    geom.dispose();
  });
  if (positions.length === 0) throw new ModelLoadError('noMesh');
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return merged;
}
