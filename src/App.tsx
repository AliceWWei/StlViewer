import { useCallback, useState, type DragEvent } from 'react';
import * as THREE from 'three';
import { ViewerCanvas } from './components/ViewerCanvas';
import { parseModel } from './viewer/loadModel';
import type { ModelInfo } from './viewer/Viewer';

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
