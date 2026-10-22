"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Stage, Layer as KLayer, Rect as KRect, Line as KLine, Image as KImage, Text as KText, Circle as KCircle, Ellipse as KEllipse, Transformer as KTransformer } from "react-konva";
import Konva from "konva";
import dynamic from "next/dynamic";
import Link from "next/link";
import Ruler from "./Ruler";
import { DOC_W, DOC_H, DEFAULT_ADJUST, ADJUST_GROUPS, BLEND_TO_COMPOSITE, BLEND_MODES } from "./types";
import type { Layer, Tool, StepEntry, BlendMode, ColorAdjust, ShapeNode } from "./types";
import { applyColorGrade, isDefaultAdjust } from "./colorGrade";
import ColorWheelPicker from "./ColorWheelPicker";
import ApiAgent, { type ImageSource } from "./ApiAgent";
import { magicWand, lasso, rectSelection, ellipseSelection, fillSelection, extractSelection, selectionToCanvas, type Selection } from "./selection";
import { samEmbed, samPredict, samComposite, samSegmentAll, samExtractRegion, samClearCache, type SamPoint, type SamRegion } from "./sam";
import { loadProjectState, saveProjectState, hydrateProjectState } from "@/lib/autosave";

// 注册自定义调色滤镜（Konva.Filters.ColorGrade），模块只加载一次
if (!(Konva as any).Filters.ColorGrade) {
  (Konva as any).Filters.ColorGrade = function (this: any, imageData: ImageData) {
    // 自定义 attr 没有自动 getter（如 this.colorAdjust()），必须用 attr()/getAttr() 读
    const adj = this.getAttr?.("colorAdjust") ?? this.attr?.("colorAdjust");
    if (adj) applyColorGrade(imageData, adj);
  };
}

const KonvaStage = dynamic(() => import("react-konva").then(m => m.Stage), { ssr: false });

function UseImage(src: string | undefined) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!src) return;
    const i = new window.Image();
    i.crossOrigin = "anonymous";
    i.onload = () => setImg(i);
    i.src = src;
  }, [src]);
  return img;
}

function ImageShape({ s, forceSize, extra }: { s: any; forceSize?: { w: number; h: number }; extra?: any }) {
  const img = UseImage(s.src);
  if (!img) return null;
  const w = forceSize ? forceSize.w : s.w;
  const h = forceSize ? forceSize.h : s.h;
  return <KImage image={img} x={s.x} y={s.y} width={w} height={h} {...(extra ?? {})} />;
}

const TOOLS: { id: Tool; label: string; icon: string }[] = [
  { id: "move", label: "移动", icon: "✥" },
  { id: "brush", label: "画笔", icon: "✎" },
  { id: "eraser", label: "橡皮", icon: "◱" },
  { id: "fill", label: "油漆桶（填充选区/图层）", icon: "⬒" },
  { id: "text", label: "文字", icon: "T" },
  { id: "wand", label: "魔棒（按颜色选区）", icon: "⚡" },
  { id: "lasso", label: "套索（手绘选区）", icon: "◌" },
  { id: "rect", label: "矩形选区", icon: "▭" },
  { id: "ellipse", label: "椭圆选区", icon: "◯" },
  { id: "sam", label: "SAM 分割（点选物体）", icon: "⌁" },
];

const STEPS: StepEntry[] = [
  { id: "s1", label: "生成水墨底图", by: "AI", status: "accepted", time: "14:02" },
  { id: "s2", label: "扩展画布 16:9", by: "AI", status: "accepted", time: "14:05" },
  { id: "s3", label: "手动调整主峰位置", by: "你", status: "accepted", time: "14:09" },
  { id: "s4", label: "局部重绘 · 雾气", by: "AI", status: "pending", time: "14:12" },
];

const CHECKER =
  "repeating-conic-gradient(oklch(0.22 0.005 260) 0% 25%, oklch(0.16 0.005 260) 0% 50%) 0 / 16px 16px";

export default function Workbench({ id, title, cover, docSize: initialDocSize }: { id: string; title: string; cover: string; docSize?: { w: number; h: number } }) {
  const [zoom, setZoom] = useState(0.42);
  const [scroll, setScroll] = useState({ x: 0, y: 0 });
  const [tool, setTool] = useState<Tool>("brush");
  const [layers, setLayers] = useState<Layer[]>(() => {
    // 先恢复自动保存的进度（如有），否则用默认底图
    const saved = loadProjectState(id);
    if (saved) return saved.layers;
    // 只有水墨 demo 项目带预置图层，其他项目只有底图
    if (id === "ink") {
      return [
        { id: "L1", name: "水墨底图", visible: true, opacity: 1, shapes: [{ kind: "image", x: 0, y: 0, w: DOC_W, h: DOC_H, src: cover, opacity: 1 }] },
        { id: "L2", name: "雾气 · 重绘", visible: true, opacity: 0.4, shapes: [{ kind: "rect", x: 200, y: 560, w: 1000, h: 300, fill: "rgba(245,243,238,0.55)", opacity: 1, cornerRadius: 140 }] },
        { id: "L3", name: "主峰标注", visible: true, opacity: 1, shapes: [{ kind: "text", x: 640, y: 300, text: "主峰", fontSize: 48, fill: "#1c1a17", stroke: "rgba(255,255,255,0.7)", strokeWidth: 1.5, opacity: 1 }] },
      ];
    }
    // 空白画布（无 cover）：白色背景 rect；否则底图 image
    const iw = initialDocSize?.w ?? DOC_W;
    const ih = initialDocSize?.h ?? DOC_H;
    const baseShape: ShapeNode = cover
      ? { kind: "image", x: 0, y: 0, w: iw, h: ih, src: cover, opacity: 1 }
      : { kind: "rect", x: 0, y: 0, w: iw, h: ih, fill: "#ffffff", opacity: 1, cornerRadius: 0 };
    return [
      { id: "L1", name: cover ? "底图" : "背景", visible: true, opacity: 1, shapes: [baseShape] },
    ];
  });
  const [activeLayer, setActiveLayer] = useState(() => {
    const saved = loadProjectState(id);
    return saved?.activeLayer && saved.layers.some(l => l.id === saved.activeLayer)
      ? saved.activeLayer
      : id === "ink" ? "L3" : "L1";
  });
  const [brushes, setBrushes] = useState<Record<string, { points: number[]; color: string; width: number }>>({});
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [strokes, setStrokes] = useState<Record<string, number[]>>({});
  const stageRef = useRef<any>(null);
  const overlayRef = useRef<any>(null);
  const drawing = useRef(false);
  const pointRef = useRef<number[]>([]);
  const vpRef = useRef<HTMLDivElement>(null);
  const [viewSize, setViewSize] = useState({ w: 900, h: 560 });
  const [docSize, setDocSize] = useState(() => {
    const saved = loadProjectState(id);
    if (saved?.docSize && saved.docSize.w > 0 && saved.docSize.h > 0) return saved.docSize;
    if (initialDocSize && initialDocSize.w > 0 && initialDocSize.h > 0) return initialDocSize;
    return { w: DOC_W, h: DOC_H };
  });

  // 画布尺寸对话框（PS 式：裁剪 = 画布大小，拉伸 = 图像大小）
  const [resizeOpen, setResizeOpen] = useState(false);
  const [rw, setRw] = useState("");
  const [rh, setRh] = useState("");
  const [resizeMode, setResizeMode] = useState<"crop" | "stretch">("crop");

  // 拖拽新建项目（d 前缀）：文档尺寸 + 底图跟随图片真实长宽比（demo 项目保持 DOC_W/DOC_H）
  useEffect(() => {
    if (!id.startsWith("d")) return;
    if (loadProjectState(id)) return; // 已有自动保存的进度：跳过重新规范化，避免覆盖扩展后的画布尺寸
    const i = new window.Image();
    i.onload = () => {
      const w = i.naturalWidth, h = i.naturalHeight;
      if (!w || !h) return;
      // canvas 规范化：烘焙 EXIF 方向，确保宽高与像素内容一致（手机照片常有旋转元数据）
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d")!.drawImage(i, 0, 0);
      const normalized = c.toDataURL("image/png");
      setDocSize({ w, h });
      setLayers(ls => ls.map(l => {
        if (l.id !== "L1") return l;
        return { ...l, shapes: l.shapes.map(s => (s.kind === "image" ? { ...s, src: normalized, w, h } : s)) };
      }));
    };
    i.src = cover;
  }, [id, cover]);

  // 自动保存：每次编辑（layers/docSize/activeLayer 变化）后 debounce 写入 localStorage
  useEffect(() => {
    const t = setTimeout(() => {
      saveProjectState(id, { layers, docSize, activeLayer }).then(ok => {
        if (!ok) setMattingError("自动保存失败：项目过大，超出浏览器本地存储上限，请导出备份");
      });
    }, 600);
    return () => clearTimeout(t);
  }, [layers, docSize, activeLayer, id]);

  // 初始加载：存档里的大图是 "idb:" 引用 → 异步水合回真实 dataURL 再渲染
  const hydratedRef = useRef(false);
  useEffect(() => {
    const saved = loadProjectState(id);
    if (!saved || hydratedRef.current) return;
    if (!JSON.stringify(saved.layers).includes("idb:")) return;
    let alive = true;
    hydrateProjectState(saved).then(h => { if (alive) { hydratedRef.current = true; setLayers(h.layers); } });
    return () => { alive = false; };
  }, [id]);

  const [selection, setSelection] = useState<Selection | null>(null);
  const [selCanvas, setSelCanvas] = useState<HTMLCanvasElement | null>(null);
  const [fillColor, setFillColor] = useState("#3c9be8");
  const [brushColor, setBrushColor] = useState("#1c1a17");
  const [brushSize, setBrushSize] = useState(8);
  const [brushOpacity, setBrushOpacity] = useState(1);
  const [aiBusy, setAiBusy] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [mattingError, setMattingError] = useState<string | null>(null);
  // 文字工具：点击画布 → 弹输入浮层；edit=正在重编辑已有文字（保留位置/变换）
  const [textDraft, setTextDraft] = useState<{ x: number; y: number; edit?: { layer: string; index: number } } | null>(null);
  const [textInput, setTextInput] = useState("");
  const [textFontSize, setTextFontSize] = useState(48);
  const [textColor, setTextColor] = useState("#ffffff");
  // 选中的画布素材（move 工具下点选，任意类型：文字/图片/矩形/线）→ Transformer 自由变换
  const [selShape, setSelShape] = useState<{ layer: string; index: number } | null>(null);
  const selShapeRef = useRef(selShape);
  selShapeRef.current = selShape;
  // 等比例变换开关（仿 PS：默认等比；Konva Transformer 原生支持拖动中按 Shift 临时反转）
  const [keepRatio, setKeepRatio] = useState(true);
  const transformerRef = useRef<any>(null);
  const [wandTol, setWandTol] = useState(32);
  const [wandClicks, setWandClicks] = useState(0);
  const [lassoLive, setLassoLive] = useState<{ x: number; y: number }[]>([]);
  const [dragSel, setDragSel] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  // SAM 交互态：累积的点、实时 mask 预览
  const [samPoints, setSamPoints] = useState<SamPoint[]>([]);
  const [samMask, setSamMask] = useState<HTMLCanvasElement | null>(null);
  // 全景分割态：彩色叠图 + 元素列表 + 进度
  const [samOverlay, setSamOverlay] = useState<HTMLCanvasElement | null>(null);
  const [samRegions, setSamRegions] = useState<SamRegion[]>([]);
  const [samAllBusy, setSamAllBusy] = useState<{ done: number; total: number } | null>(null);
  const samBaseRef = useRef<{ canvas: HTMLCanvasElement; x: number; y: number; layerId: string } | null>(null);
  const lassoPts = useRef<{ x: number; y: number }[]>([]);
  const undoStack = useRef<{ layers: Layer[]; docSize: { w: number; h: number } }[]>([]);
  const redoStack = useRef<{ layers: Layer[]; docSize: { w: number; h: number } }[]>([]);
  const [undoCount, setUndoCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);
  // undo/redo 需读「当前」layers 压栈；keydown 闭包可能拿到旧 layers，用 ref 存最新值
  const layersRef = useRef(layers);
  layersRef.current = layers;
  const docSizeRef = useRef(docSize);
  docSizeRef.current = docSize;
  // 每个图层的 Konva.Layer 节点引用（调色滤镜 cache 用）
  const layerRefs = useRef<Record<string, Konva.Layer>>({});
  // 平移（PS 式）：空格+拖拽 或 中键拖拽
  const [spaceDown, setSpaceDown] = useState(false);
  const pan = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  // zoom/scroll 的同步真相源：连续 wheel 事件间 React 来不及重渲染，
  // 若 setScroll 读闭包旧 scroll 而 setZoom 拿函数式新 z，两者错位会累积漂移。
  const zoomRef = useRef(zoom);
  const scrollRef = useRef(scroll);
  zoomRef.current = zoom;
  scrollRef.current = scroll;

  const viewW = viewSize.w, viewH = viewSize.h;
  const originX = scroll.x - viewW / 2;
  const originY = scroll.y - viewH / 2;

  const fitView = useCallback(() => {
    const z = Math.min(viewW / docSize.w, viewH / docSize.h) * 0.9;
    setZoom(z);
    setScroll({ x: docSize.w / 2, y: docSize.h / 2 });
  }, [viewW, viewH, docSize.w, docSize.h]);
  useEffect(() => { fitView(); }, [fitView]);

  // 测量画布视口实际尺寸
  useEffect(() => {
    const el = vpRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setViewSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // 滚轮缩放 + Esc 取消选区
  useEffect(() => {
    const el = vpRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.button === 1) return; // 中键滚轮：交给平移，不缩放
      e.preventDefault();
      // 视口中心锚点缩放：只改 zoom、scroll 不动，画面围绕视口中心稳定缩放。
      // （光标锚点会让画面围绕光标缩放，光标偏离中心时画面持续漂移，zoom 越大越明显）
      const z = zoomRef.current;
      const nz = Math.min(8, Math.max(0.05, z * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
      if (nz === z) return;
      zoomRef.current = nz;
      setZoom(nz);
    };
    const onKey = (e: KeyboardEvent) => {
      // 焦点在输入框/可编辑区时不抢快捷键：空格、Ctrl+Z/Y 等放行给输入框
      // （否则打字打不出空格、中文输入法候选词选不了、Ctrl+Z 误撤销画布）
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.code === "Space") { e.preventDefault(); setSpaceDown(true); return; }
      if (e.key === "Escape") { clearSel(); lassoPts.current = []; setLassoLive([]); setTextDraft(null); setSelShape(null); }
      if ((e.key === "Delete" || e.key === "Backspace") && selShapeRef.current) { e.preventDefault(); deleteSelShape(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if ((e.ctrlKey || e.metaKey) && (e.key === "y" || e.key === "Y")) { e.preventDefault(); redo(); }
    };
    const onKeyUp = (e: KeyboardEvent) => { if (e.code === "Space") setSpaceDown(false); };
    el.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => { el.removeEventListener("wheel", onWheel); window.removeEventListener("keydown", onKey); window.removeEventListener("keyup", onKeyUp); };
  }, [viewW, viewH, scroll.x, scroll.y]);

  const toStage = (e: any) => {
    const st = stageRef.current;
    if (!st) return { x: 0, y: 0 };
    // getRelativePointerPosition 自动换算 Stage position+scale → 文档坐标
    return st.getRelativePointerPosition() ?? { x: 0, y: 0 };
  };

  // 把当前画面在 1:1 文档坐标读成 ImageData（离屏 Konva 重建，采样精确）
  const stageToImageData = async (): Promise<ImageData | null> => {
    const st = stageRef.current;
    if (!st) return null;
    // 离屏 stage，尺寸 = 文档尺寸，scale 1:1
    const offDiv = document.createElement("div");
    const off = new Konva.Stage({
      container: offDiv,
      width: docSize.w,
      height: docSize.h,
      scaleX: 1,
      scaleY: 1,
    });
    offDiv.style.cssText = "position:absolute;left:-99999px;top:0;";
    document.body.appendChild(offDiv);
    // 把主 stage 每个可见图层的节点克隆进离屏层（只克隆有 name 的真实图层，跳过捕获层/遮罩层）
    st.children.forEach((layer: any) => {
      if (!layer.visible() || !layer.name()) return;
      const cloneLayer = new Konva.Layer({ opacity: layer.opacity() });
      layer.children.forEach((node: any) => {
        if (!node.visible()) return;
        cloneLayer.add(node.clone());
      });
      off.add(cloneLayer);
    });
    off.draw();
    const dataUrl = off.toDataURL({ pixelRatio: 1, mimeType: "image/png" });
    off.destroy();
    offDiv.remove();
    const img = new Image();
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = rej; img.src = dataUrl; });
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, c.width, c.height);
  };

  // 对当前选区填充/清除 → 结果作为新图层（在活动图层之上）
  const applySelection = (color: string | null) => {
    if (!selection) return;
    pushUndo();
    (async () => {
      const idata = await stageToImageData();
      if (!idata) return;
      const out = fillSelection(idata, selection, color);
      const c = document.createElement("canvas");
      c.width = out.width; c.height = out.height;
      c.getContext("2d")!.putImageData(out, 0, 0);
      const dataUrl = c.toDataURL("image/png");
      const nl: Layer = { id: "sel_" + Date.now(), name: color ? "填充选区" : "清除选区", visible: true, opacity: 1, shapes: [{ kind: "image", x: 0, y: 0, w: out.width, h: out.height, src: dataUrl, opacity: 1 }] };
      setLayers(ls => {
        const i = ls.findIndex(l => l.id === activeLayer);
        const n = [...ls];
        n.splice(i === -1 ? n.length : i, 0, nl);
        return n;
      });
      setSelection(null); setSelCanvas(null);
    })();
  };
  const commitSelection = (sel: Selection) => { setSelection(sel); setSelCanvas(selectionToCanvas(sel)); };
  const clearSel = () => { setSelection(null); setSelCanvas(null); setWandClicks(0); };

  // 选区抠出新图层：选区内像素保留、选区外透明，作为新图层置于活动图层之上（原图层不动）
  const duplicateSelection = () => {
    if (!selection) return;
    pushUndo();
    (async () => {
      const idata = await stageToImageData();
      if (!idata) return;
      const out = extractSelection(idata, selection);
      const c = document.createElement("canvas");
      c.width = out.width; c.height = out.height;
      c.getContext("2d")!.putImageData(out, 0, 0);
      const dataUrl = c.toDataURL("image/png");
      const nl: Layer = { id: "dup_" + Date.now(), name: "抠出选区", visible: true, opacity: 1, shapes: [{ kind: "image", x: 0, y: 0, w: out.width, h: out.height, src: dataUrl, opacity: 1 }] };
      setLayers(ls => [...ls, nl]);
      setActiveLayer(nl.id);
      setSelection(null); setSelCanvas(null);
    })();
  };

  // 选区裁剪成新文件：按选区遮罩的包围盒从 1:1 合成图上裁下，直接下载独立图片文件（项目不动）
  const cropSelectionToFile = () => {
    if (!selection) return;
    (async () => {
      const st = stageRef.current;
      if (!st) return;
      const ov = overlayRef.current;
      if (ov) { ov.visible(false); ov.batchDraw(); }
      const dataUrl = st.toDataURL({ pixelRatio: 1 / (st.scaleX() || 1), mimeType: "image/png" });
      if (ov) { ov.visible(true); ov.batchDraw(); }
      const img = await loadImg(dataUrl);
      // 选区遮罩包围盒
      const sw = selection.w, sh = selection.h;
      let x0 = sw, y0 = sh, x1 = -1, y1 = -1;
      for (let y = 0; y < sh; y++) {
        const row = y * sw;
        for (let x = 0; x < sw; x++) {
          if (selection.data[row + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        }
      }
      if (x1 < 0) return;
      const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
      const c = document.createElement("canvas");
      c.width = cw; c.height = ch;
      const ctx = c.getContext("2d")!;
      // 只保留选区内像素（套索/魔棒等非矩形选区外圈透明）
      const selCanvas = document.createElement("canvas");
      selCanvas.width = sw; selCanvas.height = sh;
      const sctx = selCanvas.getContext("2d")!;
      sctx.drawImage(img, 0, 0, sw, sh);
      const idata = sctx.getImageData(0, 0, sw, sh);
      const ext = extractSelection(idata, selection);
      const full = document.createElement("canvas");
      full.width = sw; full.height = sh;
      full.getContext("2d")!.putImageData(ext, 0, 0);
      ctx.drawImage(full, x0, y0, cw, ch, 0, 0, cw, ch);
      c.toBlob(blob => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `${id}_裁剪_${cw}x${ch}.png`; a.click();
        URL.revokeObjectURL(url);
      }, "image/png");
    })().catch(() => alert("裁剪失败"));
  };

  // 放置文字（从输入浮层提交）：新建 或 原位重编辑（textDraft.edit）
  const commitText = async () => {
    if (!textDraft) return;
    const content = textInput.trim();
    if (!content) { setTextDraft(null); return; }
    // 用户没手动改色时，等智能对比色采样结果落定（防异步竞态拿到旧色）
    let fill = textColor;
    if (!colorTouched.current && autoContrast.current) {
      try { fill = await autoContrast.current.p; } catch { /* 用当前色 */ }
    }
    pushUndo();
    if (textDraft.edit) {
      // 重编辑：保留原位置与变换，只换文字/颜色/字号
      const { layer: lid, index } = textDraft.edit;
      setLayers(ls => ls.map(l => l.id === lid
        ? { ...l, shapes: l.shapes.map((s, i) => i === index && s.kind === "text"
            ? { ...s, text: content, fontSize: textFontSize, fill: fill } : s) }
        : l));
    } else {
      // 文字 = 独立图层（PS 同款待遇：面板里可上下移/删除/显隐/透明度/混合），追加到末尾 = 最上层
      const lid = "text_" + Date.now();
      const nl: Layer = { id: lid, name: `文字 ${content.slice(0, 8)}`, visible: true, opacity: 1,
        shapes: [{ kind: "text", x: textDraft.x, y: textDraft.y, text: content, fontSize: textFontSize, fill: fill, opacity: 1 }] };
      setLayers(ls => [...ls, nl]);
      setActiveLayer(lid);
      setSelShape({ layer: lid, index: 0 }); // 新文字置顶并立即选中，直接可变换
    }
    setTextDraft(null);
    setTool("move"); // 放完切回移动工具，避免误触
  };

  // 智能对比色：采样落点周围画布像素的平均亮度，深底→白字，浅底→黑字
  const contrastColorAt = async (x: number, y: number): Promise<string> => {
    try {
      const idata = await stageToImageData();
      if (!idata) return textColor;
      const R = 24; // 采样半径（文档像素）
      let r = 0, g = 0, b = 0, n = 0;
      const x0 = Math.max(0, Math.round(x - R)), x1 = Math.min(idata.width - 1, Math.round(x + R));
      const y0 = Math.max(0, Math.round(y - R)), y1 = Math.min(idata.height - 1, Math.round(y + R));
      for (let yy = y0; yy <= y1; yy += 2) for (let xx = x0; xx <= x1; xx += 2) {
        const i = (yy * idata.width + xx) * 4;
        const a = idata.data[i + 3];
        r += idata.data[i] * a; g += idata.data[i + 1] * a; b += idata.data[i + 2] * a; n += a;
      }
      if (!n) return "#1c1a17"; // 全透明（空白画布按白底看）→ 黑字
      const lum = 0.2126 * (r / n) + 0.7152 * (g / n) + 0.0722 * (b / n);
      return lum > 140 ? "#1c1a17" : "#ffffff";
    } catch { return textColor; }
  };
  // 智能色异步结果 + 用户是否手动改过色：commitText 时据此定最终色（防采样未回的竞态）
  const autoContrast = useRef<{ p: Promise<string> } | null>(null);
  const colorTouched = useRef(false);

  // 双击重编辑已有文字：浮层回填原文/颜色/字号
  const editTextAt = (layerId: string, index: number) => {
    const s = layers.find(l => l.id === layerId)?.shapes[index];
    if (!s || s.kind !== "text") return;
    setSelShape(null);
    setTextInput(s.text);
    setTextFontSize(s.fontSize);
    setTextColor(s.fill);
    colorTouched.current = true; // 重编辑沿用原色，不再自动对比
    autoContrast.current = null;
    setTextDraft({ x: s.x, y: s.y, edit: { layer: layerId, index } });
    setTool("text");
  };

  // 删除选中的素材（任意类型；用 ref 读选中态，供 keydown 闭包安全调用）
  const deleteSelShape = () => {
    const sel = selShapeRef.current;
    if (!sel) return;
    pushUndo();
    setLayers(ls => ls.map(l => l.id === sel.layer
      ? { ...l, shapes: l.shapes.filter((_, i) => i !== sel.index) }
      : l));
    setSelShape(null);
  };

  // 选中素材时：把 Transformer 挂到对应 Konva 节点上（经 layerRefs 找节点）
  useEffect(() => {
    const tr = transformerRef.current;
    if (!tr) return;
    if (!selShape) { tr.nodes([]); tr.getLayer()?.batchDraw(); return; }
    const node = layerRefs.current[selShape.layer]?.findOne(`.shape-${selShape.index}`);
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [selShape, layers, zoom]);

  // 撤销：填充/清除前把 layers 快照压栈
  const pushUndo = useCallback(() => {
    undoStack.current.push({ layers: layersRef.current, docSize: docSizeRef.current });
    if (undoStack.current.length > 30) undoStack.current.shift();
    redoStack.current = []; // 新操作使重做栈失效
    setUndoCount(undoStack.current.length);
    setRedoCount(0);
  }, []);
  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    redoStack.current.push({ layers: layersRef.current, docSize: docSizeRef.current });
    setLayers(prev.layers);
    setDocSize(prev.docSize);
    setUndoCount(undoStack.current.length);
    setRedoCount(redoStack.current.length);
    clearSel();
  }, []);
  const redo = useCallback(() => {
    const next = redoStack.current.pop();
    if (!next) return;
    undoStack.current.push({ layers: layersRef.current, docSize: docSizeRef.current });
    setLayers(next.layers);
    setDocSize(next.docSize);
    setUndoCount(undoStack.current.length);
    setRedoCount(redoStack.current.length);
    clearSel();
  }, []);

  // 打开画布尺寸对话框：用当前尺寸预填
  const openResize = () => {
    setRw(String(docSize.w));
    setRh(String(docSize.h));
    setResizeMode("crop");
    setResizeOpen(true);
  };

  // 应用画布尺寸：裁剪（画布大小，内容不动）/ 拉伸（图像大小，内容按比例缩放）
  const applyResize = () => {
    const w = Math.max(16, Math.min(10000, parseInt(rw) || docSize.w));
    const h = Math.max(16, Math.min(10000, parseInt(rh) || docSize.h));
    setResizeOpen(false);
    if (w === docSize.w && h === docSize.h) return;
    const sw = w / docSize.w, sh = h / docSize.h;
    pushUndo();
    if (resizeMode === "stretch") {
      setLayers(ls => ls.map(l => ({
        ...l,
        shapes: l.shapes.map(s => {
          if (s.kind === "line") return { ...s, points: s.points.map((p, i) => p * (i % 2 === 0 ? sw : sh)), strokeWidth: s.strokeWidth * Math.sqrt(sw * sh) };
          if (s.kind === "rect") return { ...s, x: s.x * sw, y: s.y * sh, w: s.w * sw, h: s.h * sh, cornerRadius: s.cornerRadius * Math.min(sw, sh) };
          if (s.kind === "image") return { ...s, x: s.x * sw, y: s.y * sh, w: s.w * sw, h: s.h * sh };
          if (s.kind === "text") return { ...s, x: s.x * sw, y: s.y * sh, fontSize: s.fontSize * sh };
          return s;
        }),
      })));
    }
    setDocSize({ w, h });
  };

  // 快速抠像：底图 → 白底合成 → onnxruntime-web u2netp → 透明背景主体图层（置于最上层）
  const doMatting = async () => {
    const st = stageRef.current;
    if (!st || aiBusy) return;
    setAiBusy(true);
    try {
      setMattingError(null);
      // 1. 只取底图（第一个 image 图层）渲染到白底，避免透明棋盘格+多层压平干扰模型
      const c = document.createElement("canvas");
      c.width = docSize.w; c.height = docSize.h;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, c.width, c.height);
      let drew = false;
      for (const layer of layers) {
        if (!layer.visible || drew) continue;
        for (const shape of layer.shapes) {
          if (shape.kind === "image" && shape.src) {
            const img = new Image();
            await new Promise(r => { img.onload = r; img.src = shape.src; });
            ctx.globalAlpha = shape.opacity * layer.opacity;
            ctx.drawImage(img, shape.x, shape.y, shape.w, shape.h);
            drew = true;
            break;
          }
        }
      }
      ctx.globalAlpha = 1;
      if (!drew) { alert("没有可抠的底图"); return; }
      const whiteBgUrl = c.toDataURL("image/png");
      // 2. 纯前端抠像（onnxruntime-web + WebGPU，零 Python/API）
      const { smartCutout } = await import("./matting");
      const cutoutCanvas = await smartCutout(c);
      const cutout = cutoutCanvas.toDataURL("image/png");
      // 3. 主体图层置于最上层
      pushUndo();
      const lid = "L" + Date.now();
      setLayers(ls => [
        ...ls,
        { id: lid, name: "快速抠像", visible: true, opacity: 1, shapes: [{ kind: "image", x: 0, y: 0, w: docSize.w, h: docSize.h, src: cutout, opacity: 1 }] },
      ]);
      setActiveLayer(lid);
    } catch (e: any) {
      const msg = e?.message || String(e);
      console.error("[抠像失败]", e);
      setMattingError("抠像失败: " + msg);
    } finally {
      setAiBusy(false);
    }
  };

  // 取活动图层内容 canvas（用于 SAM），返回 canvas + 图层在文档中的偏移
  // 优先活动图层；活动图层无 image 时回退第一个 image 图层
  const getSamBase = async () => {
    const active = layers.find(l => l.id === activeLayer);
    const layer = (active && active.shapes.some(s => s.kind === "image"))
      ? active
      : layers.find(l => l.visible && l.shapes.some(s => s.kind === "image"));
    if (!layer) return null;
    const s = layer.shapes.find(s => s.kind === "image")!;
    // 按图层 id 缓存；图层变了重新取
    if (samBaseRef.current?.layerId === layer.id) return samBaseRef.current;
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = s.src;
    });
    const c = document.createElement("canvas");
    c.width = s.w; c.height = s.h;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0, s.w, s.h);
    const ret = { canvas: c, x: s.x, y: s.y, layerId: layer.id };
    samBaseRef.current = ret;
    return ret;
  };

  // SAM 交互：加一个点（前景/背景），实时刷新 mask 预览
  const samAddPoint = async (docX: number, docY: number, label: 1 | 0) => {
    if (aiBusy) return;
    setAiBusy(true);
    try {
      setMattingError(null);
      const base = await getSamBase();
      if (!base) { setMattingError("没有可分割的图层"); return; }
      await samEmbed(base.canvas, base.layerId); // 首次跑 encoder，之后按图层缓存
      // 文档坐标 → 图层局部坐标
      const lx = docX - base.x, ly = docY - base.y;
      const pts = [...samPoints, { x: lx, y: ly, label }];
      setSamPoints(pts);
      const mask = await samPredict(base.canvas, pts);
      setSamMask(mask);
    } catch (e: any) {
      setMattingError("SAM 分割失败：" + (e?.message || e));
    } finally {
      setAiBusy(false);
    }
  };

  // SAM 确认：当前 mask 抠成透明背景新图层（置于最上层）
  const samConfirm = async () => {
    if (samPoints.length === 0 || aiBusy) return;
    setAiBusy(true);
    try {
      setMattingError(null);
      const base = await getSamBase();
      if (!base) { setMattingError("没有可分割的图层"); return; }
      const out = await samComposite(base.canvas, samPoints);
      const dataUrl = out.toDataURL("image/png");
      pushUndo();
      // 抠出的结果放回图层在原文档中的位置，保持与原图对齐
      const nl: Layer = { id: "sam_" + Date.now(), name: "SAM 分割", visible: true, opacity: 1, shapes: [{ kind: "image", x: base.x, y: base.y, w: out.width, h: out.height, src: dataUrl, opacity: 1 }] };
      setLayers(ls => [...ls, nl]);
      setActiveLayer(nl.id);
      samReset();
      setTool("move");
    } catch (e: any) {
      setMattingError("SAM 分割失败：" + (e?.message || e));
    } finally {
      setAiBusy(false);
    }
  };

  // SAM 重置：清空点与预览
  const samReset = () => {
    setSamPoints([]);
    setSamMask(null);
    setSamOverlay(null);
    setSamRegions([]);
  };

  // SAM 全景分割：一次分全部元素，彩色叠图
  const samSegmentAllNow = async () => {
    if (aiBusy || samAllBusy) return;
    setAiBusy(true);
    setSamAllBusy({ done: 0, total: 0 });
    try {
      setMattingError(null);
      const base = await getSamBase();
      if (!base) { setMattingError("没有可分割的图层"); return; }
      const { overlay, regions } = await samSegmentAll(base.canvas, base.layerId, 16, (done, total) => {
        setSamAllBusy({ done, total });
      });
      setSamOverlay(overlay);
      setSamRegions(regions);
      setSamPoints([]);
      setSamMask(null);
    } catch (e: any) {
      setMattingError("全景分割失败：" + (e?.message || e));
    } finally {
      setAiBusy(false);
      setSamAllBusy(null);
    }
  };

  // SAM 全景模式：点击叠图某个颜色 → 抠出该元素为新图层
  const samPickRegion = async (docX: number, docY: number) => {
    if (!samOverlay || samRegions.length === 0 || aiBusy) return;
    const base = samBaseRef.current;
    if (!base) return;
    // 文档坐标 → overlay 局部坐标
    const lx = Math.round(docX - base.x), ly = Math.round(docY - base.y);
    if (lx < 0 || ly < 0 || lx >= samOverlay.width || ly >= samOverlay.height) return;
    const ctx = samOverlay.getContext("2d")!;
    const px = ctx.getImageData(lx, ly, 1, 1).data;
    if (px[3] === 0) { setMattingError("此处没有检测到元素"); return; }
    const region = samRegions.find(r => {
      const [rr, gg, bb] = [parseInt(r.color.slice(1, 3), 16), parseInt(r.color.slice(3, 5), 16), parseInt(r.color.slice(5, 7), 16)];
      return rr === px[0] && gg === px[1] && bb === px[2];
    });
    if (!region) { setMattingError("未匹配到元素（颜色反查失败）"); return; }
    await extractRegionToLayer(region);
  };

  // 按索引抠出某个元素（属性栏色块用）
  const pickRegionByIndex = async (idx: number) => {
    const region = samRegions[idx];
    if (!region || aiBusy) return;
    await extractRegionToLayer(region);
  };

  // 把某个 region 抠成透明背景新图层（公共逻辑）
  const extractRegionToLayer = async (region: SamRegion) => {
    const base = samBaseRef.current;
    if (!base) return;
    setAiBusy(true);
    try {
      const out = await samExtractRegion(base.canvas, region);
      const dataUrl = out.toDataURL("image/png");
      pushUndo();
      const nl: Layer = { id: "sam_" + Date.now(), name: "SAM 元素", visible: true, opacity: 1, shapes: [{ kind: "image", x: base.x, y: base.y, w: out.width, h: out.height, src: dataUrl, opacity: 1 }] };
      setLayers(ls => [...ls, nl]);
      setActiveLayer(nl.id);
      setTool("move");
      samReset();
    } catch (e: any) {
      setMattingError("抠出元素失败：" + (e?.message || e));
    } finally {
      setAiBusy(false);
    }
  };

  // 快速填充（纯前端）：选区边缘取色 → 多轮向内扩散 → 填充
  const doSmartFill = async () => {
    if (!selection || aiBusy) return;
    setAiBusy(true);
    try {
      const idata = await stageToImageData();
      if (!idata) return;
      const { width: w, height: h, data } = idata;
      const mask = selection.data;
      const out = new Uint8ClampedArray(data);

      // 1. 内容识别填充（Fast Marching inpaint）：从选区边界向内重建像素。
      //    细线/钢丝等窄结构被两侧背景桥接掉——真正的"擦除"，不是模糊。
      const known = new Uint8Array(w * h);
      const dist = new Float32Array(w * h).fill(1e9);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) known[y * w + x] = mask[y * w + x] ? 0 : 1;

      // 最小堆（key = 到已知区距离）
      const heap: number[] = [];
      const push = (i: number, k: number) => {
        dist[i] = k; heap.push(i);
        let c = heap.length - 1;
        while (c > 0) { const p = (c - 1) >> 1; if (dist[heap[p]] <= dist[heap[c]]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; }
      };
      const pop = (): number => {
        const top = heap[0]; const last = heap.pop()!;
        if (heap.length) {
          heap[0] = last; let p = 0;
          for (;;) { const l = p * 2 + 1, r = l + 1; let s = p;
            if (l < heap.length && dist[heap[l]] < dist[heap[s]]) s = l;
            if (r < heap.length && dist[heap[r]] < dist[heap[s]]) s = r;
            if (s === p) break; [heap[p], heap[s]] = [heap[s], heap[p]]; p = s; }
        }
        return top;
      };
      const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      // 种子：选区边界像素
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x; if (!mask[i]) continue;
        if ((x > 0 && known[i - 1]) || (x < w - 1 && known[i + 1]) || (y > 0 && known[i - w]) || (y < h - 1 && known[i + w])) push(i, 0);
      }
      // 逐像素重建：对已知邻域做距离加权平均（越近权重越大）
      while (heap.length) {
        const i = pop(); if (known[i]) continue;
        const x = i % w, y = (i / w) | 0;
        let r = 0, g = 0, b = 0, a = 0, sw = 0;
        for (const [dx, dy] of DIRS) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx; if (!known[ni]) continue;
          const wt = 1 / (1 + dist[ni]);
          const d = ni * 4;
          r += out[d] * wt; g += out[d + 1] * wt; b += out[d + 2] * wt; a += out[d + 3] * wt; sw += wt;
        }
        if (sw > 0) { const d = i * 4; out[d] = r / sw; out[d + 1] = g / sw; out[d + 2] = b / sw; out[d + 3] = a / sw; }
        known[i] = 1;
        for (const [dx, dy] of DIRS) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          if (mask[ni] && !known[ni]) push(ni, dist[i] + 1);
        }
      }

      // 3. 结果写回画布（作为新图层）
      pushUndo();
      const resultCanvas = document.createElement("canvas");
      resultCanvas.width = w; resultCanvas.height = h;
      const rctx = resultCanvas.getContext("2d")!;
      rctx.putImageData(new ImageData(out, w, h), 0, 0);
      const dataUrl = resultCanvas.toDataURL("image/png");
      const lid = "L" + Date.now();
      setLayers(ls => [
        ...ls,
        { id: lid, name: "快速填充", visible: true, opacity: 1, shapes: [{ kind: "image", x: 0, y: 0, w: docSize.w, h: docSize.h, src: dataUrl, opacity: 1 }] },
      ]);
      setActiveLayer(lid);
      clearSel();
    } catch (e: any) {
      alert("快速填充失败: " + e.message);
    } finally {
      setAiBusy(false);
    }
  };

  // 拖图片进画布：按 drop 点定位，等比缩放适配文档，作为新图层
  const [dragOver, setDragOver] = useState(false);
  const onCanvasDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = Array.from(e.dataTransfer.files).find(f => f.type.startsWith("image/"));
    if (!f) return;
    const st = stageRef.current;
    if (!st) return;
    // drop 点 → 文档坐标（Konva 没有 getRelativePosition：视口坐标减 stage 偏移再除缩放）
    const rect = st.container().getBoundingClientRect();
    const pos = {
      x: (e.clientX - rect.left - st.x()) / st.scaleX(),
      y: (e.clientY - rect.top - st.y()) / st.scaleY(),
    };
    // 读图尺寸
    const dataUrl = await new Promise<string>(r => {
      const fr = new FileReader();
      fr.onload = () => r(fr.result as string);
      fr.readAsDataURL(f);
    });
    const img = new Image();
    await new Promise(r => { img.onload = r; img.src = dataUrl; });
    // 等比缩放：最大占文档 80%
    const maxW = docSize.w * 0.8, maxH = docSize.h * 0.8;
    const scale = Math.min(maxW / img.width, maxH / img.height, 1);
    const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
    // 以 drop 点为中心，clamp 进文档
    let x = Math.round(pos.x - w / 2), y = Math.round(pos.y - h / 2);
    x = Math.max(0, Math.min(x, docSize.w - w));
    y = Math.max(0, Math.min(y, docSize.h - h));
    pushUndo();
    const lid = "L" + Date.now();
    setLayers(ls => [
      ...ls,
      { id: lid, name: f.name.replace(/\.\w+$/, ""), visible: true, opacity: 1, shapes: [{ kind: "image", x, y, w, h, src: dataUrl, opacity: 1 }] },
    ]);
    setActiveLayer(lid);
  };

  // 魔棒：点击处按颜色扩散选区，多次点击 OR 累积
  const onWand = async (px: number, py: number) => {
    const idata = await stageToImageData();
    if (!idata) return;
    const x = Math.max(0, Math.min(idata.width - 1, Math.round(px)));
    const y = Math.max(0, Math.min(idata.height - 1, Math.round(py)));
    const newSel = magicWand(idata, x, y, wandTol);
    // 与现有选区 OR 合并
    if (selection) {
      const merged = new Uint8Array(selection.data.length);
      for (let i = 0; i < merged.length; i++) merged[i] = selection.data[i] | newSel.data[i] ? 1 : 0;
      commitSelection({ data: merged, w: selection.w, h: selection.h });
    } else {
      commitSelection(newSel);
    }
    setWandClicks(c => c + 1);
  };

  const onStageMouseDown = (e: any) => {
    // 平移：空格+左键、中键、或抓手工具(move)左键
    const isMiddle = e.evt && e.evt.button === 1;
    const isMove = tool === "move";
    if (spaceDown || isMiddle || isMove) {
      e.evt?.preventDefault?.();
      // move 工具点空白 = 取消选中（素材/变换手柄自身的点击不会冒泡到这里）
      if (isMove && !spaceDown && !isMiddle) {
        const onTr = e.target?.findAncestor ? !!e.target.findAncestor("Transformer") : false;
        if (!onTr) setSelShape(null);
      }
      pan.current = { sx: e.evt.clientX, sy: e.evt.clientY, ox: scroll.x, oy: scroll.y };
      return;
    }
    const p = toStage(e);
    if (tool === "wand") { onWand(p.x, p.y); return; }
    if (tool === "sam") {
      // 全景叠图模式下：点击抠出元素；否则官方点选范式（左键前景/右键背景）
      if (samOverlay) { samPickRegion(p.x, p.y); return; }
      const isRight = e.evt && e.evt.button === 2;
      samAddPoint(p.x, p.y, isRight ? 0 : 1);
      return;
    }
    if (tool === "lasso") { lassoPts.current = [{ x: p.x, y: p.y }]; drawing.current = true; return; }
    if (tool === "rect" || tool === "ellipse") { setDragSel({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }); drawing.current = true; return; }
    drawing.current = true;
    if (tool === "brush" || tool === "eraser") {
      pointRef.current = [p.x, p.y, p.x, p.y];
    } else if (tool === "fill") {
      // 有选区→对选区填当前色；无选区→铺满活动层
      if (selection) { applySelection(fillColor); }
      else { pushUndo(); setLayers(ls => ls.map(l => l.id === activeLayer ? { ...l, shapes: [{ kind: "rect", x: 0, y: 0, w: docSize.w, h: docSize.h, fill: fillColor, opacity: 0.35, cornerRadius: 0 }, ...l.shapes] } : l)); }
    } else if (tool === "text") {
      // 点击画布 → 打开文字输入浮层（在定位处放置）；默认色按落点底色智能取对比色
      setTextInput("");
      setTextDraft({ x: Math.round(p.x), y: Math.round(p.y) });
      colorTouched.current = false;
      autoContrast.current = { p: contrastColorAt(p.x, p.y).then(c => { setTextColor(c); return c; }) };
    }
  };

  const onStageMouseMove = (e: any) => {
    // 平移中：按拖拽位移更新 scroll（屏幕像素 / zoom = 文档像素）
    if (pan.current) {
      const dx = e.evt.clientX - pan.current.sx;
      const dy = e.evt.clientY - pan.current.sy;
      setScroll({ x: pan.current.ox - dx / zoom, y: pan.current.oy - dy / zoom });
      return;
    }
    const p = toStage(e);
    setCursor({ x: p.x, y: p.y });
    if (!drawing.current) return;
    if (tool === "lasso") { lassoPts.current.push({ x: p.x, y: p.y }); setLassoLive([...lassoPts.current]); return; }
    if (tool === "rect" || tool === "ellipse") { setDragSel(s => (s ? { ...s, x1: p.x, y1: p.y } : s)); return; }
    if (tool === "brush" || tool === "eraser") {
      pointRef.current = [...pointRef.current, p.x, p.y];
      setStrokes(s => ({ ...s, [activeLayer]: pointRef.current }));
    }
  };

  const endStroke = () => {
    if (pan.current) { pan.current = null; return; }
    if (!drawing.current) return;
    drawing.current = false;
    if (tool === "lasso") {
      if (lassoPts.current.length >= 3) commitSelection(lasso(lassoPts.current, docSize.w, docSize.h));
      lassoPts.current = []; setLassoLive([]);
      return;
    }
    if (tool === "rect" || tool === "ellipse") {
      if (dragSel) {
        const sel = tool === "rect"
          ? rectSelection(dragSel.x0, dragSel.y0, dragSel.x1, dragSel.y1, docSize.w, docSize.h)
          : ellipseSelection(dragSel.x0, dragSel.y0, dragSel.x1, dragSel.y1, docSize.w, docSize.h);
        commitSelection(sel);
      }
      setDragSel(null);
      return;
    }
    if (pointRef.current.length >= 4) {
      pushUndo();
      const pts = pointRef.current;
      setLayers(ls => ls.map(l => l.id === activeLayer
        // 笔迹必须追加到数组尾（层内最上层）：橡皮 destination-out 要先有像素才能擦，插到开头会被下方图像重新盖住
        ? { ...l, shapes: [...l.shapes, { kind: "line", points: pts, stroke: tool === "eraser" ? "rgba(0,0,0,1)" : brushColor, strokeWidth: brushSize, opacity: tool === "eraser" ? 1 : brushOpacity, tension: 0.5, composite: tool === "eraser" ? "destination-out" : "source-over" }] }
        : l));
      setStrokes(s => { const n = { ...s }; delete n[activeLayer]; return n; });
      pointRef.current = [];
    }
  };

  const toggleVis = (lid: string) => setLayers(ls => ls.map(l => l.id === lid ? { ...l, visible: !l.visible } : l));
  const moveLayer = (lid: string, d: -1 | 1) => setLayers(ls => {
    const i = ls.findIndex(l => l.id === lid);
    const j = i + d;
    if (j < 0 || j >= ls.length) return ls;
    const n = [...ls]; [n[i], n[j]] = [n[j], n[i]]; return n;
  });

  // 删除图层（保留至少一层；删除活动层后自动选相邻层）
  const deleteLayer = (lid: string) => {
    pushUndo();
    setStrokes(s => { const n = { ...s }; delete n[lid]; return n; });
    setLayers(ls => {
      if (ls.length <= 1) return ls; // 至少保留一层
      const i = ls.findIndex(l => l.id === lid);
      const next = ls.filter(l => l.id !== lid);
      if (activeLayer === lid) {
        const fallback = next[Math.max(0, i - 1)] ?? next[0];
        setActiveLayer(fallback?.id ?? "");
      }
      return next;
    });
  };

  // 新建空图层（透明，置于最顶层）
  const newEmptyLayer = () => {
    pushUndo();
    const lid = "L" + Date.now();
    setLayers(ls => [...ls, { id: lid, name: "空图层", visible: true, opacity: 1, shapes: [] }]);
    setActiveLayer(lid);
  };

  // 图层样式 + 调色（不压撤销栈：频繁拖滑块会让撤销栈爆炸）
  const setLayerOpacity = (lid: string, opacity: number) => setLayers(ls => ls.map(l => l.id === lid ? { ...l, opacity } : l));
  const setLayerBlendMode = (lid: string, blendMode: BlendMode) => setLayers(ls => ls.map(l => l.id === lid ? { ...l, blendMode } : l));
  const setLayerAdjust = (lid: string, key: keyof ColorAdjust, value: number) =>
    setLayers(ls => ls.map(l => l.id === lid ? { ...l, adjust: { ...(l.adjust ?? DEFAULT_ADJUST), [key]: value } } : l));
  const resetLayerAdjust = (lid: string) => setLayers(ls => ls.map(l => l.id === lid ? { ...l, adjust: DEFAULT_ADJUST } : l));

  // 当前选中图层的对象 + 调色参数（供样式区 UI 用）
  const activeLayerObj = layers.find(l => l.id === activeLayer) ?? null;
  const activeAdjust = activeLayerObj?.adjust ?? DEFAULT_ADJUST;
  // 调色分组折叠状态（默认展开「色调」，白平衡/颜色折叠）
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set(["色调"]));

  // 调色滤镜：layers 变化时对每个图层手动设置滤镜 + 重新 cache（ref 回调时序不可靠）
  useEffect(() => {
    layers.forEach(l => {
      const node = layerRefs.current[l.id];
      if (!node) return;
      node.clearCache();
      if (!isDefaultAdjust(l.adjust)) {
        node.filters([(Konva.Filters as any).ColorGrade] as any);
        node.setAttr("colorAdjust", l.adjust ?? DEFAULT_ADJUST);
        node.cache();
      }
    });
    stageRef.current?.batchDraw();
  }, [layers]);

  const exportImage = async (fmt: "png" | "jpg" | "webp" | "psd") => {
    try {
      const st = stageRef.current;
      if (!st) return;
      const ov = overlayRef.current;
      if (ov) { ov.visible(false); ov.batchDraw(); }
      // Stage 位图本身带 zoom 缩放（scaleX=视图缩放），pixelRatio 必须除回去才是文档 1:1 尺寸，
      // 否则缩小时导出图=文档×zoom 贴在角上（人脸缩成左上角一小块）
      const pr = 1 / (st.scaleX() || 1);
      const dataUrl = st.toDataURL({ pixelRatio: pr, mimeType: fmt === "jpg" ? "image/jpeg" : fmt === "webp" ? "image/webp" : "image/png" });
      if (ov) { ov.visible(true); ov.batchDraw(); }
      const full = document.createElement("canvas");
      full.width = docSize.w; full.height = docSize.h;
      const ctx = full.getContext("2d")!;
      // JPG 不支持透明 → 白底
      if (fmt === "jpg") { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, full.width, full.height); }
      await new Promise<void>((res, rej) => {
        const img = new Image();
        img.onload = () => { ctx.drawImage(img, 0, 0, full.width, full.height); res(); };
        img.onerror = rej;
        img.src = dataUrl;
      });
      if (fmt === "psd") {
        const { writePsd } = await import("ag-psd");
        const psd = writePsd({ width: docSize.w, height: docSize.h, children: [{ canvas: full, name: "合成", left: 0, top: 0 }] });
        const blob = new Blob([psd as unknown as BlobPart], { type: "image/vnd.adobe.photoshop" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `${id}.psd`; a.click();
        URL.revokeObjectURL(url);
      } else {
        const ext = fmt === "jpg" ? "jpg" : fmt;
        full.toBlob(blob => {
          if (!blob) return;
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url; a.download = `${id}.${ext}`; a.click();
          URL.revokeObjectURL(url);
        }, fmt === "jpg" ? "image/jpeg" : fmt === "webp" ? "image/webp" : "image/png", fmt === "jpg" ? 0.92 : undefined);
      }
    } catch (err) {
      console.error("Export failed", err);
      alert("导出失败");
    }
  };

  // ---- AI API：取图（三来源）+ 结果图进新图层 ----
  const dataUrlToBlob = async (dataUrl: string): Promise<Blob> => (await fetch(dataUrl)).blob();
  const canvasToBlob = (canvas: HTMLCanvasElement): Promise<Blob | null> =>
    new Promise(res => canvas.toBlob(b => res(b), "image/png"));
  const loadImg = (src: string): Promise<HTMLImageElement> =>
    new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

  // 取图：full=整图合成 / layer=活动图层 / selection=当前选区
  const getImageSource = async (source: ImageSource): Promise<Blob | null> => {
    try {
      const st = stageRef.current;
      if (!st) return null;
      const snapshotDataUrl = () => {
        const ov = overlayRef.current;
        if (ov) { ov.visible(false); ov.batchDraw(); }
        // 同 exportImage：pixelRatio 除回视图缩放，快照才是文档 1:1（选区裁剪按文档坐标取数）
        const d = st.toDataURL({ pixelRatio: 1 / (st.scaleX() || 1), mimeType: "image/png" });
        if (ov) { ov.visible(true); ov.batchDraw(); }
        return d;
      };
      if (source === "full") return await dataUrlToBlob(snapshotDataUrl());
      if (source === "layer") {
        const node = layerRefs.current[activeLayer];
        if (!node) return null;
        return await canvasToBlob(node.toCanvas());
      }
      if (source === "selection") {
        if (!selection) return null;
        const dataUrl = snapshotDataUrl();
        const img = await loadImg(dataUrl);
        const c = document.createElement("canvas");
        c.width = selection.w; c.height = selection.h;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(img, 0, 0);
        const out = extractSelection(ctx.getImageData(0, 0, c.width, c.height), selection);
        const oc = document.createElement("canvas");
        oc.width = selection.w; oc.height = selection.h;
        oc.getContext("2d")!.putImageData(out, 0, 0);
        return await canvasToBlob(oc);
      }
      return null;
    } catch { return null; }
  };

  // 结果图插入为新图层（置于最上层，自动对齐画布）
  const addApiResultImage = async (dataUrl: string, name: string) => {
    try {
      pushUndo();
      const lid = "ai_" + Date.now();
      // 自动对齐画布：铺满当前画布尺寸（无论 RH 返回什么分辨率，如缩放倍数>1）
      setLayers(ls => [...ls, { id: lid, name, visible: true, opacity: 1, shapes: [{ kind: "image", x: 0, y: 0, w: docSize.w, h: docSize.h, src: dataUrl, opacity: 1 }] }]);
    } catch (e) {
      console.error("结果图插入失败", e);
    }
  };

  const importFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    // PSD/PSB → ag-psd 解析多层
    if (/\.(psd|psb)$/i.test(file.name)) {
      try {
        const { readPsd } = await import("ag-psd");
        const buf = await file.arrayBuffer();
        const doc = readPsd(buf, { skipLayerImageData: false });
        setDocSize({ w: doc.width, h: doc.height });
        const newLayers: Layer[] = [];
        const kids = doc.children ?? [];
        for (let i = 0; i < kids.length; i++) {
          const k = kids[i];
          const cv: HTMLCanvasElement | undefined = (k as any).canvas;
          if (!cv) continue;
          const dataUrl = cv.toDataURL("image/png");
          newLayers.push({
            id: `psd_${i}`, name: k.name || `图层 ${i + 1}`, visible: true,
            opacity: (k.opacity ?? 255) / 255,
            shapes: [{ kind: "image", x: k.left ?? 0, y: k.top ?? 0, w: cv.width, h: cv.height, src: dataUrl, opacity: 1 }],
          });
        }
        if (newLayers.length) { setLayers(newLayers); setActiveLayer(newLayers[0].id); fitView(); }
        else alert("该 PSD 没有可解析的图层");
      } catch (err) {
        console.error("PSD parse failed", err);
        alert("PSD 解析失败，请检查文件");
      }
      return;
    }
    // 通用图片 → 单图层
    try {
      const dataUrl = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result as string);
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      const img = new Image();
      await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = rej; img.src = dataUrl; });
      setDocSize({ w: img.naturalWidth, h: img.naturalHeight });
      const lid = "L" + Date.now();
      setLayers([{ id: lid, name: file.name.replace(/\.[^.]+$/, ""), visible: true, opacity: 1, shapes: [{ kind: "image", x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight, src: dataUrl, opacity: 1 }] }]);
      setActiveLayer(lid);
      fitView();
    } catch (err) {
      console.error("Import failed", err);
      alert("图片导入失败，请检查文件格式");
    }
  };

  const activeShapes = useMemo(() => layers.find(l => l.id === activeLayer)?.shapes ?? [], [layers, activeLayer]);

  // 导出下拉：点击外部关闭
  useEffect(() => {
    if (!exportOpen) return;
    const h = () => setExportOpen(false);
    window.addEventListener("click", h);
    return () => window.removeEventListener("click", h);
  }, [exportOpen]);

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      {/* 顶栏 */}
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border px-3">
        <Link href="/projects" className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-xs text-foreground/60 transition hover:border-foreground/30 hover:text-foreground">←</Link>
        <span className="text-sm font-medium text-foreground/90">{title}</span>
        <button onClick={openResize} title="修改画布尺寸（裁剪 / 拉伸）"
          className="rounded-md border border-border px-2 py-0.5 text-[11px] tabular-nums text-foreground/45 transition hover:border-foreground/30 hover:text-foreground">
          {docSize.w} × {docSize.h} px
        </button>
        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={() => setZoom(z => Math.min(8, z * 1.2))} className="h-7 w-7 rounded-md border border-border text-sm text-foreground/60 transition hover:text-foreground">+</button>
          <span className="w-12 text-center text-[11px] tabular-nums text-foreground/50">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(z => Math.max(0.05, z / 1.2))} className="h-7 w-7 rounded-md border border-border text-sm text-foreground/60 transition hover:text-foreground">−</button>
          <button onClick={fitView} className="h-7 rounded-md border border-border px-2 text-[11px] text-foreground/60 transition hover:text-foreground">适应</button>
          <button onClick={undo} disabled={undoCount === 0}
            className={`h-7 rounded-md border px-2 text-[11px] transition ${undoCount > 0 ? "border-border text-foreground/60 hover:text-foreground" : "cursor-not-allowed border-border/40 text-foreground/25"}`}>
            撤销 ({undoCount})
          </button>
          <button onClick={redo} disabled={redoCount === 0}
            className={`h-7 rounded-md border px-2 text-[11px] transition ${redoCount > 0 ? "border-border text-foreground/60 hover:text-foreground" : "cursor-not-allowed border-border/40 text-foreground/25"}`}>
            重做 ({redoCount})
          </button>
          <label className="flex h-7 cursor-pointer items-center rounded-md border border-border px-3 text-[11px] text-foreground/60 transition hover:text-foreground">
            导入
            <input type="file" accept="image/*,.psd,.psb,.svg,.tiff,.tif,.bmp,.avif" onChange={importFile} className="hidden" />
          </label>
          <div className="relative">
            <button onClick={(e) => { e.stopPropagation(); setExportOpen(o => !o); }} className="h-7 rounded-md border border-foreground/30 bg-card px-3 text-[11px] text-foreground/80 transition hover:border-foreground/50">导出 ▾</button>
            {exportOpen && (
              <div onClick={(e) => e.stopPropagation()} className="absolute right-0 top-8 z-50 w-28 overflow-hidden rounded-md border border-border bg-card shadow-lg">
                {[["png", "PNG（透明）"], ["jpg", "JPG（白底）"], ["webp", "WebP（透明）"], ["psd", "PSD（分层）"]].map(([fmt, label]) => (
                  <button key={fmt} onClick={() => { setExportOpen(false); exportImage(fmt as "png" | "jpg" | "webp" | "psd"); }}
                    className="block w-full px-3 py-1.5 text-left text-[11px] text-foreground/75 transition hover:bg-foreground/10 hover:text-foreground">{label}</button>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* 属性栏：恒定 h-9（随工具/选区/报错切换内容，高度永不变化 → 画幅不波动）*/}
      <div className={`flex h-9 shrink-0 items-center gap-2 border-b px-3 text-[12px] ${mattingError ? "border-red-500/40 bg-red-500/10" : "border-border bg-background/60"}`}>
        {mattingError ? (
          <>
            <span className="shrink-0 font-medium text-red-400">⚠</span>
            <span className="min-w-0 flex-1 truncate text-red-400" title={mattingError}>{mattingError}</span>
            <button onClick={() => setMattingError(null)} className="shrink-0 rounded px-1.5 text-red-400/60 hover:bg-red-500/20 hover:text-red-300">✕</button>
          </>
        ) : selection ? (
          <>
            <span className="text-foreground/50">选区 {selection.w}×{selection.h}</span>
            {tool === "wand" && <span className="rounded bg-foreground/10 px-1.5 text-[10px] text-foreground/60">魔棒 ×{wandClicks}</span>}
            <span className="h-4 w-px bg-border" />
            {tool === "wand" && (
              <label className="flex items-center gap-1.5 text-foreground/60">
                <span>容差</span>
                <input type="range" min={1} max={128} value={wandTol} onChange={e => setWandTol(+e.target.value)}
                  className="h-1 w-20 accent-foreground/60" />
                <span className="w-6 text-right tabular-nums text-foreground/50">{wandTol}</span>
              </label>
            )}
            <label className="flex items-center gap-1 text-foreground/60">
              <span>桶色</span>
              <ColorWheelPicker value={fillColor} onChange={setFillColor} />
            </label>
            <button onClick={() => applySelection(fillColor)} title="油漆桶：把选区填成桶色" className="h-6 rounded-md border border-border px-2 text-foreground/70 transition hover:bg-secondary hover:text-foreground">油漆桶</button>
            <button onClick={() => applySelection(null)} className="h-6 rounded-md border border-border px-2 text-foreground/70 transition hover:bg-secondary hover:text-foreground">清除选区</button>
            <button onClick={duplicateSelection} title="选区抠出：选区内像素保留、选区外透明，作为新图层" className="h-6 rounded-md border border-foreground/30 bg-foreground/5 px-2 text-foreground/80 transition hover:bg-foreground/15 hover:text-foreground">抠出新图层</button>
            <button onClick={cropSelectionToFile} title="裁剪成新文件：把选区范围裁下来直接导出为独立 PNG 下载（项目不动）" className="h-6 rounded-md border border-foreground/30 bg-foreground/5 px-2 text-foreground/80 transition hover:bg-foreground/15 hover:text-foreground">裁成新文件</button>
            <button onClick={clearSel} className="h-6 rounded-md border border-border px-2 text-foreground/50 transition hover:text-foreground">取消选区 (Esc)</button>
          </>
        ) : tool === "sam" ? (
          <>
            <span className="text-foreground/50">SAM 分割</span>
            <span className="h-4 w-px bg-border" />
            <button onClick={samSegmentAllNow} disabled={aiBusy || samAllBusy !== null}
              title="一次分割出图中所有元素，彩色叠图后点击抠出"
              className={`h-6 rounded-md border px-2 text-[11px] transition ${aiBusy || samAllBusy !== null ? "border-border text-foreground/30" : "border-foreground/30 bg-foreground/5 text-foreground/80 hover:bg-foreground/15 hover:text-foreground"}`}>全景分割</button>
            <span className="h-4 w-px bg-border" />
            {samAllBusy ? (
              <span className="text-[11px] text-foreground/60">分割中 {samAllBusy.done}/{samAllBusy.total} …</span>
            ) : samOverlay ? (
              <>
                <span className="text-[11px] text-foreground/40">检测到 {samRegions.length} 个元素 · 点击叠图上的颜色抠出</span>
                <div className="flex max-w-[40%] items-center gap-1 overflow-x-auto">
                  {samRegions.map((r, i) => (
                    <button key={i} onClick={() => pickRegionByIndex(i)} title={`抠出元素 ${i + 1}`}
                      className="h-4 w-4 shrink-0 rounded-sm border border-black/30" style={{ background: r.color }} />
                  ))}
                </div>
                <button onClick={samReset} className="h-6 rounded-md border border-border px-2 text-[11px] text-foreground/50 transition hover:text-foreground">清除叠图</button>
              </>
            ) : (
              <>
                <span className="text-[11px] text-foreground/40">
                  {samPoints.length === 0
                    ? "左键点击物体 · 右键排除区域"
                    : `已选 ${samPoints.length} 点${aiBusy ? " · 计算中…" : ""}`}
                </span>
                <span className="h-4 w-px bg-border" />
                <button onClick={samConfirm} disabled={samPoints.length === 0 || aiBusy}
                  className={`h-6 rounded-md border px-2 transition ${samPoints.length === 0 || aiBusy ? "border-border text-foreground/30" : "border-foreground/30 bg-foreground/5 text-foreground/80 hover:bg-foreground/15 hover:text-foreground"}`}>确认导出</button>
                <button onClick={samReset} disabled={samPoints.length === 0}
                  className={`h-6 rounded-md border border-border px-2 transition ${samPoints.length === 0 ? "text-foreground/30" : "text-foreground/50 hover:text-foreground"}`}>重置</button>
              </>
            )}
          </>
        ) : (tool === "brush" || tool === "eraser") ? (
          <>
            <span className="text-foreground/50">{tool === "brush" ? "画笔" : "橡皮"}</span>
            <span className="h-4 w-px bg-border" />
            {tool === "brush" && (
              <label className="flex items-center gap-1 text-foreground/60">
                <span>颜色</span>
                <ColorWheelPicker value={brushColor} onChange={setBrushColor} />
              </label>
            )}
            <label className="flex items-center gap-1.5 text-foreground/60">
              <span>大小</span>
              <input type="range" min={1} max={120} value={brushSize} onChange={e => setBrushSize(+e.target.value)} className="h-1 w-24 accent-foreground/60" />
              <span className="w-8 text-right tabular-nums text-foreground/50">{brushSize}px</span>
            </label>
            {tool === "brush" && (
              <label className="flex items-center gap-1.5 text-foreground/60">
                <span>不透明度</span>
                <input type="range" min={5} max={100} value={brushOpacity * 100} onChange={e => setBrushOpacity(+e.target.value / 100)} className="h-1 w-20 accent-foreground/60" />
                <span className="w-8 text-right tabular-nums text-foreground/50">{Math.round(brushOpacity * 100)}%</span>
              </label>
            )}
          </>
        ) : tool === "move" && selShape ? (
          <>
            <span className="text-foreground/50">变换{(() => {
              const s = layers.find(l => l.id === selShape.layer)?.shapes[selShape.index];
              return s ? (s.kind === "text" ? "文字" : s.kind === "image" ? "图片" : s.kind === "rect" ? "形状" : "线条") : "素材";
            })()}</span>
            <span className="h-4 w-px bg-border" />
            <label className="flex cursor-pointer items-center gap-1.5 text-foreground/60" title="勾选后拉手柄保持长宽比（等比缩放）；取消勾选可单轴自由拉伸">
              <input type="checkbox" checked={keepRatio} onChange={e => setKeepRatio(e.target.checked)} className="h-3 w-3 accent-foreground/60" />
              <span>等比例</span>
            </label>
            <span className="text-[10px] text-foreground/30">{keepRatio ? "拉角等比缩放" : "拉边单轴拉伸"}</span>
            <span className="h-4 w-px bg-border" />
            <button onClick={deleteSelShape} className="h-6 rounded-md border border-border px-2 text-foreground/60 transition hover:text-foreground">删除 (Del)</button>
          </>
        ) : (
          <span className="text-[11px] text-foreground/30">{TOOLS.find(t => t.id === tool)?.label ?? ""}</span>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        {/* 左：工具栏 */}
        <aside className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border py-2">
          {TOOLS.map(t => (
            <button key={t.id} title={t.label} onClick={() => { if (t.id !== "sam") samReset(); setTool(t.id); }}
              className={`flex h-9 w-9 items-center justify-center rounded-lg text-sm transition ${tool === t.id ? "bg-foreground/15 text-foreground" : "text-foreground/50 hover:bg-foreground/5 hover:text-foreground/80"}`}>
              {t.icon}
            </button>
          ))}
          {/* AI 区 */}
          <div className="mt-2 w-8 border-t border-border pt-2">
            <button title="快速抠像（u2netp 主体提取）" onClick={doMatting} disabled={aiBusy}
              className={`flex h-9 w-9 items-center justify-center rounded-lg text-sm transition ${aiBusy ? "animate-pulse text-foreground/40" : "text-foreground/60 hover:bg-foreground/10 hover:text-foreground"}`}>
              ✂
            </button>
            <button title="快速填充（内容识别，擦除细线/钢丝等窄结构）" onClick={doSmartFill} disabled={aiBusy || !selection}
              className={`mt-1 flex h-9 w-9 items-center justify-center rounded-lg text-sm transition ${(aiBusy || !selection) ? "text-foreground/25" : "text-foreground/60 hover:bg-foreground/10 hover:text-foreground"}`}>
              ✦
            </button>
          </div>
        </aside>

        {/* 中：标尺 + 画布 */}
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 border-b border-border">
            <div className="w-5" />
            <Ruler zoom={zoom} origin={originX} length={viewW} dir="h" />
          </div>
          <div className="flex min-h-0 flex-1">
            <div className="w-5 shrink-0">
              <Ruler zoom={zoom} origin={originY} length={viewH} dir="v" />
            </div>
            <div ref={vpRef} className="relative min-w-0 flex-1 overflow-hidden"
              style={{ background: "oklch(0.14 0.005 260)", cursor: spaceDown || tool === "move" ? "grab" : tool === "wand" || tool === "lasso" || tool === "sam" ? "crosshair" : tool === "brush" || tool === "eraser" ? "cell" : "default" }}
              onDragEnter={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragOver={(e) => e.preventDefault()}
              onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }}
              onDrop={onCanvasDrop}>
              {dragOver && (
                <div className="pointer-events-none absolute inset-3 z-40 flex items-center justify-center rounded-xl border-2 border-dashed"
                  style={{ borderColor: "oklch(0.82 0.16 180 / 0.8)", background: "oklch(0.82 0.16 180 / 0.08)" }}>
                  <p className="text-sm font-medium" style={{ color: "oklch(0.85 0.14 190)" }}>松开 · 图片落到此处成为新图层</p>
                </div>
              )}
              <div className="absolute" style={{ left: viewW / 2 - scroll.x * zoom, top: viewH / 2 - scroll.y * zoom, width: docSize.w * zoom, height: docSize.h * zoom, background: CHECKER, boxShadow: "0 0 0 1px oklch(0.3 0.01 260), 0 12px 40px -12px black" }}>
                <KonvaStage
                  ref={stageRef}
                  width={docSize.w * zoom} height={docSize.h * zoom}
                  scaleX={zoom} scaleY={zoom}
                  onMouseDown={onStageMouseDown}
                  onMouseMove={onStageMouseMove}
                  onMouseUp={endStroke}
                  onMouseLeave={endStroke}
                  onContextMenu={(e: any) => { e.evt.preventDefault(); }}
                  style={{ position: "absolute", inset: 0 }}
                >
                  {/* 全幅透明捕获层：保证空白处点击也派发事件（魔棒/套索/填充落点） */}
                  <KLayer>
                    <KRect x={0} y={0} width={docSize.w} height={docSize.h} fill="#fff" opacity={0} listening={true} />
                  </KLayer>
                  {layers.map(l => l.visible && (
                    <KLayer key={l.id} opacity={l.opacity} name={l.id}
                      globalCompositeOperation={l.blendMode ? BLEND_TO_COMPOSITE[l.blendMode] : "source-over"}
                      ref={(ref) => { if (ref) layerRefs.current[l.id] = ref; else delete layerRefs.current[l.id]; }}>
                      {l.shapes.map((s, i) => {
                        // 移动工具下所有素材通用：点选+拖动+Transformer 变换（文字只是其中一种图层素材）
                        const mv = tool === "move";
                        const common: any = {
                          name: `shape-${i}`,
                          opacity: s.opacity,
                          draggable: mv,
                          scaleX: s.kind !== "line" ? s.scaleX ?? 1 : s.scaleX,
                          scaleY: s.kind !== "line" ? s.scaleY ?? 1 : s.scaleY,
                          onMouseDown: mv ? (e: any) => { e.cancelBubble = true; setSelShape({ layer: l.id, index: i }); } : undefined,
                          onDragStart: mv ? () => { pushUndo(); } : undefined,
                          onDragEnd: mv ? (e: any) => {
                            const n = e.target;
                            setLayers(ls => ls.map(ll => ll.id === l.id
                              ? { ...ll, shapes: ll.shapes.map((ss, ii) => ii === i ? { ...ss, x: n.x(), y: n.y() } as ShapeNode : ss) }
                              : ll));
                          } : undefined,
                        };
                        if (s.kind === "rect") return <KRect key={i} x={s.x} y={s.y} width={s.w} height={s.h} fill={s.fill} cornerRadius={s.cornerRadius} {...common} />;
                        if (s.kind === "text") return (
                          <KText
                            key={i}
                            x={s.x} y={s.y} text={s.text} fontSize={s.fontSize} fill={s.fill}
                            stroke={s.stroke} strokeWidth={s.strokeWidth} fontFamily="serif"
                            hitStrokeWidth={24}
                            onDblClick={mv ? (e: any) => { e.cancelBubble = true; editTextAt(l.id, i); } : undefined}
                            {...common}
                          />
                        );
                        if (s.kind === "line") return <KLine key={i} x={s.x ?? 0} y={s.y ?? 0} points={s.points} stroke={s.stroke} strokeWidth={s.strokeWidth} tension={s.tension} lineCap="round" lineJoin="round" globalCompositeOperation={(s.composite as any) ?? "source-over"} {...common} />;
                        if (s.kind === "image") return <ImageShape key={i} s={s} forceSize={l.id === "L1" ? docSize : undefined} extra={common} />;
                        return null;
                      })}
                      {strokes[l.id] && <KLine points={strokes[l.id]} stroke={tool === "eraser" ? "rgba(0,0,0,0.7)" : brushColor} strokeWidth={brushSize} opacity={tool === "eraser" ? 0.7 : brushOpacity} tension={0.5} lineCap="round" lineJoin="round" globalCompositeOperation={tool === "eraser" ? "destination-out" : "source-over"} listening={false} />}
                    </KLayer>
                  ))}
                  {/* 选区遮罩 + 套索预览（顶层，不导出） */}
                  <KLayer ref={overlayRef}>
                    {selShape && tool === "move" && (
                      <KTransformer
                        ref={transformerRef}
                        rotateEnabled={false}
                        keepRatio={keepRatio}
                        ignoreStroke
                        anchorSize={7}
                        borderStroke="#3c9be8"
                        anchorStroke="#3c9be8"
                        anchorFill="#fff"
                        boundBoxFunc={(oldBox, newBox) => (newBox.width < 4 || newBox.height < 4 ? oldBox : newBox)}
                        onTransformStart={() => { pushUndo(); }}
                        onTransformEnd={(e: any) => {
                          // 自由变换结束：把手柄的 scale 写回 shape（通用：字号/宽高不变，形变独立存储）
                          const sel = selShapeRef.current;
                          const node = e.target;
                          if (!sel || !node) return;
                          const sx = node.scaleX(), sy = node.scaleY();
                          setLayers(ls => ls.map(l => l.id === sel.layer
                            ? { ...l, shapes: l.shapes.map((ss, ii) => ii === sel.index
                                ? { ...ss, x: node.x(), y: node.y(), scaleX: sx, scaleY: sy } as ShapeNode : ss) }
                            : l));
                        }}
                      />
                    )}
                    {selCanvas && <KImage image={selCanvas} x={0} y={0} width={docSize.w} height={docSize.h} opacity={0.85} listening={false} />}
                    {/* SAM mask 预览 + 点标记（青色=前景点，红=背景点） */}
                    {tool === "sam" && samOverlay && samBaseRef.current && (
                      <KImage image={samOverlay} x={samBaseRef.current.x} y={samBaseRef.current.y} width={samOverlay.width} height={samOverlay.height} opacity={0.55} listening={false} />
                    )}
                    {tool === "sam" && samMask && !samOverlay && samBaseRef.current && (
                      <KImage image={samMask} x={samBaseRef.current.x} y={samBaseRef.current.y} width={samMask.width} height={samMask.height} opacity={0.9} listening={false} />
                    )}
                    {tool === "sam" && samPoints.map((p, i) => (
                      <KCircle key={i} x={p.x + (samBaseRef.current?.x ?? 0)} y={p.y + (samBaseRef.current?.y ?? 0)} radius={4 / zoom}
                        fill={p.label === 1 ? "oklch(0.82 0.16 180)" : "#f43f5e"}
                        stroke="#000" strokeWidth={1 / zoom} listening={false} />
                    ))}
                    {lassoLive.length > 1 && <KLine points={lassoLive.flatMap(p => [p.x, p.y])} stroke="oklch(0.85 0.12 190)" strokeWidth={2 / zoom} dash={[6 / zoom, 4 / zoom]} closed listening={false} />}
                    {lassoLive.length > 0 && <KCircle x={lassoLive[0].x} y={lassoLive[0].y} radius={4 / zoom} fill="oklch(0.85 0.12 190)" listening={false} />}
                    {dragSel && tool === "rect" && (
                      <KRect
                        x={Math.min(dragSel.x0, dragSel.x1)} y={Math.min(dragSel.y0, dragSel.y1)}
                        width={Math.abs(dragSel.x1 - dragSel.x0)} height={Math.abs(dragSel.y1 - dragSel.y0)}
                        stroke="oklch(0.85 0.12 190)" strokeWidth={1.5 / zoom} dash={[6 / zoom, 4 / zoom]} fill="rgba(60,220,205,0.12)" listening={false} />
                    )}
                    {dragSel && tool === "ellipse" && (
                      <KEllipse
                        x={(dragSel.x0 + dragSel.x1) / 2} y={(dragSel.y0 + dragSel.y1) / 2}
                        radiusX={Math.abs(dragSel.x1 - dragSel.x0) / 2} radiusY={Math.abs(dragSel.y1 - dragSel.y0) / 2}
                        stroke="oklch(0.85 0.12 190)" strokeWidth={1.5 / zoom} dash={[6 / zoom, 4 / zoom]} fill="rgba(60,220,205,0.12)" listening={false} />
                    )}
                    {(tool === "brush" || tool === "eraser") && cursor && (
                      <KCircle x={cursor.x} y={cursor.y} radius={brushSize / 2}
                        stroke={tool === "brush" ? brushColor : "rgba(255,255,255,0.8)"} strokeWidth={1 / zoom}
                        fill="rgba(0,0,0,0)" listening={false} />
                    )}
                  </KLayer>
                </KonvaStage>
              </div>
              {cursor && (
                <div className="absolute bottom-2 left-2 rounded-md bg-black/60 px-2 py-1 text-[10px] tabular-nums text-foreground/60 backdrop-blur">
                  {Math.round(cursor.x)}, {Math.round(cursor.y)}
                </div>
              )}
              {/* 文字输入浮层（点击定位处，绝对定位不占布局）*/}
              {textDraft && (
                <div
                  className="absolute z-40 w-64 -translate-x-1/2 rounded-lg border border-foreground/25 bg-card/95 p-3 shadow-xl backdrop-blur"
                  style={{ left: viewW / 2 - scroll.x * zoom + textDraft.x * zoom, top: viewH / 2 - scroll.y * zoom + textDraft.y * zoom }}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <input
                    autoFocus
                    value={textInput}
                    onChange={(e) => setTextInput(e.target.value)}
                    onKeyDown={(e) => {
                      // 输入法组词中（候选词未上屏）不提交，避免半成品拼音被放上画布
                      if (e.key === "Enter" && !e.nativeEvent.isComposing) commitText();
                    }}
                    placeholder="输入文字…"
                    className="mb-2 w-full rounded-md border border-border bg-background/60 px-2 py-1.5 text-sm text-foreground outline-none focus:border-foreground/40"
                  />
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1 text-[11px] text-foreground/60">
                      色
                      <ColorWheelPicker value={textColor} onChange={c => { colorTouched.current = true; setTextColor(c); }} />
                    </label>
                    <label className="flex flex-1 items-center gap-1 text-[11px] text-foreground/60">
                      字号
                      <input type="range" min={12} max={200} value={textFontSize} onChange={e => setTextFontSize(+e.target.value)} className="h-1 flex-1 accent-foreground/60" />
                      <span className="w-7 text-right tabular-nums text-foreground/50">{textFontSize}</span>
                    </label>
                  </div>
                  <div className="mt-2 flex justify-end gap-1.5">
                    <button onClick={() => setTextDraft(null)} className="h-6 rounded-md border border-border px-2 text-[11px] text-foreground/50 transition hover:text-foreground">取消</button>
                    <button onClick={commitText} className="h-6 rounded-md border border-foreground/40 bg-card px-3 text-[11px] text-foreground/80 transition hover:border-foreground/60">放置</button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 底部 step timeline（仅水墨 demo 项目展示） */}
          {id === "ink" && (
          <div className="shrink-0 border-t border-border px-4 py-2">
            <p className="mb-1.5 text-[10px] tracking-widest text-foreground/40">STEP TIMELINE</p>
            <div className="flex items-center gap-2 overflow-x-auto">
              {STEPS.map((s, i) => (
                <div key={s.id} className="flex items-center gap-2">
                  <div className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 ${s.status === "accepted" ? "border-border bg-card/50" : "border-foreground/30 bg-card/80"}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${s.status === "accepted" ? "bg-emerald-400/70" : "bg-amber-400"}`} />
                    <span className="text-[11px] text-foreground/75">{s.label}</span>
                    <span className="text-[10px] text-foreground/35">{s.by} · {s.time}</span>
                  </div>
                  {i < STEPS.length - 1 && <span className="text-foreground/25">→</span>}
                </div>
              ))}
            </div>
          </div>
          )}
        </section>

        {/* 右：图层 + 智能体 */}
        <aside className="flex w-60 shrink-0 flex-col border-l border-border">
          <div className="flex-1 overflow-y-auto p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[10px] tracking-widest text-foreground/40">图层</p>
              <button onClick={newEmptyLayer} title="新建空图层"
                className="rounded-md border border-border px-2 py-0.5 text-[11px] text-foreground/60 transition hover:bg-secondary hover:text-foreground">＋ 新建</button>
            </div>
            <div className="space-y-1">
              {[...layers].reverse().map(l => (
                <div key={l.id}>
                  <div onClick={() => setActiveLayer(l.id)}
                    className={`group flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-2 transition ${activeLayer === l.id ? "border-foreground/30 bg-foreground/10" : "border-transparent hover:bg-foreground/5"}`}>
                    <button onClick={(e) => { e.stopPropagation(); toggleVis(l.id); }}
                      className="text-xs text-foreground/50 hover:text-foreground">{l.visible ? "◉" : "◎"}</button>
                    <span className="flex-1 truncate text-xs text-foreground/80">{l.name}</span>
                    <div className="hidden gap-0.5 group-hover:block">
                      <button title="上移一层" onClick={(e) => { e.stopPropagation(); moveLayer(l.id, 1); }} className="px-1 text-[10px] text-foreground/40 hover:text-foreground">↑</button>
                      <button title="下移一层" onClick={(e) => { e.stopPropagation(); moveLayer(l.id, -1); }} className="px-1 text-[10px] text-foreground/40 hover:text-foreground">↓</button>
                      <button title="删除图层" onClick={(e) => { e.stopPropagation(); deleteLayer(l.id); }} className="px-1 text-[10px] text-foreground/40 hover:text-red-400">✕</button>
                    </div>
                  </div>
                  {/* 图层内素材子行（仿 PS 智能对象展开）：文字/图片/形状/线条各自可点选、删除 */}
                  {l.shapes.length > 0 && (
                    <div className="ml-4 mt-0.5 space-y-0.5 border-l border-border/60 pl-2">
                      {[...l.shapes].map((s, i) => ({ s, i })).reverse().map(({ s, i }) => {
                        const sel = selShape && selShape.layer === l.id && selShape.index === i;
                        const meta = s.kind === "text" ? { icon: "T", name: s.text.slice(0, 12) || "文字" }
                          : s.kind === "image" ? { icon: "▨", name: "图片" }
                          : s.kind === "rect" ? { icon: "▭", name: "形状" }
                          : { icon: "〰", name: "线条" };
                        return (
                          <div key={i}
                            onClick={() => { setActiveLayer(l.id); setTool("move"); setSelShape({ layer: l.id, index: i }); }}
                            onDoubleClick={() => { if (s.kind === "text") { setSelShape(null); editTextAt(l.id, i); } }}
                            title={s.kind === "text" ? "双击重编辑文字" : "点选后可在画布上变换"}
                            className={`group flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 text-[11px] transition ${sel ? "bg-foreground/15 text-foreground" : "text-foreground/55 hover:bg-foreground/5"}`}>
                            <span className="w-3 shrink-0 text-center text-[10px] text-foreground/40">{meta.icon}</span>
                            <span className="flex-1 truncate">{meta.name}</span>
                            <button title="删除素材" onClick={(e) => { e.stopPropagation(); pushUndo(); setLayers(ls => ls.map(ll => ll.id === l.id ? { ...ll, shapes: ll.shapes.filter((_, ii) => ii !== i) } : ll)); if (sel) setSelShape(null); }}
                              className="hidden text-[10px] text-foreground/40 hover:text-red-400 group-hover:block">✕</button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* 样式区：选中图层后显示（模仿 PS 图层样式 + Camera Raw 调色） */}
            {activeLayerObj && (
              <div className="mt-4 border-t border-border pt-3">
                <p className="mb-3 text-[10px] tracking-widest text-foreground/40">样式</p>

                {/* 不透明度 */}
                <div className="mb-3">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[10px] text-foreground/50">不透明度</span>
                    <span className="text-[10px] tabular-nums text-foreground/70">{Math.round(activeLayerObj.opacity * 100)}%</span>
                  </div>
                  <input type="range" min={0} max={100} step={1}
                    value={Math.round(activeLayerObj.opacity * 100)}
                    onChange={e => setLayerOpacity(activeLayerObj.id, Number(e.target.value) / 100)}
                    className="w-full cursor-pointer accent-cyan-500" />
                </div>

                {/* 混合模式 */}
                <div className="mb-3">
                  <span className="mb-1 block text-[10px] text-foreground/50">混合模式</span>
                  <select value={activeLayerObj.blendMode ?? "normal"}
                    onChange={e => setLayerBlendMode(activeLayerObj.id, e.target.value as BlendMode)}
                    className="w-full rounded-md border border-border bg-card px-2 py-1 text-[11px] text-foreground/80 outline-none focus:border-foreground/30">
                    {BLEND_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>

                {/* 调色（Camera Raw 基础面板） */}
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[10px] tracking-widest text-foreground/40">调色</p>
                  <button onClick={() => resetLayerAdjust(activeLayerObj.id)}
                    className="text-[10px] text-foreground/40 transition hover:text-foreground">重置</button>
                </div>
                {ADJUST_GROUPS.map(g => {
                  const open = openGroups.has(g.label);
                  return (
                    <div key={g.label} className="mb-1">
                      <button
                        onClick={() => setOpenGroups(prev => {
                          const n = new Set(prev);
                          if (n.has(g.label)) n.delete(g.label); else n.add(g.label);
                          return n;
                        })}
                        className="mb-1 flex w-full items-center justify-between rounded px-1 py-0.5 text-[10px] text-foreground/50 transition hover:bg-foreground/5 hover:text-foreground">
                        <span>{open ? "▾" : "▸"} {g.label}</span>
                        <span className="text-foreground/35">{g.fields.length} 项</span>
                      </button>
                      {open && g.fields.map(f => (
                        <div key={f.key} className="mb-2">
                          <div className="mb-0.5 flex items-center justify-between">
                            <span className="text-[10px] text-foreground/50">{f.label}</span>
                            <span className="text-[10px] tabular-nums text-foreground/70">{Math.round(activeAdjust[f.key])}</span>
                          </div>
                          <input type="range" min={f.min} max={f.max} step={1}
                            value={Math.round(activeAdjust[f.key])}
                            onChange={e => setLayerAdjust(activeLayerObj.id, f.key, Number(e.target.value))}
                            className="w-full cursor-pointer accent-cyan-500" />
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className="border-t border-border p-3">
            <p className="mb-2 text-[10px] tracking-widest text-foreground/40">智能体</p>
            <ApiAgent onAddImage={addApiResultImage} getImageSource={getImageSource} hasSelection={!!selection} />
          </div>
        </aside>
      </div>

      {/* 画布尺寸对话框（裁剪 / 拉伸） */}
      {resizeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setResizeOpen(false)}>
          <div className="w-[380px] rounded-2xl border border-border bg-card p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-4 text-sm font-medium text-foreground/80">画布尺寸</h2>
            {/* 模式切换 */}
            <div className="mb-4 flex gap-2">
              {([["crop", "裁剪（画布大小）"], ["stretch", "拉伸（图像大小）"]] as const).map(([m, label]) => (
                <button key={m} onClick={() => setResizeMode(m)}
                  className={`flex-1 rounded-lg border px-3 py-2 text-xs transition ${resizeMode === m ? "text-foreground" : "border-border text-foreground/55 hover:border-foreground/25"}`}
                  style={resizeMode === m ? { borderColor: "var(--brand-cyan)" } : undefined}>
                  {label}
                </button>
              ))}
            </div>
            {/* 宽高 */}
            <div className="mb-4 flex items-center gap-2">
              <label className="flex-1">
                <span className="mb-1 block text-[11px] text-foreground/45">宽（px）</span>
                <input value={rw} onChange={(e) => setRw(e.target.value.replace(/\D/g, ""))}
                  className="w-full rounded-lg border border-border bg-black/40 px-3 py-2 text-sm tabular-nums focus:border-foreground/30 focus:outline-none" />
              </label>
              <span className="mt-5 text-foreground/40">×</span>
              <label className="flex-1">
                <span className="mb-1 block text-[11px] text-foreground/45">高（px）</span>
                <input value={rh} onChange={(e) => setRh(e.target.value.replace(/\D/g, ""))}
                  className="w-full rounded-lg border border-border bg-black/40 px-3 py-2 text-sm tabular-nums focus:border-foreground/30 focus:outline-none" />
              </label>
            </div>
            <p className="mb-4 text-[11px] text-foreground/40">
              {resizeMode === "crop" ? "裁剪：画布改大小，内容不动，超出部分被裁掉" : "拉伸：内容随画布等比缩放变形"}
            </p>
            {/* 操作 */}
            <div className="flex justify-end gap-2">
              <button onClick={() => setResizeOpen(false)}
                className="rounded-lg px-4 py-2 text-sm text-foreground/60 transition hover:bg-accent hover:text-foreground">取消</button>
              <button onClick={applyResize}
                className="rounded-lg px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
                style={{ background: "oklch(0.94 0 0)" }}>应用</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
