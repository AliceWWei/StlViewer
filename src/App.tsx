import { useCallback, useState, type DragEvent } from 'react';
import * as THREE from 'three';
import { ViewerCanvas } from './components/ViewerCanvas';
import { parseModel } from './viewer/loadModel';
import type { ModelInfo } from './viewer/Viewer';

// 放在 public/samples 里的示例模型。BASE_URL 在本地是 /，部署到 GitHub Pages 后是 /StlViewer/
const SAMPLES = [
  { file: '3DBenchy.stl', label: '3DBenchy 小船（3D 打印测试模型）' },
  { file: 'gear.stl', label: '齿轮' },
  { file: 'teapot.stl', label: '犹他茶壶' },
  { file: 'vase.stl', label: '花瓶' },
  { file: 'box.stl', label: '长方体 20×10×30' },
];

// 没有上传文件时先显示一个示例形状
function sampleGeometry() {
  return new THREE.TorusKnotGeometry(20, 6, 200, 32);
}

export default function App() {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(sampleGeometry);
  const [fileName, setFileName] = useState('示例：环面纽结');
  const [info, setInfo] = useState<ModelInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const openFile = useCallback(async (file: File) => {
    setError(null);
    try {
      setGeometry(await parseModel(file));
      setFileName(file.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const [loading, setLoading] = useState(false);

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

  return (
    <div
      className={`app ${dragging ? 'dragging' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <ViewerCanvas geometry={geometry} onModelInfo={setInfo} />

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

        <select
          className="select"
          value=""
          disabled={loading}
          onChange={(e) => openSample(e.target.value)}
        >
          <option value="">{loading ? '加载中…' : '或者选一个示例模型…'}</option>
          {SAMPLES.map((s) => (
            <option key={s.file} value={s.file}>{s.label}</option>
          ))}
        </select>

        {error && <p className="error">{error}</p>}

        <dl>
          <dt>文件</dt><dd>{fileName}</dd>
          {info && (
            <>
              <dt>三角形</dt><dd>{info.triangles.toLocaleString()}</dd>
              <dt>尺寸 (X × Y × Z)</dt>
              <dd>
                {info.size.x.toFixed(1)} × {info.size.y.toFixed(1)} × {info.size.z.toFixed(1)}
              </dd>
            </>
          )}
        </dl>
        <p className="hint">左键旋转 · 滚轮缩放 · 右键平移</p>
      </aside>
    </div>
  );
}
