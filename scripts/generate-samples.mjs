// 用 Three.js 自带的几何体生成几个示例 STL（二进制格式），放到 public/samples。
// 运行：node scripts/generate-samples.mjs public/samples
import * as THREE from 'three';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { TeapotGeometry } from 'three/examples/jsm/geometries/TeapotGeometry.js';
import { writeFileSync } from 'node:fs';

const out = process.argv[2] ?? 'public/samples';
const exporter = new STLExporter();

function save(name, geometry) {
  const data = exporter.parse(new THREE.Mesh(geometry), { binary: true });
  writeFileSync(`${out}/${name}`, Buffer.from(data.buffer));
  console.log(name, 'written');
}

// 茶壶：Three.js 里是 Y 轴朝上，转成 Z 轴朝上，和 CAD / 切片软件的习惯一致
const teapot = new TeapotGeometry(20, 12);
teapot.rotateX(Math.PI / 2);
save('teapot.stl', teapot);

// 齿轮：先画 2D 轮廓，再沿 Z 方向挤出（ExtrudeGeometry），中间挖一个轴孔
const teeth = 16;
const rOut = 30;
const rIn = 25;
const shape = new THREE.Shape();
for (let i = 0; i < teeth * 4; i++) {
  const a = (i / (teeth * 4)) * Math.PI * 2;
  const r = i % 4 < 2 ? rOut : rIn;
  const x = r * Math.cos(a);
  const y = r * Math.sin(a);
  if (i === 0) shape.moveTo(x, y);
  else shape.lineTo(x, y);
}
const hole = new THREE.Path();
hole.absarc(0, 0, 6, 0, Math.PI * 2, true);
shape.holes.push(hole);
save(
  'gear.stl',
  new THREE.ExtrudeGeometry(shape, {
    depth: 8,
    bevelEnabled: true,
    bevelThickness: 1,
    bevelSize: 0.8,
    bevelSegments: 2,
    curveSegments: 32,
  }),
);

// 花瓶：一条轮廓线绕轴旋转一圈（LatheGeometry，绕 Y 轴），再转成 Z 轴朝上
const profile = [];
for (let i = 0; i <= 40; i++) {
  const t = i / 40;
  profile.push(new THREE.Vector2(12 + 8 * Math.sin(t * Math.PI * 1.5) + 4 * t, t * 80));
}
const vase = new THREE.LatheGeometry(profile, 96);
vase.rotateX(Math.PI / 2);
save('vase.stl', vase);
