import { useEffect, useRef } from 'react';
import type * as THREE from 'three';
import { Viewer, type MeasureResult, type ModelInfo, type PickMode } from '../viewer/Viewer';
import type { Contour } from '../viewer/slice';
import type { Vec3 } from '../viewer/geometry';

interface Props {
  geometry: THREE.BufferGeometry | null;
  onModelInfo: (info: ModelInfo) => void;
  overhang: { enabled: boolean; maxAngle: number };
  showBounds: boolean;
  printer: { build: Vec3; fits: boolean } | null;
  pickMode: PickMode;
  onMeasure: (result: MeasureResult | null) => void;
  onFacePick: (normal: Vec3) => void;
  slice: { height: number; contours: Contour[] } | null;
}

/**
 * React 和 Three.js 的“桥”：
 * - 挂载时创建 Viewer，卸载时 dispose（避免 WebGL 上下文泄漏）
 * - props 变化时调用 Viewer 对应的方法，渲染细节都留在 Viewer 里
 */
export function ViewerCanvas(props: Props) {
  const { geometry, onModelInfo, overhang, showBounds, printer, pickMode, onMeasure, onFacePick, slice } = props;
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
    if (viewerRef.current) viewerRef.current.onFacePick = onFacePick;
  }, [onFacePick]);

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
    viewerRef.current?.setPickMode(pickMode);
  }, [pickMode]);

  // 放在 geometry 的 effect 后面：换模型时 setGeometry 会清掉切片，这里再按当前状态画上
  useEffect(() => {
    viewerRef.current?.setSlice(slice?.height ?? null, slice?.contours ?? []);
  }, [slice, geometry]);

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
