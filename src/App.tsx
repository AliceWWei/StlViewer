import { useCallback, useMemo, useState, type DragEvent } from 'react';
import * as THREE from 'three';
import { ViewerCanvas } from './components/ViewerCanvas';
import { SliceCanvas } from './components/SliceCanvas';
import { parseModel } from './viewer/loadModel';
import type { MeasureResult, ModelInfo, PickMode } from './viewer/Viewer';
import { layerCount, sliceAt } from './viewer/slice';
import { UNITS, suggestUnit, type UnitName } from './viewer/units';
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
  type Vec3,
} from './viewer/geometry';

// 放在 public/samples 里的示例模型。BASE_URL 在本地是 /，部署到 GitHub Pages 后是 /StlViewer/
const SAMPLES = [
  { file: '3DBenchy.stl', label: '3DBenchy 小船（3D 打印测试模型）' },
  { file: 'gear.stl', label: '齿轮' },
  { file: 'teapot.stl', label: '犹他茶壶' },
  { file: 'vase.stl', label: '花瓶（单层曲面，不封闭）' },
  { file: 'box.stl', label: '长方体 20×10×30' },
  { file: 'bracket.3mf', label: 'L 形支架（3MF，试试“放平”）' },
  { file: 'gear-inch.stl', label: '齿轮（英寸单位导出的 STL）' },
];

// 没有上传文件时先显示一个示例形状
function sampleGeometry() {
  return new THREE.TorusKnotGeometry(20, 6, 200, 32);
}

const fmt = (n: number, digits = 1) =>
  n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });

export default function App() {
  // 文件解析出来的原始几何体（文件坐标，单位未知）
  const [source, setSource] = useState<THREE.BufferGeometry | null>(sampleGeometry);
  const [fileUnit, setFileUnit] = useState<UnitName | null>(null); // 文件自己声明的单位（3MF）
  const [unit, setUnit] = useState<UnitName>('mm');
  // 摆放朝向：每次“放平”都在这个旋转上再叠加一次
  const [orientation, setOrientation] = useState(() => new THREE.Quaternion());
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
  const [pickMode, setPickMode] = useState<PickMode>('none');
  const [measure, setMeasure] = useState<MeasureResult | null>(null);
  const [sliceOn, setSliceOn] = useState(false);
  const [layerHeight, setLayerHeight] = useState(0.2);
  const [layer, setLayer] = useState(1);

  // 实际显示和分析用的几何体 = 原始几何体 × 单位换算 × 摆放旋转
  const geometry = useMemo(() => {
    if (!source) return null;
    const g = source.clone();
    const s = UNITS[unit].toMm;
    if (s !== 1) g.scale(s, s, s);
    g.applyQuaternion(orientation);
    return g;
  }, [source, unit, orientation]);

  // 换模型时，把单位和朝向恢复默认
  const loadGeometry = useCallback((g: THREE.BufferGeometry, declaredUnit: UnitName | null) => {
    setSource(g);
    setFileUnit(declaredUnit);
    setUnit(declaredUnit ?? 'mm');
    setOrientation(new THREE.Quaternion());
    setPickMode('none');
  }, []);

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
      const parsed = await parseModel(file);
      loadGeometry(parsed.geometry, parsed.unit);
      setFileName(file.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [loadGeometry]);

  // 放平：把点到的面的法线 n 转到正下方 (0, 0, -1)，这个面就贴在平台上了
  const onFacePick = useCallback((n: Vec3) => {
    const turn = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(...n).normalize(),
      new THREE.Vector3(0, 0, -1),
    );
    setOrientation((q) => turn.multiply(q));
    setPickMode('none');
  }, []);

  // 单位提示：按毫米理解时模型太小或太大，可能是用别的单位导出的
  const rawMaxDim = useMemo(() => {
    if (!source) return 0;
    source.computeBoundingBox();
    const s = source.boundingBox!.getSize(new THREE.Vector3());
    return Math.max(s.x, s.y, s.z);
  }, [source]);
  const unitHint = fileUnit ? null : suggestUnit(rawMaxDim);

  // 切片：取每一层的中间高度来切，和切片软件的做法一样，也能避开正好落在顶点上的情况
  const modelHeight = analysis ? analysis.bounds.size[2] : 0;
  const totalLayers = layerCount(modelHeight, layerHeight);
  const currentLayer = Math.min(layer, totalLayers);
  const slice = useMemo(() => {
    if (!sliceOn || !analysis) return null;
    const height = analysis.bounds.min[2] + Math.min(modelHeight, (currentLayer - 0.5) * layerHeight);
    return { height, ...sliceAt(analysis.tris, height) };
  }, [sliceOn, analysis, currentLayer, layerHeight, modelHeight]);

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
        pickMode={pickMode}
        onMeasure={setMeasure}
        onFacePick={onFacePick}
        slice={slice}
      />

      <aside className="panel">
        <h1>STL / OBJ / 3MF Viewer</h1>
        <label className="button">
          打开文件
          <input
            type="file"
            accept=".stl,.obj,.3mf"
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

        <h2>单位</h2>
        <dl>
          <dt>文件单位</dt>
          <dd>
            <select className="select inline" value={unit} onChange={(e) => setUnit(e.target.value as UnitName)}>
              {(Object.keys(UNITS) as UnitName[]).map((u) => (
                <option key={u} value={u}>{UNITS[u].label}</option>
              ))}
            </select>
          </dd>
        </dl>
        {fileUnit ? (
          <p className="hint">3MF 文件声明了单位：{UNITS[fileUnit].label}，已自动换算成毫米</p>
        ) : unitHint && unit === 'mm' ? (
          <p className="warn">
            按毫米算模型只有 {fmt(rawMaxDim, 2)} mm，可能是用{UNITS[unitHint].label}导出的。
            <button className="link" onClick={() => setUnit(unitHint)}>按{UNITS[unitHint].label}换算</button>
          </p>
        ) : (
          <p className="hint">STL / OBJ 不带单位，默认按毫米理解</p>
        )}

        <h2>摆放</h2>
        <div className="row">
          <button
            className={`small ${pickMode === 'face' ? 'active' : ''}`}
            onClick={() => setPickMode(pickMode === 'face' ? 'none' : 'face')}
          >
            {pickMode === 'face' ? '点击模型上的一个面…' : '选一个面放平'}
          </button>
          <button className="small" onClick={() => setOrientation(new THREE.Quaternion())}>恢复原始朝向</button>
        </div>

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

            <h2>切片预览</h2>
            <label className="check">
              <input type="checkbox" checked={sliceOn} onChange={(e) => setSliceOn(e.target.checked)} />
              逐层查看截面
            </label>
            {sliceOn && slice && (
              <>
                <dl>
                  <dt>层高</dt>
                  <dd>
                    <select className="select inline" value={layerHeight} onChange={(e) => setLayerHeight(+e.target.value)}>
                      {[0.1, 0.2, 0.3].map((h) => <option key={h} value={h}>{h} mm</option>)}
                    </select>
                  </dd>
                  <dt>层</dt>
                  <dd className="range">
                    <input
                      type="range"
                      min={1}
                      max={totalLayers}
                      value={currentLayer}
                      onChange={(e) => setLayer(+e.target.value)}
                      style={{ width: 130 }}
                    />
                    {currentLayer} / {totalLayers}
                  </dd>
                  <dt>高度</dt><dd>{fmt(slice.height - analysis.bounds.min[2], 2)} mm</dd>
                  <dt>截面面积</dt><dd>{fmt(slice.area, 1)} mm²</dd>
                  <dt>轮廓</dt>
                  <dd>
                    {slice.contours.filter((c) => c.closed && c.depth % 2 === 0).length} 个实体，
                    {slice.contours.filter((c) => c.closed && c.depth % 2 === 1).length} 个孔
                  </dd>
                </dl>
                {slice.openContours > 0 && (
                  <p className="warn">⚠ 有 {slice.openContours} 条轮廓没闭合（红色），说明这一层附近网格有破洞</p>
                )}
                <SliceCanvas contours={slice.contours} bounds={analysis.bounds} />
              </>
            )}

            <h2>测量</h2>
            <label className="check">
              <input
                type="checkbox"
                checked={pickMode === 'measure'}
                onChange={(e) => setPickMode(e.target.checked ? 'measure' : 'none')}
              />
              两点测距（点击模型表面）
            </label>
            {pickMode === 'measure' && (
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
