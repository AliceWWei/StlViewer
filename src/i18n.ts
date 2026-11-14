/**
 * 界面文字的中英文对照表。
 * Messages 类型由中文表推导出来，英文表必须实现同一个类型，
 * 少写一个 key 或参数类型不对都会直接编译报错。
 */
import { useCallback, useEffect, useState } from 'react';
import type { DisplayUnit, UnitName } from './viewer/units';

export type Lang = 'zh' | 'en';

const zh = {
  /** 切换按钮上显示的语言简称 */
  langName: 'CN',
  switchTo: '切换到中文',
  dropHint: '松开以加载模型',
  openFile: '打开文件',
  dragHint: '也可以直接把文件拖进窗口',
  desktopOpenHint: '，或者按 Ctrl+O',
  loading: '加载中…',
  pickSample: '或者选一个示例模型…',
  samples: {
    '3DBenchy.stl': '3DBenchy 小船（3D 打印测试模型）',
    'gear.stl': '齿轮',
    'teapot.stl': '犹他茶壶',
    'vase.stl': '花瓶（单层曲面，不封闭）',
    'box.stl': '长方体 20×10×30',
    'bracket.3mf': 'L 形支架（3MF，试试“放平”）',
    'gear-inch.stl': '齿轮（英寸单位导出的 STL）',
    'voron-cube.stl': 'Voron 校准方块（尺寸、悬垂、桥接）',
    'heatset-practice.stl': 'Voron 热熔螺母练习块',
    'chain-loop.3mf': '十二面体链条（3MF，免组装的活动件）',
    'prusa-extruder-body.stl': 'Prusa i3 MK3 挤出机主体',
    'prusa-fan-shroud.stl': 'Prusa i3 MK3 风扇导风罩（悬垂多）',
    'prusa-spool-holder.stl': 'Prusa i3 MK3 料盘架',
    'cube-gears.3mf': '一组齿轮零件（3MF，多个零件）',
    'heart-gears.3mf': '心形齿轮（3MF，多个零件）',
    'spot.stl': 'Spot 奶牛（有机曲面）',
  },
  sampleGroups: {
    testPrints: '打印测试',
    functional: '功能零件',
    organic: '曲面模型',
    demo: '功能演示',
  },
  defaultModel: '示例：环面纽结',

  errUnsupported: (name: string) => `不支持的文件格式：${name}（只支持 .stl / .obj / .3mf）`,
  errNoMesh: '文件里没有找到网格',
  errSampleHttp: (status: number) => `下载示例失败：HTTP ${status}`,

  model: '模型',
  file: '文件',
  triangles: '三角形',
  size: '尺寸',
  showBounds: '显示包围盒和尺寸',

  units: '单位',
  fileUnit: '文件里的数字单位',
  displayUnit: '显示单位',
  displayUnitNames: {
    mm: '毫米 mm',
    cm: '厘米 cm',
    inch: '英寸 in',
  } satisfies Record<DisplayUnit, string>,
  unitNames: {
    mm: '毫米 mm',
    cm: '厘米 cm',
    m: '米 m',
    inch: '英寸 inch',
    um: '微米 µm',
  } satisfies Record<UnitName, string>,
  unitDeclared: (unit: string) => `3MF 文件声明了单位：${unit}，已自动换算`,
  unitSuspect: (raw: string, unit: string) =>
    `文件里模型的最大尺寸是 ${raw}，按毫米理解大小不太正常，可能是用${unit}导出的。`,
  unitConversion: (raw: string, symbol: string, converted: string) =>
    `最大尺寸：文件里的 ${raw} ${symbol} = ${converted}`,
  unitExplain: '文件里的数字先按上面的单位换算，再按「显示单位」显示所有尺寸、面积和体积',
  unitConvert: (unit: string) => `按${unit}换算`,
  unitNone: 'STL / OBJ 不带单位，默认按毫米理解，不对的话在上面改',

  placement: '摆放',
  pickFace: '选一个面放平',
  pickingFace: '点击模型上的一个面…',
  resetOrientation: '恢复原始朝向',
  pickFaceHint: '鼠标移到模型上，黄色高亮的那一片会被放到平台上（曲面取这一片的平均朝向）',
  alreadyDown: '这个面已经朝下贴在平台上了，不需要再放平',

  meshCheck: '网格检查',
  watertight: '✓ 表面封闭（水密），可以切片',
  notWatertight: '⚠ 表面不封闭，体积和切片结果不可靠',
  openEdges: '破洞边',
  nonManifoldEdges: '非流形边',
  degenerateTriangles: '退化三角形',
  repairMesh: '修复网格',
  exportStl: '导出 STL',
  repairNothing: '✓ 没有发现需要修复的问题',
  repairDone: '✓ 修复完成：',
  repairDegenerate: (n: string) => `删除 ${n} 个退化三角形`,
  repairDuplicate: (n: string) => `删除 ${n} 个重复三角形`,
  repairFlipped: (n: string) => `翻转 ${n} 个方向不对的三角形`,
  repairFilled: (holes: string, tris: string) => `补了 ${holes} 个洞（新增 ${tris} 个三角形）`,
  repairSkipped: (n: string) => `⚠ ${n} 个洞太大，自动补可能补错形状，建议回到原模型修改`,
  repairWelded: (from: string, to: string) => `顶点焊接：${from} → ${to}`,
  exportHint: '导出的是当前看到的模型：单位为毫米，包含“放平”后的朝向。',

  volumeMaterial: '体积与用料',
  volume: '体积',
  forReference: '（仅供参考）',
  surfaceArea: '表面积',
  material: '材料',
  infill: '填充率',
  estimate: '估算用料',
  aboutGrams: (g: string) => `约 ${g} g`,
  estimateHint: '按外壳 0.8 mm + 内部填充粗略估算，精确值以切片软件为准',

  printer: '打印机',
  noPrinter: '不显示成型空间',
  fits: '✓ 放得下',
  fitsRotated: '（需要在平台上转 90°）',
  doesNotFit: '✗ 放不下：',
  overflow: (axis: string, length: string) => `${axis} 超出 ${length}`,
  listSep: '，',
  /** 下拉选项“名称（补充说明）”，中文用全角括号 */
  withDetail: (name: string, detail: string) => `${name}（${detail}）`,

  wallThickness: '壁厚分析',
  analyzeThickness: '分析壁厚（标出太薄的地方）',
  minWall: '最小壁厚',
  thicknessView: '显示方式',
  heatmap: '热力图',
  passFail: '只分够厚 / 太薄',
  analyzing: (percent: number) => `分析中… ${percent}%`,
  thinnest: '最薄处',
  thinArea: '太薄的面积',
  unmeasured: '没测到的三角形',
  unmeasuredShort: '没测到',
  thickEnoughShort: '够厚',
  thinWarning: (min: string) => `⚠ 红色区域比 ${min} 薄，可能打不出来或者容易断`,
  thickEnough: '✓ 所有地方都够厚',
  thicknessOpenMesh: '⚠ 表面不封闭，分不清哪边是模型里面，壁厚结果不可靠（可以先“修复网格”）',
  thicknessExplain: '从每个面往模型里面发几条射线，量到对面的距离，取中位数作为这里的厚度。很大的三角形只在中心测一次；不封闭的模型有些地方测不到（灰色）。',

  supports: '支撑分析',
  highlightOverhang: '高亮需要支撑的悬垂面',
  angleThreshold: '角度阈值',
  overhangArea: '悬垂面积',

  slicePreview: '切片预览',
  sliceToggle: '逐层查看截面',
  layerHeight: '层高',
  layer: '层',
  height: '高度',
  sectionArea: '截面面积',
  contours: '轮廓',
  contourCounts: (solids: number, holes: number) => `${solids} 个实体，${holes} 个孔`,
  openContours: (n: number) => `⚠ 有 ${n} 条轮廓没闭合（红色），说明这一层附近网格有破洞`,

  measure: '测量',
  measureToggle: '两点测距（点击模型表面）',
  distance: '距离',
  measureFirst: '点第一个点，按 Esc 清除',
  measureSecond: '再点第二个点，按 Esc 清除',

  controlsHint: '左键旋转 · 滚轮缩放 · 右键平移',
};

export type Messages = typeof zh;

const en: Messages = {
  langName: 'EN',
  switchTo: 'Switch to English',
  dropHint: 'Drop to load the model',
  openFile: 'Open file',
  dragHint: 'You can also drag a file into the window',
  desktopOpenHint: ', or press Ctrl+O',
  loading: 'Loading…',
  pickSample: 'Or pick a sample model…',
  samples: {
    '3DBenchy.stl': '3DBenchy boat (3D printing test model)',
    'gear.stl': 'Gear',
    'teapot.stl': 'Utah teapot',
    'vase.stl': 'Vase (single-wall surface, not closed)',
    'box.stl': 'Box 20×10×30',
    'bracket.3mf': 'L-bracket (3MF, try "Lay flat")',
    'gear-inch.stl': 'Gear (STL exported in inches)',
    'voron-cube.stl': 'Voron calibration cube (size, overhangs, bridges)',
    'heatset-practice.stl': 'Voron heat-set insert practice block',
    'chain-loop.3mf': 'Dodecahedron chain (3MF, print-in-place)',
    'prusa-extruder-body.stl': 'Prusa i3 MK3 extruder body',
    'prusa-fan-shroud.stl': 'Prusa i3 MK3 fan shroud (lots of overhangs)',
    'prusa-spool-holder.stl': 'Prusa i3 MK3 spool holder',
    'cube-gears.3mf': 'Set of gear parts (3MF, multiple parts)',
    'heart-gears.3mf': 'Heart gears (3MF, multiple parts)',
    'spot.stl': 'Spot the cow (organic surface)',
  },
  sampleGroups: {
    testPrints: 'Test prints',
    functional: 'Functional parts',
    organic: 'Organic shapes',
    demo: 'Feature demos',
  },
  defaultModel: 'Sample: torus knot',

  errUnsupported: (name) => `Unsupported file format: ${name} (only .stl / .obj / .3mf)`,
  errNoMesh: 'No mesh found in the file',
  errSampleHttp: (status) => `Failed to download sample: HTTP ${status}`,

  model: 'Model',
  file: 'File',
  triangles: 'Triangles',
  size: 'Size',
  showBounds: 'Show bounding box and dimensions',

  units: 'Units',
  fileUnit: 'Units used in the file',
  displayUnit: 'Display units',
  displayUnitNames: {
    mm: 'Millimeters (mm)',
    cm: 'Centimeters (cm)',
    inch: 'Inches (in)',
  },
  unitNames: {
    mm: 'Millimeters (mm)',
    cm: 'Centimeters (cm)',
    m: 'Meters (m)',
    inch: 'Inches (inch)',
    um: 'Micrometers (µm)',
  },
  unitDeclared: (unit) => `The 3MF file declares its unit: ${unit}, converted automatically`,
  unitSuspect: (raw, unit) =>
    `The largest size in the file is ${raw}, an unusual size if read as millimeters. It may have been exported in ${unit}.`,
  unitConversion: (raw, symbol, converted) => `Largest size: ${raw} ${symbol} in the file = ${converted}`,
  unitExplain: 'Numbers in the file are converted using the unit above; all sizes, areas and volumes are then shown in the display units',
  unitConvert: (unit) => `Convert from ${unit}`,
  unitNone: 'STL / OBJ files carry no unit; millimeters are assumed. Change it above if that is wrong',

  placement: 'Placement',
  pickFace: 'Pick a face to lay flat',
  pickingFace: 'Click a face on the model…',
  resetOrientation: 'Reset orientation',
  pickFaceHint:
    'Hover over the model: the highlighted yellow area will be placed on the bed (curved areas use their average direction)',
  alreadyDown: 'This face already faces down on the bed; nothing to lay flat',

  meshCheck: 'Mesh check',
  watertight: '✓ Surface is closed (watertight), ready to slice',
  notWatertight: '⚠ Surface is not closed; volume and slicing results are unreliable',
  openEdges: 'Open edges',
  nonManifoldEdges: 'Non-manifold edges',
  degenerateTriangles: 'Degenerate triangles',
  repairMesh: 'Repair mesh',
  exportStl: 'Export STL',
  repairNothing: '✓ Nothing to repair',
  repairDone: '✓ Repaired:',
  repairDegenerate: (n) => `removed ${n} degenerate triangles`,
  repairDuplicate: (n) => `removed ${n} duplicate triangles`,
  repairFlipped: (n) => `flipped ${n} inverted triangles`,
  repairFilled: (holes, tris) => `filled ${holes} holes (${tris} new triangles)`,
  repairSkipped: (n) => `⚠ ${n} holes are too large to fill reliably; fix them in the original model`,
  repairWelded: (from, to) => `Vertices welded: ${from} → ${to}`,
  exportHint: 'Exports the model as shown: in millimetres, including any lay-flat rotation.',

  volumeMaterial: 'Volume & material',
  volume: 'Volume',
  forReference: ' (approximate)',
  surfaceArea: 'Surface area',
  material: 'Material',
  infill: 'Infill',
  estimate: 'Estimated material',
  aboutGrams: (g) => `≈ ${g} g`,
  estimateHint: 'Rough estimate: 0.8 mm shell + infill. Your slicer gives the exact amount',

  printer: 'Printer',
  noPrinter: 'Hide build volume',
  fits: '✓ Fits',
  fitsRotated: ' (rotate 90° on the bed)',
  doesNotFit: '✗ Does not fit: ',
  overflow: (axis, length) => `${axis} over by ${length}`,
  listSep: ', ',
  withDetail: (name, detail) => `${name} (${detail})`,

  wallThickness: 'Wall thickness',
  analyzeThickness: 'Analyze wall thickness (mark thin areas)',
  minWall: 'Minimum wall',
  thicknessView: 'View',
  heatmap: 'Heatmap',
  passFail: 'Pass / fail',
  analyzing: (percent) => `Analyzing… ${percent}%`,
  thinnest: 'Thinnest',
  thinArea: 'Thin area',
  unmeasured: 'Unmeasured triangles',
  unmeasuredShort: 'not measured',
  thickEnoughShort: 'OK',
  thinWarning: (min) => `⚠ Red areas are thinner than ${min} and may not print or may break`,
  thickEnough: '✓ Every wall is thick enough',
  thicknessOpenMesh: '⚠ The surface is not closed, so inside and outside are ambiguous; thickness results are unreliable (try Repair mesh first)',
  thicknessExplain: 'A few rays go from each face into the model; the median distance to the other side is the thickness there. Large triangles are measured once at their centre; open meshes leave some areas unmeasured (grey).',

  supports: 'Support analysis',
  highlightOverhang: 'Highlight overhangs that need support',
  angleThreshold: 'Angle threshold',
  overhangArea: 'Overhang area',

  slicePreview: 'Slice preview',
  sliceToggle: 'View cross-sections layer by layer',
  layerHeight: 'Layer height',
  layer: 'Layer',
  height: 'Height',
  sectionArea: 'Section area',
  contours: 'Contours',
  contourCounts: (solids, holes) =>
    `${solids} solid${solids === 1 ? '' : 's'}, ${holes} hole${holes === 1 ? '' : 's'}`,
  openContours: (n) =>
    `⚠ ${n} contour${n === 1 ? ' is' : 's are'} not closed (red): the mesh has holes near this layer`,

  measure: 'Measure',
  measureToggle: 'Measure distance (click two points)',
  distance: 'Distance',
  measureFirst: 'Click the first point; Esc to clear',
  measureSecond: 'Click the second point; Esc to clear',

  controlsHint: 'Left-drag to rotate · Scroll to zoom · Right-drag to pan',
};

export const MESSAGES: Record<Lang, Messages> = { zh, en };

const STORAGE_KEY = 'stlviewer.lang';

/** 默认语言：先看上次的选择，再看浏览器语言（中文系统用中文，其它用英文） */
export function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'zh' || saved === 'en') return saved;
  } catch {
    // 隐私模式等情况下 localStorage 可能不可用，忽略
  }
  const nav = typeof navigator !== 'undefined' ? navigator.language : '';
  return nav.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

/** 当前语言 + 对应的文字表；切换时记住选择，并同步 <html lang> */
export function useLang() {
  const [lang, setLangState] = useState<Lang>(initialLang);
  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  }, [lang]);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // 存不了就只在本次生效
    }
  }, []);
  return { lang, setLang, t: MESSAGES[lang] };
}
