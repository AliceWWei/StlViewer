import { useEffect, useRef } from 'react';
import type * as THREE from 'three';
import { Viewer, type MeasureResult, type ModelInfo } from '../viewer/Viewer';
import type { Vec3 } from '../viewer/geometry';

interface Props {
  geometry: THREE.BufferGeometry | null;
  onModelInfo: (info: ModelInfo) => void;
  overhang: { enabled: boolean; maxAngle: number };
  showBounds: boolean;
  printer: { build: Vec3; fits: boolean } | null;
  measureMode: boolean;
  onMeasure: (result: MeasureResult | null) => void;
}

/**
 * React 和 Three.js 的“桥”：
 * - 挂载时创建 Viewer，卸载时 dispose（避免 WebGL 上下文泄漏）
 * - props 变化时调用 Viewer 对应的方法，渲染细节都留在 Viewer 里
 */
export function ViewerCanvas(props: Props) {
  const { geometry, onModelInfo, overhang, showBounds, printer, measureMode, onMeasure } = props;
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
    if (viewerRef.current) viewerRef.current.onMeasure = onMeasure;
  }, [onMeasure]);

  useEffect(() => {
    if (geometry && viewerRef.current) {
      onModelInfo(viewerRef.current.setGeometry(geometry));
    }
  }, [geometry, onModelInfo]);

  useEffect(() => {
    viewerRef.current?.setOverhang(overhang.enabled, overhang.maxAngle);
  }, [overhang.enabled, overhang.maxAngle]);

  useEffect(() => {
    viewerRef.current?.setShowBounds(showBounds);
  }, [showBounds, geometry]);

  const build = printer?.build;
  const fits = printer?.fits ?? true;
  useEffect(() => {
    viewerRef.current?.setPrinter(build ?? null, fits);
  }, [build, fits]);

  useEffect(() => {
    viewerRef.current?.setMeasureMode(measureMode);
  }, [measureMode]);

  // 按 Esc 清除测量
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') viewerRef.current?.clearMeasure();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return <div ref={containerRef} className="viewer" />;
}
