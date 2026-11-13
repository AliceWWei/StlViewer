import { useCallback, useMemo, useState, type DragEvent } from 'react';
import * as THREE from 'three';
import { ViewerCanvas } from './components/ViewerCanvas';
import { parseModel } from './viewer/loadModel';
import type { MeasureResult, ModelInfo } from './viewer/Viewer';
import {
  MATERIALS,
  PRINTERS,
  checkFit,
  checkMesh,
  computeBounds,
  computeOverhangArea,
  computeSignedVolume,
  computeSurfaceArea,
  estimateMaterialGrams,
  toTriangleArray,
} from './viewer/geometry';

// 放在 public/samples 里的示例模型。BASE_URL 在本地是 /，部署到 GitHub Pages 后是 /StlViewer/
const SAMPLES = [
  { file: '3DBenchy.stl', label: '3DBenchy 小船（3D 打印测试模型）' },
  { file: 'gear.stl', label: '齿轮' },
  { file: 'teapot.stl', label: '犹他茶壶' },
  { file: 'vase.stl', label: '花瓶（单层曲面，不封闭）' },
  { file: 'box.stl', label: '长方体 20×10×30' },
];

// 没有上传文件时先显示一个示例形状
function sampleGeometry() {
  return new THREE.TorusKnotGeometry(20, 6, 200, 32);
}

const fmt = (n: number, digits = 1) =>
  n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });

export default function App() {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(sampleGeometry);
  const [fileName, setFileName] = useState('示例：环面纽结');
  const [info, setInfo] = useState<ModelInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);

  // 分析选项
  const [materialIndex, setMaterialIndex] = useState(0);
  const [infill, setInfill] = useState(20);
  const [printerIndex, setPrinterIndex] = useState(-1);
  const [overhangOn, setOverhangOn] = useState(false);
  const [overhangAngle, setOverhangAngle] = useState(45);
  const [showBounds, setShowBounds] = useState(false);
  const [measureMode, setMeasureMode] = useState(false);
  const [measure, setMeasure] = useState<MeasureResult | null>(null);

  // 几何分析只在换模型时算一次（Benchy 22 万个三角形也只要几百毫秒）
  const analysis = useMemo(() => {
    if (!geometry) return null;
    const tris = toTriangleArray(geometry);
    const volume = computeSignedVolume(tris);
    return {
      tris,
      volume,
      area: computeSurfaceArea(tris),
      bounds: computeBounds(tris),
      mesh: checkMesh(tris),
    };
  }, [geometry]);

  // 悬垂面积跟着角度阈值变，单独算
  const overhangArea = useMemo(
    () => (analysis && overhangOn ? computeOverhangArea(analysis.tris, overhangAngle) : null),
    [analysis, overhangOn, overhangAngle],
  );

  const printer = printerIndex >= 0 ? PRINTERS[printerIndex] : null;
  const fit = printer && analysis ? checkFit(analysis.bounds.size, printer.build) : null;
  const fits = fit?.fits ?? true;
  const printerProp = useMemo(
    () => (printer ? { build: printer.build, fits } : null),
    [printer, fits],
  );
  const overhangProp = useMemo(
    () => ({ enabled: overhangOn, maxAngle: overhangAngle }),
    [overhangOn, overhangAngle],
  );

  const openFile = useCallback(async (file: File) => {
    setError(null);
    try {
      setGeometry(await parseModel(file));
      setFileName(file.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const openSample = async (name: string) => {
    if (!name) return;
    setLoading(true);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}samples/${name}`);
      if (!res.ok) throw new Error(`下载示例失败：HTTP ${res.status}`);
      // 包装成 File，复用和“打开文件”完全相同的解析流程
      await openFile(new File([await res.blob()], name));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) openFile(file);
  };

  const volumeCm3 = analysis ? Math.abs(analysis.volume) / 1000 : 0;
  const grams = analysis
    ? estimateMaterialGrams(analysis.volume, analysis.area, MATERIALS[materialIndex].density, {
        infill: infill / 100,
      })
    : 0;

  return (
    <div
      className={`app ${dragging ? 'dragging' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <ViewerCanvas
        geometry={geometry}
        onModelInfo={setInfo}
        overhang={overhangProp}
        showBounds={showBounds}
        printer={printerProp}
        measureMode={measureMode}
        onMeasure={setMeasure}
      />

      <aside className="panel">
        <h1>STL / OBJ Viewer</h1>
        <label className="button">
          打开文件
          <input
            type="file"
            accept=".stl,.obj"
            hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) openFile(f); }}
          />
        </label>
        <p className="hint">也可以直接把文件拖进窗口</p>

        <select className="select" value="" disabled={loading} onChange={(e) => openSample(e.target.value)}>
          <option value="">{loading ? '加载中…' : '或者选一个示例模型…'}</option>
          {SAMPLES.map((s) => (
            <option key={s.file} value={s.file}>{s.label}</option>
          ))}
        </select>

        {error && <p className="error">{error}</p>}

        <h2>模型</h2>
        <dl>
          <dt>文件</dt><dd>{fileName}</dd>
          {info && (
            <>
              <dt>三角形</dt><dd>{info.triangles.toLocaleString()}</dd>
              <dt>尺寸 (mm)</dt>
              <dd>{fmt(info.size.x)} × {fmt(info.size.y)} × {fmt(info.size.z)}</dd>
            </>
          )}
        </dl>
        <label className="check">
          <input type="checkbox" checked={showBounds} onChange={(e) => setShowBounds(e.target.checked)} />
          显示包围盒和尺寸
        </label>

        {analysis && (
          <>
            <h2>网格检查</h2>
            {analysis.mesh.watertight ? (
              <p className="ok">✓ 表面封闭（水密），可以切片</p>
            ) : (
              <p className="warn">⚠ 表面不封闭，体积和切片结果不可靠</p>
            )}
            <dl>
              <dt>破洞边</dt><dd>{analysis.mesh.openEdges.toLocaleString()}</dd>
              <dt>非流形边</dt><dd>{analysis.mesh.nonManifoldEdges.toLocaleString()}</dd>
              <dt>退化三角形</dt><dd>{analysis.mesh.degenerateTriangles.toLocaleString()}</dd>
            </dl>

            <h2>体积与用料</h2>
            <dl>
              <dt>体积</dt><dd>{fmt(volumeCm3, 2)} cm³{analysis.mesh.watertight ? '' : '（仅供参考）'}</dd>
              <dt>表面积</dt><dd>{fmt(analysis.area / 100, 2)} cm²</dd>
              <dt>材料</dt>
              <dd>
                <select className="select inline" value={materialIndex} onChange={(e) => setMaterialIndex(+e.target.value)}>
                  {MATERIALS.map((m, i) => (
                    <option key={m.name} value={i}>{m.name}（{m.density} g/cm³）</option>
                  ))}
                </select>
              </dd>
              <dt>填充率</dt>
              <dd className="range">
                <input type="range" min={0} max={100} step={5} value={infill} onChange={(e) => setInfill(+e.target.value)} />
                {infill}%
              </dd>
              <dt>估算用料</dt><dd>约 {fmt(grams)} g</dd>
            </dl>
            <p className="hint">按外壳 0.8 mm + 内部填充粗略估算，精确值以切片软件为准</p>

            <h2>打印机</h2>
            <select className="select" value={printerIndex} onChange={(e) => setPrinterIndex(+e.target.value)}>
              <option value={-1}>不显示成型空间</option>
              {PRINTERS.map((p, i) => (
                <option key={p.name} value={i}>{p.name}（{p.build.join(' × ')}）</option>
              ))}
            </select>
            {fit && (fit.fits ? (
              <p className="ok">✓ 放得下{fit.needsRotation ? '（需要在平台上转 90°）' : ''}</p>
            ) : (
              <p className="warn">
                ✗ 放不下：
                {['X', 'Y', 'Z']
                  .map((axis, i) => (fit.overflow[i] > 0 ? `${axis} 超出 ${fmt(fit.overflow[i])} mm` : null))
                  .filter(Boolean)
                  .join('，')}
              </p>
            ))}

            <h2>支撑分析</h2>
            <label className="check">
              <input type="checkbox" checked={overhangOn} onChange={(e) => setOverhangOn(e.target.checked)} />
              高亮需要支撑的悬垂面
            </label>
            {overhangOn && (
              <dl>
                <dt>角度阈值</dt>
                <dd className="range">
                  <input type="range" min={20} max={80} value={overhangAngle} onChange={(e) => setOverhangAngle(+e.target.value)} />
                  {overhangAngle}°
                </dd>
                <dt>悬垂面积</dt><dd>{fmt((overhangArea ?? 0) / 100, 2)} cm²</dd>
              </dl>
            )}

            <h2>测量</h2>
            <label className="check">
              <input type="checkbox" checked={measureMode} onChange={(e) => setMeasureMode(e.target.checked)} />
              两点测距（点击模型表面）
            </label>
            {measureMode && (
              measure?.points === 2 ? (
                <dl>
                  <dt>距离</dt><dd>{fmt(measure.distance, 2)} mm</dd>
                  <dt>ΔX / ΔY / ΔZ</dt>
                  <dd>{measure.delta.map((d) => fmt(d, 2)).join(' / ')}</dd>
                </dl>
              ) : (
                <p className="hint">{measure?.points === 1 ? '再点第二个点' : '点第一个点'}，按 Esc 清除</p>
              )
            )}
          </>
        )}

        <p className="hint">左键旋转 · 滚轮缩放 · 右键平移</p>
      </aside>
    </div>
  );
}
