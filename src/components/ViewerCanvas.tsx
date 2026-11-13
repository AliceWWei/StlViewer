import { useEffect, useRef } from 'react';
import type * as THREE from 'three';
import { Viewer, type ModelInfo } from '../viewer/Viewer';

interface Props {
  geometry: THREE.BufferGeometry | null;
  onModelInfo: (info: ModelInfo) => void;
}

/**
 * React 和 Three.js 的“桥”：
 * - 挂载时创建 Viewer，卸载时 dispose（避免 WebGL 上下文泄漏）
 * - geometry 变化时交给 Viewer 显示
 */
export function ViewerCanvas({ geometry, onModelInfo }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);

  useEffect(() => {
    const viewer = new Viewer(containerRef.current!);
    viewerRef.current = viewer;
    return () => {
      viewer.dispose();
      viewerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (geometry && viewerRef.current) {
      onModelInfo(viewerRef.current.setGeometry(geometry));
    }
  }, [geometry, onModelInfo]);

  return <div ref={containerRef} className="viewer" />;
}
