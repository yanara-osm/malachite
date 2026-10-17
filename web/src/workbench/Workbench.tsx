"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Stage, Layer as KLayer, Rect as KRect, Line as KLine, Image as KImage, Text as KText, Circle as KCircle } from "react-konva";
import Konva from "konva";
import dynamic from "next/dynamic";
import Link from "next/link";
import Ruler from "./Ruler";
import { DOC_W, DOC_H } from "./types";
import type { Layer, Tool, StepEntry } from "./types";
import { magicWand, lasso, fillSelection, selectionToCanvas } from "./selection";
import type { Selection } from "./selection";

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

function ImageShape({ s }: { s: any }) {
  const img = UseImage(s.src);
  if (!img) return null;
  return <KImage image={img} x={s.x} y={s.y} width={s.w} height={s.h} opacity={s.opacity} />;
}

const TOOLS: { id: Tool; label: string; icon: string }[] = [
  { id: "move", label: "移动", icon: "✥" },
  { id: "brush", label: "画笔", icon: "✎" },
  { id: "eraser", label: "橡皮", icon: "◱" },
  { id: "fill", label: "填充", icon: "▣" },
  { id: "text", label: "文字", icon: "T" },
  { id: "wand", label: "魔棒（按颜色选区）", icon: "⚡" },
  { id: "lasso", label: "套索（手绘选区）", icon: "◌" },
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
  const [layers, setLayers] = useState<Layer[]>(() => [
    { id: "L1", name: "水墨底图", visible: true, opacity: 1, shapes: [{ kind: "image", x: 0, y: 0, w: DOC_W, h: DOC_H, src: cover, opacity: 1 }] },
    { id: "L2", name: "雾气 · 重绘", visible: true, opacity: 0.4, shapes: [{ kind: "rect", x: 200, y: 560, w: 1000, h: 300, fill: "rgba(245,243,238,0.55)", opacity: 1, cornerRadius: 140 }] },
    { id: "L3", name: "主峰标注", visible: true, opacity: 1, shapes: [{ kind: "text", x: 640, y: 300, text: "主峰", fontSize: 48, fill: "#1c1a17", stroke: "rgba(255,255,255,0.7)", strokeWidth: 1.5, opacity: 1 }] },
  ]);
  const [activeLayer, setActiveLayer] = useState("L3");
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
  const [selection, setSelection] = useState<Selection | null>(null);
  const [selCanvas, setSelCanvas] = useState<HTMLCanvasElement | null>(null);
  const [fillColor, setFillColor] = useState("#3c9be8");
  const [brushColor, setBrushColor] = useState("#1c1a17");
  const [brushSize, setBrushSize] = useState(8);
  const [brushOpacity, setBrushOpacity] = useState(1);
  const [aiBusy, setAiBusy] = useState(false);
  const [wandTol, setWandTol] = useState(32);
  const [wandClicks, setWandClicks] = useState(0);
  const [lassoLive, setLassoLive] = useState<{ x: number; y: number }[]>([]);
  const lassoPts = useRef<{ x: number; y: number }[]>([]);
  const undoStack = useRef<Layer[][]>([]);
  const [undoCount, setUndoCount] = useState(0);

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
      e.preventDefault();
      const k = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      setZoom(z => Math.min(8, Math.max(0.05, z * k)));
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { clearSel(); lassoPts.current = []; setLassoLive([]); }
      if ((e.ctrlKey || e.metaKey) && e.key === "z") { e.preventDefault(); undo(); }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey);
    return () => { el.removeEventListener("wheel", onWheel); window.removeEventListener("keydown", onKey); };
  }, []);

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

  // 智能抠像：当前画面 → 白底合成 → rembg isnet → 透明背景 PNG 作为新图层
  const doMatting = async () => {
    const st = stageRef.current;
    if (!st || aiBusy) return;
    setAiBusy(true);
    try {
      // 1. 渲染到白底 canvas（避免透明棋盘格干扰模型）
      const c = document.createElement("canvas");
      c.width = docSize.w; c.height = docSize.h;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, c.width, c.height);
      // 逐图层绘制（尊重显隐）
      for (const layer of layers) {
        if (!layer.visible) continue;
        for (const shape of layer.shapes) {
          if (shape.kind === "image" && shape.src) {
            const img = new Image();
            await new Promise(r => { img.onload = r; img.src = shape.src; });
            ctx.globalAlpha = shape.opacity * layer.opacity;
            ctx.drawImage(img, shape.x, shape.y, shape.w, shape.h);
          }
        }
      }
      ctx.globalAlpha = 1;
      const whiteBgUrl = c.toDataURL("image/png");
      // 2. 提交抠像
      const res = await fetch("/api/matting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl: whiteBgUrl }),
      });
      if (!res.ok) { const e = await res.json(); alert("抠像失败: " + e.error); return; }
      const { dataUrl: cutout } = await res.json();
      // 3. 作为新图层
      pushUndo();
      const lid = "L" + Date.now();
      setLayers(ls => [
        ...ls,
        { id: lid, name: "智能抠像", visible: true, opacity: 1, shapes: [{ kind: "image", x: 0, y: 0, w: docSize.w, h: docSize.h, src: cutout, opacity: 1 }] },
      ]);
      setActiveLayer(lid);
    } catch (e: any) {
      alert("抠像失败: " + e.message);
    } finally {
      setAiBusy(false);
    }
  };

  // 智能填充（纯前端）：选区边缘取色 → 多轮向内扩散 → 填充
  const doSmartFill = async () => {
    if (!selection || aiBusy) return;
    setAiBusy(true);
    try {
      const idata = await stageToImageData();
      if (!idata) return;
      const { width: w, height: h, data } = idata;
      const mask = selection.data;
      const out = new Uint8ClampedArray(data);

      // 1. 标记选区内部像素，记录边界像素（选区内且相邻有选区外像素）
      const isBorder = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          if (!mask[i]) continue;
          // 检查四邻域是否有非选区像素
          const hasOutside =
            (x > 0 && !mask[i - 1]) || (x < w - 1 && !mask[i + 1]) ||
            (y > 0 && !mask[i - w]) || (y < h - 1 && !mask[i + w]);
          if (hasOutside) isBorder[i] = 1;
        }
      }

      // 2. 多轮扩散：每轮把边界像素颜色向内部传播（取4邻域均值）
      const ITER = 40; // 扩散轮数（控制填充深度）
      for (let iter = 0; iter < ITER; iter++) {
        const next = new Uint8ClampedArray(out);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const i = y * w + x;
            if (!mask[i] || isBorder[i]) continue; // 边界和外部不动
            // 收集选区内已扩散的邻域
            let r = 0, g = 0, b = 0, a = 0, n = 0;
            if (x > 0 && mask[i - 1]) { const d = (i-1)*4; r+=out[d];g+=out[d+1];b+=out[d+2];a+=out[d+3];n++; }
            if (x < w-1 && mask[i+1]) { const d = (i+1)*4; r+=out[d];g+=out[d+1];b+=out[d+2];a+=out[d+3];n++; }
            if (y > 0 && mask[i-w]) { const d = (i-w)*4; r+=out[d];g+=out[d+1];b+=out[d+2];a+=out[d+3];n++; }
            if (y < h-1 && mask[i+w]) { const d = (i+w)*4; r+=out[d];g+=out[d+1];b+=out[d+2];a+=out[d+3];n++; }
            if (n > 0) {
              const d = i * 4;
              next[d] = r / n; next[d+1] = g / n; next[d+2] = b / n; next[d+3] = a / n;
            }
          }
        }
        out.set(next);
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
        { id: lid, name: "智能填充", visible: true, opacity: 1, shapes: [{ kind: "image", x: 0, y: 0, w: docSize.w, h: docSize.h, src: dataUrl, opacity: 1 }] },
      ]);
      setActiveLayer(lid);
      clearSel();
    } catch (e: any) {
      alert("智能填充失败: " + e.message);
    } finally {
      setAiBusy(false);
    }
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
    if (tool === "move") return;
    const p = toStage(e);
    if (tool === "wand") { onWand(p.x, p.y); return; }
    if (tool === "lasso") { lassoPts.current = [{ x: p.x, y: p.y }]; drawing.current = true; return; }
    drawing.current = true;
    if (tool === "brush" || tool === "eraser") {
      pointRef.current = [p.x, p.y, p.x, p.y];
    } else if (tool === "fill") {
      // 有选区→对选区填当前色；无选区→铺满活动层
      if (selection) { applySelection(fillColor); }
      else setLayers(ls => ls.map(l => l.id === activeLayer ? { ...l, shapes: [{ kind: "rect", x: 0, y: 0, w: docSize.w, h: docSize.h, fill: fillColor, opacity: 0.35, cornerRadius: 0 }, ...l.shapes] } : l));
    } else if (tool === "text") {
      setLayers(ls => ls.map(l => l.id === activeLayer ? { ...l, shapes: [{ kind: "text", x: p.x, y: p.y, text: "文字", fontSize: 36, fill: "#ffffff", opacity: 1 }, ...l.shapes] } : l));
    }
  };

  const onStageMouseMove = (e: any) => {
    const p = toStage(e);
    setCursor({ x: p.x, y: p.y });
    if (!drawing.current) return;
    if (tool === "lasso") { lassoPts.current.push({ x: p.x, y: p.y }); setLassoLive([...lassoPts.current]); return; }
    if (tool === "brush" || tool === "eraser") {
      pointRef.current = [...pointRef.current, p.x, p.y];
      setStrokes(s => ({ ...s, [activeLayer]: pointRef.current }));
    }
  };

  const endStroke = () => {
    if (!drawing.current) return;
    drawing.current = false;
    if (tool === "lasso") {
      if (lassoPts.current.length >= 3) commitSelection(lasso(lassoPts.current, docSize.w, docSize.h));
      lassoPts.current = []; setLassoLive([]);
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

  const exportPSD = async () => {
    try {
      const { writePsd } = await import("ag-psd");
      const st = stageRef.current;
      if (!st) return;
      const ov = overlayRef.current;
      if (ov) { ov.visible(false); ov.batchDraw(); }
      // Konva Stage 导出 base64 PNG → 画到 canvas → 写 PSD
      const dataUrl = st.toDataURL({ pixelRatio: 1, mimeType: "image/png" });
      if (ov) { ov.visible(true); ov.batchDraw(); }
      const full = document.createElement("canvas");
      full.width = docSize.w; full.height = docSize.h;
      await new Promise<void>((res, rej) => {
        const img = new Image();
        img.onload = () => { full.getContext("2d")!.drawImage(img, 0, 0); res(); };
        img.onerror = rej;
        img.src = dataUrl;
      });
      const psd = writePsd({
        width: docSize.w,
        height: docSize.h,
        children: [{ canvas: full, name: "合成", left: 0, top: 0 }],
      });
      const blob = new Blob([psd as unknown as BlobPart], { type: "image/vnd.adobe.photoshop" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${id}.psd`; a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("PSD export failed", err);
      alert("导出 PSD 失败");
    }
  };

  const importPSD = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const { readPsd } = await import("ag-psd");
      const buf = await file.arrayBuffer();
      const doc = readPsd(buf, { skipLayerImageData: false });
      setDocSize({ w: doc.width, h: doc.height });
      const newLayers: Layer[] = [];
      const kids = doc.children ?? [];
      // ag-psd children 自上而下（与画布渲染顺序一致）
      for (let i = 0; i < kids.length; i++) {
        const k = kids[i];
        const cv: HTMLCanvasElement | undefined = (k as any).canvas;
        if (!cv) continue;
        const dataUrl = cv.toDataURL("image/png");
        newLayers.push({
          id: `psd_${i}`,
          name: k.name || `图层 ${i + 1}`,
          visible: true,
          opacity: (k.opacity ?? 255) / 255,
          shapes: [{ kind: "image", x: k.left ?? 0, y: k.top ?? 0, w: cv.width, h: cv.height, src: dataUrl, opacity: 1 }],
        });
      }
      if (newLayers.length) {
        setLayers(newLayers);
        setActiveLayer(newLayers[0].id);
        fitView();
      } else {
        alert("该 PSD 没有可解析的图层");
      }
    } catch (err) {
      console.error("PSD parse failed", err);
      alert("PSD 解析失败，请检查文件");
    }
  };

  const activeShapes = useMemo(() => layers.find(l => l.id === activeLayer)?.shapes ?? [], [layers, activeLayer]);

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      {/* 顶栏 */}
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border px-3">
        <Link href="/projects" className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-xs text-foreground/60 transition hover:border-foreground/30 hover:text-foreground">←</Link>
        <span className="text-sm font-medium text-foreground/90">{title}</span>
        <span className="rounded-md border border-border px-2 py-0.5 text-[11px] tabular-nums text-foreground/45">{docSize.w} × {docSize.h} px</span>
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
            导入 PSD
            <input type="file" accept=".psd,.psb" onChange={importPSD} className="hidden" />
          </label>
          <button onClick={exportPSD} className="h-7 rounded-md border border-foreground/30 bg-card px-3 text-[11px] text-foreground/80 transition hover:border-foreground/50">导出 PSD</button>
        </div>
      </header>

      {/* 选区操作条（有选区时出现） */}
      {selection && (
        <div className="flex h-9 items-center gap-2 border-b border-border bg-background/60 px-3 text-[12px]">
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
            <span>填充色</span>
            <input type="color" value={fillColor} onChange={e => setFillColor(e.target.value)} className="h-5 w-6 cursor-pointer rounded border border-border bg-transparent" />
          </label>
          <button onClick={() => applySelection(fillColor)} className="h-6 rounded-md border border-border px-2 text-foreground/70 transition hover:bg-secondary hover:text-foreground">填充</button>
          <button onClick={() => applySelection(null)} className="h-6 rounded-md border border-border px-2 text-foreground/70 transition hover:bg-secondary hover:text-foreground">清除选区</button>
          <button onClick={clearSel} className="h-6 rounded-md border border-border px-2 text-foreground/50 transition hover:text-foreground">取消选区 (Esc)</button>
        </div>
      )}

      {/* 画笔/橡皮 属性条 */}
      {(tool === "brush" || tool === "eraser") && (
        <div className="flex h-9 items-center gap-2 border-b border-border bg-background/60 px-3 text-[12px]">
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
        </div>
      )}

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
            <button title="智能抠像（rembg 主体提取）" onClick={doMatting} disabled={aiBusy}
              className={`flex h-9 w-9 items-center justify-center rounded-lg text-sm transition ${aiBusy ? "animate-pulse text-foreground/40" : "text-foreground/60 hover:bg-foreground/10 hover:text-foreground"}`}>
              ✂
            </button>
            <button title="智能填充（选区边缘扩散）" onClick={doSmartFill} disabled={aiBusy || !selection}
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
              style={{ background: "oklch(0.14 0.005 260)", cursor: tool === "wand" || tool === "lasso" ? "crosshair" : tool === "brush" || tool === "eraser" ? "cell" : "default" }}>
              <div className="absolute" style={{ left: viewW / 2 - scroll.x * zoom, top: viewH / 2 - scroll.y * zoom, width: docSize.w * zoom, height: docSize.h * zoom, background: CHECKER, boxShadow: "0 0 0 1px oklch(0.3 0.01 260), 0 12px 40px -12px black" }}>
                <KonvaStage
                  ref={stageRef}
                  width={docSize.w} height={docSize.h}
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
                        if (s.kind === "image") return <ImageShape key={i} s={s} />;
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
            </div>
          </div>

          {/* 底部 step timeline */}
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
        </section>

        {/* 右：图层 + 智能体 */}
        <aside className="flex w-60 shrink-0 flex-col border-l border-border">
          <div className="flex-1 overflow-y-auto p-3">
            <p className="mb-2 text-[10px] tracking-widest text-foreground/40">图层</p>
            <div className="space-y-1">
              {layers.map(l => (
                <div key={l.id} onClick={() => setActiveLayer(l.id)}
                  className={`group flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-2 transition ${activeLayer === l.id ? "border-foreground/30 bg-foreground/10" : "border-transparent hover:bg-foreground/5"}`}>
                  <button onClick={(e) => { e.stopPropagation(); toggleVis(l.id); }}
                    className="text-xs text-foreground/50 hover:text-foreground">{l.visible ? "◉" : "◎"}</button>
                  <span className="flex-1 truncate text-xs text-foreground/80">{l.name}</span>
                  <div className="hidden gap-0.5 group-hover:block">
                    <button onClick={(e) => { e.stopPropagation(); moveLayer(l.id, -1); }} className="px-1 text-[10px] text-foreground/40 hover:text-foreground">↑</button>
                    <button onClick={(e) => { e.stopPropagation(); moveLayer(l.id, 1); }} className="px-1 text-[10px] text-foreground/40 hover:text-foreground">↓</button>
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
