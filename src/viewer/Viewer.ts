import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface ModelInfo {
  triangles: number;
  size: THREE.Vector3; // 包围盒尺寸（模型单位，STL 通常是 mm），按文件原始坐标系
}

/**
 * 和 React 无关的纯 Three.js 查看器。
 * 把渲染逻辑放在普通的类里，React 组件只负责“挂载 / 卸载”，
 * 这样逻辑更好测试，也更容易以后搬进 Electron 或别的框架。
 */
export class Viewer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private mesh: THREE.Mesh | null = null;
  private resizeObserver: ResizeObserver;
  private frameId = 0;
  private container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    const { clientWidth: w, clientHeight: h } = container;

    // 1. 渲染器：负责把场景画到 <canvas> 上（底层就是 WebGL）
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(w, h);
    container.appendChild(this.renderer.domElement);

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

    // 打印平台网格，3D 打印软件里很常见
    const grid = new THREE.GridHelper(200, 20, 0x666a75, 0x3a3d45);
    this.scene.add(grid);

    // 4. 轨道控制：鼠标左键旋转、滚轮缩放、右键平移
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;

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

    // CAD 和 3D 打印软件通常是 Z 轴朝上，而 Three.js 默认 Y 轴朝上，
    // 绕 X 轴转 -90° 把模型“立起来”
    if (zUp) geometry.rotateX(-Math.PI / 2);

    // STL 文件经常不带法线或法线不可靠，重新计算保证光照正确
    geometry.computeVertexNormals();

    // 居中到原点，并让模型底面贴在网格平面上（Y=0）
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    const center = box.getCenter(new THREE.Vector3());
    geometry.translate(-center.x, -box.min.y, -center.z);
    geometry.computeBoundingBox();
    const viewSize = geometry.boundingBox!.getSize(new THREE.Vector3());

    const material = new THREE.MeshStandardMaterial({
      color: 0x4f9dde,
      metalness: 0.1,
      roughness: 0.6,
      // 很多网上下载的 STL 三角形朝向不统一，双面渲染避免出现“破洞”
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.scene.add(this.mesh);

    this.frameModel(viewSize);

    const pos = geometry.getAttribute('position');
    const triangles = geometry.index ? geometry.index.count / 3 : pos.count / 3;
    return { triangles, size };
  }

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
  }

  // 渲染循环：每一帧更新控制器（阻尼）并重新绘制
  private animate = () => {
    this.frameId = requestAnimationFrame(this.animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    cancelAnimationFrame(this.frameId);
    this.resizeObserver.disconnect();
    this.clearModel();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
