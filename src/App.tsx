import { useCallback, useMemo, useState, type DragEvent } from 'react';
import * as THREE from 'three';
import { ViewerCanvas } from './components/ViewerCanvas';
import { SliceCanvas } from './components/SliceCanvas';
import { ModelLoadError, parseModel } from './viewer/loadModel';
import { MESSAGES, useLang, type Lang, type Messages } from './i18n';
import type { MeasureResult, ModelInfo, PickMode } from './viewer/Viewer';
import { layerCount, sliceAt } from './viewer/slice';
import {
  DISPLAY_UNITS,
  UNITS,
  formatArea,
  formatLength,
  formatNumber,
  formatSize,
  formatVolume,
  isDisplayUnit,
  suggestUnit,
  type DisplayUnit,
  type UnitName,
} from './viewer/units';
import { isFacingDown } from './viewer/orient';
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
// 示例的显示名称在 i18n.ts 的 samples 里
type SampleFile = keyof Messages['samples'];
const SAMPLES: SampleFile[] = [
  '3DBenchy.stl',
  'gear.stl',
  'teapot.stl',
  'vase.stl',
  'box.stl',
  'bracket.3mf',
  'gear-inch.stl',
];

class SampleHttpError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`HTTP ${status}`);
    this.status = status;
  }
}

/** 错误信息存成“按语言生成文字的函数”，切换语言时已经显示的错误也会跟着变 */
type ErrorText = (t: Messages) => string;

function toErrorText(e: unknown): ErrorText {
  if (e instanceof ModelLoadError) {
    const name = e.fileName;
    return e.code === 'unsupported' ? (t) => t.errUnsupported(name) : (t) => t.errNoMesh;
  }
  if (e instanceof SampleHttpError) {
    const status = e.status;
    return (t) => t.errSampleHttp(status);
  }
  const message = e instanceof Error ? e.message : String(e);
  return () => message;
}


// 没有上传文件时先显示一个示例形状
function sampleGeometry() {
  return new THREE.TorusKnotGeometry(20, 6, 200, 32);
}

const fmt = formatNumber;

const DISPLAY_UNIT_KEY = 'stlviewer.displayUnit';

function initialDisplayUnit(): DisplayUnit {
  try {
    const saved = localStorage.getItem(DISPLAY_UNIT_KEY);
    if (isDisplayUnit(saved)) return saved;
  } catch {
    // localStorage 不可用时用默认值
  }
  return 'mm';
}

export default function App() {
  const { lang, setLang, t } = useLang();
  const otherLang: Lang = lang === 'zh' ? 'en' : 'zh';
  // 文件解析出来的原始几何体（文件坐标，单位未知）
  const [source, setSource] = useState<THREE.BufferGeometry | null>(sampleGeometry);
  const [fileUnit, setFileUnit] = useState<UnitName | null>(null); // 文件自己声明的单位（3MF）
  const [unit, setUnit] = useState<UnitName>('mm'); // 文件里的数字是什么单位
  // 界面上用什么单位显示（只影响显示，内部计算都是毫米），记住用户的选择
  const [displayUnit, setDisplayUnitState] = useState<DisplayUnit>(initialDisplayUnit);
  const setDisplayUnit = (u: DisplayUnit) => {
    setDisplayUnitState(u);
    try {
      localStorage.setItem(DISPLAY_UNIT_KEY, u);
    } catch {
      // 存不了就只在本次生效
    }
  };
  const du = displayUnit;
  // 摆放朝向：每次“放平”都在这个旋转上再叠加一次
  const [orientation, setOrientation] = useState(() => new THREE.Quaternion());
  const [faceNotice, setFaceNotice] = useState(false); // 点到的面已经朝下
  const [fileName, setFileName] = useState<string | null>(null); // null = 默认的环面纽结
  const [info, setInfo] = useState<ModelInfo | null>(null);
  const [error, setError] = useState<ErrorText | null>(null);
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
    setFaceNotice(false);
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
      setError(() => toErrorText(e));
    }
  }, [loadGeometry]);

  // 放平：把点到的面的法线 n 转到正下方 (0, 0, -1)，这个面就贴在平台上了
  const onFacePick = useCallback((n: Vec3) => {
    setPickMode('none');
    if (isFacingDown(n)) {
      // 比如 Benchy 的船底本来就是平的、已经贴在平台上，旋转量是 0，看起来像“没反应”
      setFaceNotice(true);
      return;
    }
    setFaceNotice(false);
    const turn = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(...n).normalize(),
      new THREE.Vector3(0, 0, -1),
    );
    // 不能写 turn.multiply(q)：它会原地修改 turn，而 StrictMode 下这个函数会被调用两次，
    // 第二次就变成 turn·q·q，旋转被叠加了两遍
    setOrientation((q) => new THREE.Quaternion().multiplyQuaternions(turn, q));
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
      if (!res.ok) throw new SampleHttpError(res.status);
      // 包装成 File，复用和“打开文件”完全相同的解析流程
      await openFile(new File([await res.blob()], name));
    } catch (e) {
      setError(() => toErrorText(e));
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
        displayUnit={displayUnit}
      />

      {dragging && <div className="drop-overlay">{t.dropHint}</div>}

      <aside className="panel">
        <div className="lang-switch">
          {/* 一个按钮来回切换，按钮上显示“要切换到的语言”的简称：CN / EN */}
          <button
            className="small"
            lang={otherLang === 'zh' ? 'zh-CN' : 'en'}
            title={MESSAGES[otherLang].switchTo}
            aria-label={MESSAGES[otherLang].switchTo}
            onClick={() => setLang(otherLang)}
          >
            {MESSAGES[otherLang].langName}
          </button>
        </div>
        <h1>STL / OBJ / 3MF Viewer</h1>
        <label className="button">
          {t.openFile}
          <input
            type="file"
            accept=".stl,.obj,.3mf"
            hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) openFile(f); }}
          />
        </label>
        <p className="hint">{t.dragHint}</p>

        <select className="select" value="" disabled={loading} onChange={(e) => openSample(e.target.value)}>
          <option value="">{loading ? t.loading : t.pickSample}</option>
          {SAMPLES.map((f) => (
            <option key={f} value={f}>{t.samples[f]}</option>
          ))}
        </select>

        {error && <p className="error">{error(t)}</p>}

        <h2>{t.model}</h2>
        <dl>
          <dt>{t.file}</dt><dd>{fileName ?? t.defaultModel}</dd>
          {info && (
            <>
              <dt>{t.triangles}</dt><dd>{info.triangles.toLocaleString()}</dd>
              <dt>{t.size}</dt>
              <dd>{formatSize([info.size.x, info.size.y, info.size.z], du)}</dd>
            </>
          )}
        </dl>
        <label className="check">
          <input type="checkbox" checked={showBounds} onChange={(e) => setShowBounds(e.target.checked)} />
          {t.showBounds}
        </label>

        <h2>{t.units}</h2>
        <dl>
          <dt>{t.fileUnit}</dt>
          <dd>
            <select className="select inline" value={unit} onChange={(e) => setUnit(e.target.value as UnitName)}>
              {(Object.keys(UNITS) as UnitName[]).map((u) => (
                <option key={u} value={u}>{t.unitNames[u]}</option>
              ))}
            </select>
          </dd>
          <dt>{t.displayUnit}</dt>
          <dd>
            <select
              className="select inline"
              value={displayUnit}
              onChange={(e) => { if (isDisplayUnit(e.target.value)) setDisplayUnit(e.target.value); }}
            >
              {(Object.keys(DISPLAY_UNITS) as DisplayUnit[]).map((u) => (
                <option key={u} value={u}>{t.displayUnitNames[u]}</option>
              ))}
            </select>
          </dd>
        </dl>
        {/* 把换算过程写出来：文件里的数字 × 单位 = 实际尺寸，避免“选了米数字反而变大”的困惑 */}
        <p className="hint">
          {t.unitConversion(fmt(rawMaxDim, 2), UNITS[unit].symbol, formatLength(rawMaxDim * UNITS[unit].toMm, du))}
        </p>
        {fileUnit ? (
          <p className="hint">{t.unitDeclared(t.unitNames[fileUnit])}</p>
        ) : unitHint && unit === 'mm' ? (
          <p className="warn">
            {t.unitSuspect(fmt(rawMaxDim, 2), t.unitNames[unitHint])}{' '}
            <button className="link" onClick={() => setUnit(unitHint)}>{t.unitConvert(t.unitNames[unitHint])}</button>
          </p>
        ) : (
          unit === 'mm' && <p className="hint">{t.unitNone}</p>
        )}
        <p className="hint">{t.unitExplain}</p>

        <h2>{t.placement}</h2>
        <div className="row">
          <button
            className={`small ${pickMode === 'face' ? 'active' : ''}`}
            onClick={() => { setFaceNotice(false); setPickMode(pickMode === 'face' ? 'none' : 'face'); }}
          >
            {pickMode === 'face' ? t.pickingFace : t.pickFace}
          </button>
          <button
            className="small"
            onClick={() => { setFaceNotice(false); setOrientation(new THREE.Quaternion()); }}
          >
            {t.resetOrientation}
          </button>
        </div>
        {pickMode === 'face' && (
          <p className="hint">{t.pickFaceHint}</p>
        )}
        {faceNotice && <p className="warn">{t.alreadyDown}</p>}

        {analysis && (
          <>
            <h2>{t.meshCheck}</h2>
            {analysis.mesh.watertight ? (
              <p className="ok">{t.watertight}</p>
            ) : (
              <p className="warn">{t.notWatertight}</p>
            )}
            <dl>
              <dt>{t.openEdges}</dt><dd>{analysis.mesh.openEdges.toLocaleString()}</dd>
              <dt>{t.nonManifoldEdges}</dt><dd>{analysis.mesh.nonManifoldEdges.toLocaleString()}</dd>
              <dt>{t.degenerateTriangles}</dt><dd>{analysis.mesh.degenerateTriangles.toLocaleString()}</dd>
            </dl>

            <h2>{t.volumeMaterial}</h2>
            <dl>
              <dt>{t.volume}</dt><dd>{formatVolume(Math.abs(analysis.volume), du)}{analysis.mesh.watertight ? '' : t.forReference}</dd>
              <dt>{t.surfaceArea}</dt><dd>{formatArea(analysis.area, du)}</dd>
              <dt>{t.material}</dt>
              <dd>
                <select className="select inline" value={materialIndex} onChange={(e) => setMaterialIndex(+e.target.value)}>
                  {MATERIALS.map((m, i) => (
                    <option key={m.name} value={i}>{t.withDetail(m.name, `${m.density} g/cm³`)}</option>
                  ))}
                </select>
              </dd>
              <dt>{t.infill}</dt>
              <dd className="range">
                <input type="range" min={0} max={100} step={5} value={infill} onChange={(e) => setInfill(+e.target.value)} />
                {infill}%
              </dd>
              <dt>{t.estimate}</dt><dd>{t.aboutGrams(fmt(grams))}</dd>
            </dl>
            <p className="hint">{t.estimateHint}</p>

            <h2>{t.printer}</h2>
            <select className="select" value={printerIndex} onChange={(e) => setPrinterIndex(+e.target.value)}>
              <option value={-1}>{t.noPrinter}</option>
              {PRINTERS.map((p, i) => (
                <option key={p.name} value={i}>{t.withDetail(p.name, formatSize(p.build, du))}</option>
              ))}
            </select>
            {fit && (fit.fits ? (
              <p className="ok">{t.fits}{fit.needsRotation ? t.fitsRotated : ''}</p>
            ) : (
              <p className="warn">
                {t.doesNotFit}
                {['X', 'Y', 'Z']
                  .map((axis, i) => (fit.overflow[i] > 0 ? t.overflow(axis, formatLength(fit.overflow[i], du)) : null))
                  .filter(Boolean)
                  .join(t.listSep)}
              </p>
            ))}

            <h2>{t.supports}</h2>
            <label className="check">
              <input type="checkbox" checked={overhangOn} onChange={(e) => setOverhangOn(e.target.checked)} />
              {t.highlightOverhang}
            </label>
            {overhangOn && (
              <dl>
                <dt>{t.angleThreshold}</dt>
                <dd className="range">
                  <input type="range" min={20} max={80} value={overhangAngle} onChange={(e) => setOverhangAngle(+e.target.value)} />
                  {overhangAngle}°
                </dd>
                <dt>{t.overhangArea}</dt><dd>{formatArea(overhangArea ?? 0, du)}</dd>
              </dl>
            )}

            <h2>{t.slicePreview}</h2>
            <label className="check">
              <input type="checkbox" checked={sliceOn} onChange={(e) => setSliceOn(e.target.checked)} />
              {t.sliceToggle}
            </label>
            {sliceOn && slice && (
              <>
                <dl>
                  <dt>{t.layerHeight}</dt>
                  <dd>
                    <select className="select inline" value={layerHeight} onChange={(e) => setLayerHeight(+e.target.value)}>
                      {/* 层高是打印机设置，切片软件里一律用毫米，这里不跟着显示单位换算 */}
                    {[0.1, 0.2, 0.3].map((h) => <option key={h} value={h}>{h} mm</option>)}
                    </select>
                  </dd>
                  <dt>{t.layer}</dt>
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
                  <dt>{t.height}</dt><dd>{formatLength(slice.height - analysis.bounds.min[2], du, du === 'mm' ? 2 : 3)}</dd>
                  <dt>{t.sectionArea}</dt><dd>{formatArea(slice.area, du)}</dd>
                  <dt>{t.contours}</dt>
                  <dd>
                    {t.contourCounts(
                      slice.contours.filter((c) => c.closed && c.depth % 2 === 0).length,
                      slice.contours.filter((c) => c.closed && c.depth % 2 === 1).length,
                    )}
                  </dd>
                </dl>
                {slice.openContours > 0 && (
                  <p className="warn">{t.openContours(slice.openContours)}</p>
                )}
                <SliceCanvas contours={slice.contours} bounds={analysis.bounds} />
              </>
            )}

            <h2>{t.measure}</h2>
            <label className="check">
              <input
                type="checkbox"
                checked={pickMode === 'measure'}
                onChange={(e) => setPickMode(e.target.checked ? 'measure' : 'none')}
              />
              {t.measureToggle}
            </label>
            {pickMode === 'measure' && (
              measure?.points === 2 ? (
                <dl>
                  <dt>{t.distance}</dt><dd>{formatLength(measure.distance, du, 2)}</dd>
                  <dt>ΔX / ΔY / ΔZ</dt>
                  <dd>{formatSize(measure.delta, du).replaceAll(' × ', ' / ')}</dd>
                </dl>
              ) : (
                <p className="hint">{measure?.points === 1 ? t.measureSecond : t.measureFirst}</p>
              )
            )}
          </>
        )}

        <p className="hint">{t.controlsHint}</p>
      </aside>
    </div>
  );
}
