import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { Vec3 } from './geometry';
import { pointInPolygon, type Contour } from './slice';

export type PickMode = 'none' | 'measure' | 'face';

export interface ModelInfo {
  triangles: number;
  size: THREE.Vector3; // 包围盒尺寸（模型单位，STL 通常是 mm），按文件原始坐标系
}

export interface MeasureResult {
  /** 已经点了几个点（1 或 2） */
  points: number;
  distance: number;
  /** 两点在文件坐标系里的差值 ΔX/ΔY/ΔZ */
  delta: Vec3;
}

/**
 * 和 React 无关的纯 Three.js 查看器。
 * 把渲染逻辑放在普通的类里，React 组件只负责“挂载 / 卸载”，
 * 这样逻辑更好测试，也更容易以后搬进 Electron 或别的框架。
 *
 * 坐标约定：文件（CAD）是 Z 轴朝上，Three.js 是 Y 轴朝上。
 * 加载时把模型绕 X 轴转 -90°，再平移到平台中央：
 *   显示坐标 = rotateX(-90°)(文件坐标) + offset
 * 测量结果会再换算回文件坐标，保证和 CAD 软件里看到的一致。
 */
export class Viewer {
  private renderer: THREE.WebGLRenderer;
  private labelRenderer: CSS2DRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private mesh: THREE.Mesh | null = null;
  private resizeObserver: ResizeObserver;
  private frameId = 0;
  private container: HTMLElement;

  /** 文件坐标 → 显示坐标 的变换，测量时用它的逆变换换算回去 */
  private fileToView = new THREE.Matrix4();
  private modelSize = new THREE.Vector3(); // 文件坐标系里的尺寸
  private viewSize = new THREE.Vector3(); // 显示坐标系里的尺寸

  private grid: THREE.GridHelper;
  private boundsGroup = new THREE.Group();
  private printerGroup = new THREE.Group();
  private measureGroup = new THREE.Group();
  private sliceGroup = new THREE.Group();
  /** 切片预览用的裁剪平面：只保留 y ≤ 切片高度 的部分 */
  private clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
  private rotation = new THREE.Matrix4(); // 只含 Z 朝上 → Y 朝上 的旋转

  // 悬垂高亮的 shader 参数，所有材质共用同一份 uniforms，改数值不用重新编译
  private overhangUniforms = {
    uOverhangOn: { value: 0 },
    uOverhangSin: { value: Math.sin(Math.PI / 4) },
    uBedEps: { value: 0.05 },
  };

  private showBounds = false;
  private pickMode: PickMode = 'none';
  private measurePoints: THREE.Vector3[] = [];
  private pointerDown: { x: number; y: number } | null = null;
  private raycaster = new THREE.Raycaster();

  onMeasure: (result: MeasureResult | null) => void = () => {};
  /** “放平”模式下点到的面，法线是文件坐标 */
  onFacePick: (normal: Vec3) => void = () => {};

  constructor(container: HTMLElement) {
    this.container = container;
    const { clientWidth: w, clientHeight: h } = container;

    // 1. 渲染器：负责把场景画到 <canvas> 上（底层就是 WebGL）
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(w, h);
    this.renderer.localClippingEnabled = true; // 允许单个材质使用裁剪平面
    container.appendChild(this.renderer.domElement);

    // 文字标签（尺寸、距离）用 HTML 元素叠加在画布上，每帧按 3D 位置投影到屏幕
    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.setSize(w, h);
    Object.assign(this.labelRenderer.domElement.style, {
      position: 'absolute',
      inset: '0',
      pointerEvents: 'none',
    });
    container.appendChild(this.labelRenderer.domElement);

    // 2. 相机：透视相机，参数是 视野角度、宽高比、近裁剪面、远裁剪面
    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 10000);
    this.camera.position.set(100, 80, 120);

    // 3. 场景背景和灯光
    this.scene.background = new THREE.Color(0x1e1f24);
    // 半球光：天空色 + 地面色，提供柔和的环境照明
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 1.2));
    // 平行光：像太阳，产生明暗面，让形状看得出立体感
    const key = new THREE.DirectionalLight(0xffffff, 2);
    key.position.set(1, 2, 1.5);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.6);
    fill.position.set(-1.5, -0.5, -1);
    this.scene.add(fill);

    // 打印平台网格，选了打印机之后会换成打印机平台的大小
    this.grid = this.makeGrid(200);
    this.scene.add(this.grid, this.boundsGroup, this.printerGroup, this.measureGroup, this.sliceGroup);

    // 4. 轨道控制：鼠标左键旋转、滚轮缩放、右键平移
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;

    // 测量取点：区分“点击”和“拖拽旋转”，按下到松开移动不超过 5 像素才算点击
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', this.handlePointerDown);
    canvas.addEventListener('pointerup', this.handlePointerUp);

    // 容器大小变化时，更新画布和相机宽高比，否则模型会被拉伸
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);

    this.animate();
  }

  /** 显示一个新的几何体，返回统计信息 */
  setGeometry(source: THREE.BufferGeometry, zUp = true): ModelInfo {
    this.clearModel();
    // 复制一份再修改，不改动调用方传进来的几何体（React StrictMode 下 effect 会跑两次）
    const geometry = source.clone();

    // 先在文件原始坐标系下算尺寸，这样显示的 X/Y/Z 和 CAD 软件里一致
    geometry.computeBoundingBox();
    const size = geometry.boundingBox!.getSize(new THREE.Vector3());
    this.modelSize.copy(size);

    // CAD 和 3D 打印软件通常是 Z 轴朝上，而 Three.js 默认 Y 轴朝上，
    // 绕 X 轴转 -90° 把模型“立起来”
    const rotation = new THREE.Matrix4();
    if (zUp) rotation.makeRotationX(-Math.PI / 2);
    this.rotation.copy(rotation);
    geometry.applyMatrix4(rotation);

    // STL 文件经常不带法线或法线不可靠，重新计算保证光照正确
    geometry.computeVertexNormals();

    // 居中到原点，并让模型底面贴在网格平面上（Y=0）
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    const center = box.getCenter(new THREE.Vector3());
    const offset = new THREE.Vector3(-center.x, -box.min.y, -center.z);
    geometry.translate(offset.x, offset.y, offset.z);
    this.fileToView.makeTranslation(offset.x, offset.y, offset.z).multiply(rotation);

    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    this.viewSize.copy(geometry.boundingBox!.getSize(new THREE.Vector3()));

    const material = new THREE.MeshStandardMaterial({
      color: 0x4f9dde,
      metalness: 0.1,
      roughness: 0.6,
      // 很多网上下载的 STL 三角形朝向不统一，双面渲染避免出现“破洞”
      side: THREE.DoubleSide,
    });
    this.addOverhangShader(material);
    this.mesh = new THREE.Mesh(geometry, material);
    this.scene.add(this.mesh);

    this.overhangUniforms.uBedEps.value = Math.max(0.05, this.viewSize.y * 1e-3);
    this.rebuildBounds();
    this.clearMeasure();
    this.setSlice(null, []);
    this.frameModel(this.viewSize);

    const pos = geometry.getAttribute('position');
    const triangles = geometry.index ? geometry.index.count / 3 : pos.count / 3;
    return { triangles, size };
  }

  // ───────────────────────── 悬垂高亮 ─────────────────────────

  /**
   * 在 Three.js 自带的 PBR 材质里插入几行 GLSL：
   * 顶点着色器把法线和位置变换到世界坐标，片元着色器判断这个像素所在的面
   * 是否“朝下且比阈值更斜”，是的话染成红色。
   * 阈值是 uniform，拖动滑块时只改一个数字，GPU 每帧实时重新判断，不需要重算几何。
   */
  private addOverhangShader(material: THREE.MeshStandardMaterial) {
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.overhangUniforms);
      shader.vertexShader =
        'varying vec3 vOverhangNormal;\nvarying vec3 vOverhangPos;\n' +
        shader.vertexShader.replace(
          '#include <project_vertex>',
          `#include <project_vertex>
          vOverhangNormal = normalize(mat3(modelMatrix) * objectNormal);
          vOverhangPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
        );
      shader.fragmentShader =
        'uniform float uOverhangOn;\nuniform float uOverhangSin;\nuniform float uBedEps;\n' +
        'varying vec3 vOverhangNormal;\nvarying vec3 vOverhangPos;\n' +
        shader.fragmentShader.replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          bool isOverhang = false;
          if (uOverhangOn > 0.5) {
            // 法线和竖直向下方向的点积：竖直的墙是 0，完全朝下的天花板是 1
            float downDot = -normalize(vOverhangNormal).y;
            // 贴在平台上的底面有平台托着，不需要支撑
            isOverhang = downDot > uOverhangSin && vOverhangPos.y > uBedEps;
            if (isOverhang) diffuseColor.rgb = vec3(0.95, 0.22, 0.18);
          }`,
        ).replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          // 悬垂面大多朝下、照不到光，加一点自发光让红色在暗处也看得清
          if (isOverhang) totalEmissiveRadiance += vec3(0.45, 0.06, 0.04);`,
        );
    };
  }

  /** 打开 / 关闭悬垂高亮。maxAngleDeg：和竖直方向的夹角超过多少度需要支撑 */
  setOverhang(enabled: boolean, maxAngleDeg = 45) {
    this.overhangUniforms.uOverhangOn.value = enabled ? 1 : 0;
    this.overhangUniforms.uOverhangSin.value = Math.sin(THREE.MathUtils.degToRad(maxAngleDeg));
  }

  // ───────────────────────── 包围盒 ─────────────────────────

  setShowBounds(show: boolean) {
    this.showBounds = show;
    this.rebuildBounds();
  }

  private rebuildBounds() {
    disposeGroup(this.boundsGroup);
    if (!this.showBounds || !this.mesh) return;
    const box = this.mesh.geometry.boundingBox!.clone();
    this.boundsGroup.add(new THREE.Box3Helper(box, 0xf5c542));

    // 在三条边的中点标注尺寸，数值用文件坐标（X 宽、Y 深、Z 高）
    const { min, max } = box;
    const s = this.modelSize;
    this.boundsGroup.add(
      makeLabel(`X ${s.x.toFixed(1)}`, new THREE.Vector3((min.x + max.x) / 2, min.y, max.z), 'dim'),
      makeLabel(`Y ${s.y.toFixed(1)}`, new THREE.Vector3(max.x, min.y, (min.z + max.z) / 2), 'dim'),
      makeLabel(`Z ${s.z.toFixed(1)}`, new THREE.Vector3(max.x, (min.y + max.y) / 2, max.z), 'dim'),
    );
  }

  // ───────────────────────── 打印机成型空间 ─────────────────────────

  /** 显示打印机的成型空间（build: 文件坐标 X×Y×Z），放得下画绿色，放不下画红色 */
  setPrinter(build: Vec3 | null, fits = true) {
    disposeGroup(this.printerGroup);
    this.scene.remove(this.grid);
    this.grid.dispose();

    if (!build) {
      this.grid = this.makeGrid(200);
      this.scene.add(this.grid);
      return;
    }
    const [bx, by, bz] = build;
    // 文件坐标 (X, Y, Z) 对应显示坐标 (x, z, y)：高度 Z 变成显示里的 y
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(bx, bz, by));
    const lines = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: fits ? 0x5ad17a : 0xff5a52 }),
    );
    lines.position.y = bz / 2;
    this.printerGroup.add(lines);

    this.grid = this.makeGrid(Math.max(bx, by));
    this.scene.add(this.grid);
  }

  private makeGrid(size: number) {
    return new THREE.GridHelper(size, Math.max(1, Math.round(size / 10)), 0x666a75, 0x3a3d45);
  }

  // ───────────────────────── 测量 ─────────────────────────

  /** 点击模型时做什么：测量取点，或者选一个面放平 */
  setPickMode(mode: PickMode) {
    this.pickMode = mode;
    this.renderer.domElement.style.cursor = mode === 'none' ? '' : 'crosshair';
    if (mode !== 'measure') this.clearMeasure();
  }

  clearMeasure() {
    this.measurePoints = [];
    disposeGroup(this.measureGroup);
    this.onMeasure(null);
  }

  private handlePointerDown = (e: PointerEvent) => {
    this.pointerDown = { x: e.clientX, y: e.clientY };
  };

  private handlePointerUp = (e: PointerEvent) => {
    const down = this.pointerDown;
    this.pointerDown = null;
    if (this.pickMode === 'none' || !this.mesh || !down || e.button !== 0) return;
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return; // 是拖拽，不是点击

    // 射线拾取：把鼠标位置换成 -1~1 的标准化坐标，从相机穿过这个点发一条射线
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObject(this.mesh, false)[0];
    if (!hit) return;

    if (this.pickMode === 'face' && hit.face) {
      // 点到的三角形的法线是显示坐标，只需要逆旋转换回文件坐标（法线不受平移影响）
      const n = hit.face.normal.clone().applyMatrix4(this.rotation.clone().invert()).normalize();
      this.onFacePick([n.x, n.y, n.z]);
      return;
    }

    if (this.measurePoints.length >= 2) this.clearMeasure(); // 第三下开始新的测量
    this.measurePoints.push(hit.point.clone());
    this.drawMeasure();
  };

  private drawMeasure() {
    disposeGroup(this.measureGroup);
    const pts = this.measurePoints;
    // 标记小球的大小跟着模型尺寸走，大模型上看得见、小模型上不会太大
    const radius = this.viewSize.length() * 0.012;
    const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xffd34d, depthTest: false });
    for (const p of pts) {
      const marker = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 12), markerMaterial);
      marker.position.copy(p);
      marker.renderOrder = 999; // 最后画并关闭深度测试，被模型挡住也能看见
      this.measureGroup.add(marker);
    }

    if (pts.length < 2) {
      this.onMeasure({ points: 1, distance: 0, delta: [0, 0, 0] });
      return;
    }
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0xffd34d, depthTest: false }),
    );
    line.renderOrder = 999;
    this.measureGroup.add(line);

    // 换算回文件坐标：距离在旋转平移下不变，但 ΔX/ΔY/ΔZ 要和 CAD 里的轴对应
    const viewToFile = this.fileToView.clone().invert();
    const a = pts[0].clone().applyMatrix4(viewToFile);
    const b = pts[1].clone().applyMatrix4(viewToFile);
    const d = b.clone().sub(a);
    const distance = d.length();
    this.measureGroup.add(
      makeLabel(`${distance.toFixed(2)} mm`, pts[0].clone().add(pts[1]).multiplyScalar(0.5), 'measure'),
    );
    this.onMeasure({ points: 2, distance, delta: [Math.abs(d.x), Math.abs(d.y), Math.abs(d.z)] });
  }

  // ───────────────────────── 切片预览 ─────────────────────────

  /**
   * 显示切片：用裁剪平面把切片高度以上的部分“切掉”，
   * 再在切口处画出截面（实体部分填色，轮廓描边，没闭合的轮廓画成红色）。
   * height 是文件坐标里的 Z 值，contours 由 slice.ts 算好传进来。
   */
  setSlice(height: number | null, contours: Contour[]) {
    disposeGroup(this.sliceGroup);
    const material = this.mesh?.material as THREE.MeshStandardMaterial | undefined;
    if (height === null || !this.mesh) {
      if (material) material.clippingPlanes = [];
      return;
    }
    const viewY = new THREE.Vector3(0, 0, height).applyMatrix4(this.fileToView).y;
    this.clipPlane.constant = viewY;
    if (material) material.clippingPlanes = [this.clipPlane];

    // 截面填色：每个实体轮廓（偶数深度）做成一个 Shape，直接套在它里面的孔作为 holes
    const solids = contours.filter((c) => c.closed && c.depth % 2 === 0);
    const holes = contours.filter((c) => c.closed && c.depth % 2 === 1);
    const shapes = solids.map((c) => {
      const shape = new THREE.Shape(c.points.map(([x, y]) => new THREE.Vector2(x, y)));
      for (const h of holes) {
        if (h.depth === c.depth + 1 && h.area < c.area && pointInPolygon(h.points[0], c.points)) {
          shape.holes.push(new THREE.Path(h.points.map(([x, y]) => new THREE.Vector2(x, y))));
        }
      }
      return shape;
    });
    // 轮廓点在文件坐标的 XY 平面上，先放到 z = height，再用和模型一样的变换转到显示坐标
    const place = new THREE.Matrix4().multiplyMatrices(
      this.fileToView,
      new THREE.Matrix4().makeTranslation(0, 0, height),
    );
    if (shapes.length > 0) {
      const cap = new THREE.Mesh(
        new THREE.ShapeGeometry(shapes),
        new THREE.MeshBasicMaterial({ color: 0xf08a3c, side: THREE.DoubleSide }),
      );
      cap.geometry.applyMatrix4(place);
      this.sliceGroup.add(cap);
    }

    for (const c of contours) {
      const pts = c.points.map(([x, y]) => new THREE.Vector3(x, y, 0).applyMatrix4(place));
      const geom = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = new THREE.LineBasicMaterial({ color: c.closed ? 0xffe0b0 : 0xff3b30, depthTest: false });
      const line = c.closed ? new THREE.LineLoop(geom, mat) : new THREE.Line(geom, mat);
      line.renderOrder = 998;
      this.sliceGroup.add(line);
    }
  }

  // ───────────────────────── 相机和生命周期 ─────────────────────────

  /** 把相机移到能完整看到模型的位置 */
  private frameModel(size: THREE.Vector3) {
    const radius = size.length() / 2;
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const distance = (radius / Math.sin(fov / 2)) * 1.2; // 留一点边距
    const target = new THREE.Vector3(0, size.y / 2, 0);
    const dir = new THREE.Vector3(1, 0.8, 1.2).normalize();
    this.camera.position.copy(target).addScaledVector(dir, distance);
    this.camera.near = distance / 100;
    this.camera.far = distance * 100;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(target);
    this.controls.update();
  }

  private clearModel() {
    if (!this.mesh) return;
    this.scene.remove(this.mesh);
    // GPU 资源不会被 JS 垃圾回收自动释放，必须手动 dispose
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh = null;
  }

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
  }

  // 渲染循环：每一帧更新控制器（阻尼）并重新绘制
  private animate = () => {
    this.frameId = requestAnimationFrame(this.animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  };

  dispose() {
    cancelAnimationFrame(this.frameId);
    this.resizeObserver.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.handlePointerDown);
    canvas.removeEventListener('pointerup', this.handlePointerUp);
    this.clearModel();
    disposeGroup(this.boundsGroup);
    disposeGroup(this.printerGroup);
    disposeGroup(this.measureGroup);
    disposeGroup(this.sliceGroup);
    this.grid.dispose();
    this.controls.dispose();
    this.renderer.dispose();
    canvas.remove();
    this.labelRenderer.domElement.remove();
  }
}

function makeLabel(text: string, position: THREE.Vector3, kind: 'dim' | 'measure') {
  const el = document.createElement('div');
  el.className = `label label-${kind}`;
  el.textContent = text;
  const obj = new CSS2DObject(el);
  obj.position.copy(position);
  return obj;
}

/** 移除一个组里的所有子对象，并释放它们的几何体、材质和 HTML 标签 */
function disposeGroup(group: THREE.Group) {
  const materials = new Set<THREE.Material>();
  group.traverse((obj) => {
    if (obj instanceof CSS2DObject) obj.element.remove();
    const o = obj as Partial<THREE.Mesh>;
    o.geometry?.dispose();
    if (o.material) {
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
    }
  });
  materials.forEach((m) => m.dispose());
  group.clear();
}
