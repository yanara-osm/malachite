"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Stage, Layer as KLayer, Rect as KRect, Line as KLine, Image as KImage, Text as KText, Circle as KCircle, Ellipse as KEllipse } from "react-konva";
import Konva from "konva";
import dynamic from "next/dynamic";
import Link from "next/link";
import Ruler from "./Ruler";
import { DOC_W, DOC_H } from "./types";
import type { Layer, Tool, StepEntry } from "./types";
import { magicWand, lasso, rectSelection, ellipseSelection, fillSelection, selectionToCanvas, type Selection } from "./selection";

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

function ImageShape({ s, forceSize }: { s: any; forceSize?: { w: number; h: number } }) {
  const img = UseImage(s.src);
  if (!img) return null;
  const w = forceSize ? forceSize.w : s.w;
  const h = forceSize ? forceSize.h : s.h;
  return <KImage image={img} x={s.x} y={s.y} width={w} height={h} opacity={s.opacity} />;
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
];

const STEPS: StepEntry[] = [
  { id: "s1", label: "生成水墨底图", by: "AI", status: "accepted", time: "14:02" },
  { id: "s2", label: "扩展画布 16:9", by: "AI", status: "accepted", time: "14:05" },
  { id: "s3", label: "手动调整主峰位置", by: "你", status: "accepted", time: "14:09" },
  { id: "s4", label: "局部重绘 · 雾气", by: "AI", status: "pending", time: "14:12" },
];

const CHECKER =
  "repeating-conic-gradient(oklch(0.22 0.005 260) 0% 25%, oklch(0.16 0.005 260) 0% 50%) 0 / 16px 16px";

export default function Workbench({ id, title, cover }: { id: string; title: string; cover: string }) {
  const [zoom, setZoom] = useState(0.42);
  const [scroll, setScroll] = useState({ x: 0, y: 0 });
  const [tool, setTool] = useState<Tool>("move");
  const [layers, setLayers] = useState<Layer[]>(() => {
    // 只有水墨 demo 项目带预置图层，其他项目只有底图
    if (id === "ink") {
      return [
        { id: "L1", name: "水墨底图", visible: true, opacity: 1, shapes: [{ kind: "image", x: 0, y: 0, w: DOC_W, h: DOC_H, src: cover, opacity: 1 }] },
        { id: "L2", name: "雾气 · 重绘", visible: true, opacity: 0.4, shapes: [{ kind: "rect", x: 200, y: 560, w: 1000, h: 300, fill: "rgba(245,243,238,0.55)", opacity: 1, cornerRadius: 140 }] },
        { id: "L3", name: "主峰标注", visible: true, opacity: 1, shapes: [{ kind: "text", x: 640, y: 300, text: "主峰", fontSize: 48, fill: "#1c1a17", stroke: "rgba(255,255,255,0.7)", strokeWidth: 1.5, opacity: 1 }] },
      ];
    }
    return [
      { id: "L1", name: "底图", visible: true, opacity: 1, shapes: [{ kind: "image", x: 0, y: 0, w: DOC_W, h: DOC_H, src: cover, opacity: 1 }] },
    ];
  });
  const [activeLayer, setActiveLayer] = useState(id === "ink" ? "L3" : "L1");
  const [brushes, setBrushes] = useState<Record<string, { points: number[]; color: string; width: number }>>({});
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [strokes, setStrokes] = useState<Record<string, number[][]>>({});
  const stageRef = useRef<any>(null);
  const overlayRef = useRef<any>(null);
  const drawing = useRef(false);
  const pointRef = useRef<number[]>([]);
  const vpRef = useRef<HTMLDivElement>(null);
  const [viewSize, setViewSize] = useState({ w: 900, h: 560 });
  const [docSize, setDocSize] = useState({ w: DOC_W, h: DOC_H });
  const [dbgNatural, setDbgNatural] = useState("?");

  // 拖拽新建项目（d 前缀）：文档尺寸 + 底图跟随图片真实长宽比（demo 项目保持 DOC_W/DOC_H）
  useEffect(() => {
    if (!id.startsWith("d")) return;
    const i = new window.Image();
    i.onload = () => {
      const w = i.naturalWidth, h = i.naturalHeight;
      if (!w || !h) return;
      setDbgNatural(`${w}×${h}`);
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
  const [selection, setSelection] = useState<Selection | null>(null);
  const [selCanvas, setSelCanvas] = useState<HTMLCanvasElement | null>(null);
  const [fillColor, setFillColor] = useState("#3c9be8");
  const [brushColor, setBrushColor] = useState("#1c1a17");
  const [brushSize, setBrushSize] = useState(8);
  const [brushOpacity, setBrushOpacity] = useState(1);
  const [aiBusy, setAiBusy] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [mattingError, setMattingError] = useState<string | null>(null);
  // 文字工具：点击画布 → 弹输入浮层
  const [textDraft, setTextDraft] = useState<{ x: number; y: number } | null>(null);
  const [textInput, setTextInput] = useState("");
  const [textFontSize, setTextFontSize] = useState(48);
  const [textColor, setTextColor] = useState("#ffffff");
  const [wandTol, setWandTol] = useState(32);
  const [wandClicks, setWandClicks] = useState(0);
  const [lassoLive, setLassoLive] = useState<{ x: number; y: number }[]>([]);
  const [dragSel, setDragSel] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const lassoPts = useRef<{ x: number; y: number }[]>([]);
  const undoStack = useRef<Layer[][]>([]);
  const [undoCount, setUndoCount] = useState(0);
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
      if (e.code === "Space") { e.preventDefault(); setSpaceDown(true); return; }
      if (e.key === "Escape") { clearSel(); lassoPts.current = []; setLassoLive([]); setTextDraft(null); }
      if ((e.ctrlKey || e.metaKey) && e.key === "z") { e.preventDefault(); undo(); }
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

  // 放置文字（从输入浮层提交）
  const commitText = () => {
    if (!textDraft) return;
    const content = textInput.trim();
    if (!content) { setTextDraft(null); return; }
    pushUndo();
    setLayers(ls => ls.map(l => l.id === activeLayer
      ? { ...l, shapes: [{ kind: "text", x: textDraft.x, y: textDraft.y, text: content, fontSize: textFontSize, fill: textColor, opacity: 1 }, ...l.shapes] }
      : l));
    setTextDraft(null);
    setTool("move"); // 放完切回移动工具，避免误触
  };

  // 撤销：填充/清除前把 layers 快照压栈
  const pushUndo = useCallback(() => {
    undoStack.current.push(layers);
    if (undoStack.current.length > 30) undoStack.current.shift();
    setUndoCount(undoStack.current.length);
  }, [layers]);
  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    setLayers(prev);
    setUndoCount(undoStack.current.length);
    clearSel();
  }, []);

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
    // drop 点 → 文档坐标
    const pos = st.getRelativePosition({ x: e.clientX, y: e.clientY });
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
    // 平移优先：空格+左键 或 中键（PS 式）
    const isMiddle = e.evt && e.evt.button === 1;
    if (spaceDown || isMiddle) {
      e.evt?.preventDefault?.();
      pan.current = { sx: e.evt.clientX, sy: e.evt.clientY, ox: scroll.x, oy: scroll.y };
      return;
    }
    if (tool === "move") return;
    const p = toStage(e);
    if (tool === "wand") { onWand(p.x, p.y); return; }
    if (tool === "lasso") { lassoPts.current = [{ x: p.x, y: p.y }]; drawing.current = true; return; }
    if (tool === "rect" || tool === "ellipse") { setDragSel({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }); drawing.current = true; return; }
    drawing.current = true;
    if (tool === "brush" || tool === "eraser") {
      pointRef.current = [p.x, p.y, p.x, p.y];
    } else if (tool === "fill") {
      // 有选区→对选区填当前色；无选区→铺满活动层
      if (selection) { applySelection(fillColor); }
      else setLayers(ls => ls.map(l => l.id === activeLayer ? { ...l, shapes: [{ kind: "rect", x: 0, y: 0, w: docSize.w, h: docSize.h, fill: fillColor, opacity: 0.35, cornerRadius: 0 }, ...l.shapes] } : l));
    } else if (tool === "text") {
      // 点击画布 → 打开文字输入浮层（在定位处放置）
      setTextInput("");
      setTextDraft({ x: Math.round(p.x), y: Math.round(p.y) });
    }
  };

  const onStageMouseMove = (e: any) => {
    // 平移中：按拖拽位移更新 scroll（屏幕像素 / zoom = 文档像素）
    if (pan.current) {
      const dx = e.evt.clientX - pan.current.sx;
      const dy = e.evt.clientY - pan.current.sy;
      setScroll({ x: pan.current.ox + dx / zoom, y: pan.current.oy + dy / zoom });
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
      const pts = pointRef.current;
      setLayers(ls => ls.map(l => l.id === activeLayer
        ? { ...l, shapes: [{ kind: "line", points: pts, stroke: tool === "eraser" ? "rgba(0,0,0,0.9)" : "oklch(0.85 0.12 190)", strokeWidth: tool === "eraser" ? 28 : 8, opacity: 1, tension: 0.5, composite: tool === "eraser" ? "destination-out" : "source-over" }, ...l.shapes] }
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

  const exportImage = async (fmt: "png" | "jpg" | "webp" | "psd") => {
    try {
      const st = stageRef.current;
      if (!st) return;
      const ov = overlayRef.current;
      if (ov) { ov.visible(false); ov.batchDraw(); }
      const dataUrl = st.toDataURL({ pixelRatio: 1, mimeType: fmt === "jpg" ? "image/jpeg" : fmt === "webp" ? "image/webp" : "image/png" });
      if (ov) { ov.visible(true); ov.batchDraw(); }
      const full = document.createElement("canvas");
      full.width = docSize.w; full.height = docSize.h;
      const ctx = full.getContext("2d")!;
      // JPG 不支持透明 → 白底
      if (fmt === "jpg") { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, full.width, full.height); }
      await new Promise<void>((res, rej) => {
        const img = new Image();
        img.onload = () => { ctx.drawImage(img, 0, 0); res(); };
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
        <span className="rounded-md border border-border px-2 py-0.5 text-[11px] tabular-nums text-foreground/45">{docSize.w} × {docSize.h} px</span>
        <span className="rounded-md border border-amber-500/50 bg-amber-500/10 px-2 py-0.5 text-[11px] tabular-nums text-amber-400">
          DEBUG doc={docSize.w}×{docSize.h} | L1={layers.find(l => l.id === "L1")?.shapes[0] ? (layers.find(l => l.id === "L1")!.shapes[0] as any).w + "×" + (layers.find(l => l.id === "L1")!.shapes[0] as any).h : "?"} | natural={dbgNatural} | zoom={Math.round(zoom*100)}%
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={() => setZoom(z => Math.min(8, z * 1.2))} className="h-7 w-7 rounded-md border border-border text-sm text-foreground/60 transition hover:text-foreground">+</button>
          <span className="w-12 text-center text-[11px] tabular-nums text-foreground/50">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(z => Math.max(0.05, z / 1.2))} className="h-7 w-7 rounded-md border border-border text-sm text-foreground/60 transition hover:text-foreground">−</button>
          <button onClick={fitView} className="h-7 rounded-md border border-border px-2 text-[11px] text-foreground/60 transition hover:text-foreground">适应</button>
          <button onClick={undo} disabled={undoCount === 0}
            className={`h-7 rounded-md border px-2 text-[11px] transition ${undoCount > 0 ? "border-border text-foreground/60 hover:text-foreground" : "cursor-not-allowed border-border/40 text-foreground/25"}`}>
            撤销 ({undoCount})
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
              <input type="color" value={fillColor} onChange={e => setFillColor(e.target.value)} className="h-5 w-6 cursor-pointer rounded border border-border bg-transparent" />
            </label>
            <button onClick={() => applySelection(fillColor)} title="油漆桶：把选区填成桶色" className="h-6 rounded-md border border-border px-2 text-foreground/70 transition hover:bg-secondary hover:text-foreground">油漆桶</button>
            <button onClick={() => applySelection(null)} className="h-6 rounded-md border border-border px-2 text-foreground/70 transition hover:bg-secondary hover:text-foreground">清除选区</button>
            <button onClick={clearSel} className="h-6 rounded-md border border-border px-2 text-foreground/50 transition hover:text-foreground">取消选区 (Esc)</button>
          </>
        ) : (tool === "brush" || tool === "eraser") ? (
          <>
            <span className="text-foreground/50">{tool === "brush" ? "画笔" : "橡皮"}</span>
            <span className="h-4 w-px bg-border" />
            {tool === "brush" && (
              <label className="flex items-center gap-1 text-foreground/60">
                <span>颜色</span>
                <input type="color" value={brushColor} onChange={e => setBrushColor(e.target.value)} className="h-5 w-6 cursor-pointer rounded border border-border bg-transparent" />
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
        ) : (
          <span className="text-[11px] text-foreground/30">{TOOLS.find(t => t.id === tool)?.label ?? ""}</span>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        {/* 左：工具栏 */}
        <aside className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border py-2">
          {TOOLS.map(t => (
            <button key={t.id} title={t.label} onClick={() => setTool(t.id)}
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
              style={{ background: "oklch(0.14 0.005 260)", cursor: spaceDown ? "grab" : tool === "wand" || tool === "lasso" ? "crosshair" : tool === "brush" || tool === "eraser" ? "cell" : "default" }}
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
                  style={{ position: "absolute", inset: 0 }}
                >
                  {/* 全幅透明捕获层：保证空白处点击也派发事件（魔棒/套索/填充落点） */}
                  <KLayer>
                    <KRect x={0} y={0} width={docSize.w} height={docSize.h} fill="#fff" opacity={0} listening={true} />
                  </KLayer>
                  {layers.map(l => l.visible && (
                    <KLayer key={l.id} opacity={l.opacity} name={l.id}>
                      {l.shapes.map((s, i) => {
                        if (s.kind === "rect") return <KRect key={i} x={s.x} y={s.y} width={s.w} height={s.h} fill={s.fill} opacity={s.opacity} cornerRadius={s.cornerRadius} />;
                        if (s.kind === "text") return <KText key={i} x={s.x} y={s.y} text={s.text} fontSize={s.fontSize} fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth} opacity={s.opacity} fontFamily="serif" />;
                        if (s.kind === "line") return <KLine key={i} points={s.points} stroke={s.stroke} strokeWidth={s.strokeWidth} opacity={s.opacity} tension={s.tension} lineCap="round" lineJoin="round" />;
                        if (s.kind === "image") return <ImageShape key={i} s={s} forceSize={l.id === "L1" ? docSize : undefined} />;
                        return null;
                      })}
                      {strokes[l.id] && <KLine points={strokes[l.id]} stroke={tool === "eraser" ? "rgba(0,0,0,0.7)" : brushColor} strokeWidth={brushSize} opacity={tool === "eraser" ? 0.7 : brushOpacity} tension={0.5} />}
                    </KLayer>
                  ))}
                  {/* 选区遮罩 + 套索预览（顶层，不导出） */}
                  <KLayer ref={overlayRef}>
                    {selCanvas && <KImage image={selCanvas} x={0} y={0} width={docSize.w} height={docSize.h} opacity={0.85} listening={false} />}
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
                    onKeyDown={(e) => { if (e.key === "Enter") commitText(); }}
                    placeholder="输入文字…"
                    className="mb-2 w-full rounded-md border border-border bg-background/60 px-2 py-1.5 text-sm text-foreground outline-none focus:border-foreground/40"
                  />
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1 text-[11px] text-foreground/60">
                      色
                      <input type="color" value={textColor} onChange={e => setTextColor(e.target.value)} className="h-5 w-6 cursor-pointer rounded border border-border bg-transparent" />
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
            <p className="mb-2 text-[10px] tracking-widest text-foreground/40">图层</p>
            <div className="space-y-1">
              {[...layers].reverse().map(l => (
                <div key={l.id} onClick={() => setActiveLayer(l.id)}
                  className={`group flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-2 transition ${activeLayer === l.id ? "border-foreground/30 bg-foreground/10" : "border-transparent hover:bg-foreground/5"}`}>
                  <button onClick={(e) => { e.stopPropagation(); toggleVis(l.id); }}
                    className="text-xs text-foreground/50 hover:text-foreground">{l.visible ? "◉" : "◎"}</button>
                  <span className="flex-1 truncate text-xs text-foreground/80">{l.name}</span>
                  <div className="hidden gap-0.5 group-hover:block">
                    <button title="上移一层" onClick={(e) => { e.stopPropagation(); moveLayer(l.id, 1); }} className="px-1 text-[10px] text-foreground/40 hover:text-foreground">↑</button>
                    <button title="下移一层" onClick={(e) => { e.stopPropagation(); moveLayer(l.id, -1); }} className="px-1 text-[10px] text-foreground/40 hover:text-foreground">↓</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="border-t border-border p-3">
            <p className="mb-2 text-[10px] tracking-widest text-foreground/40">智能体</p>
            <div className="rounded-lg border border-dashed border-border p-3 text-center text-[11px] text-foreground/40">
              AI 通道待接入（ComfyUI / RunningHub）
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
