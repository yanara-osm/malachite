"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Stage, Layer as KLayer, Rect as KRect, Line as KLine, Image as KImage, Text as KText } from "react-konva";
import dynamic from "next/dynamic";
import Link from "next/link";
import Ruler from "./Ruler";
import { DOC_W, DOC_H } from "./types";
import type { Layer, Tool, StepEntry } from "./types";

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
  const drawing = useRef(false);
  const pointRef = useRef<number[]>([]);
  const vpRef = useRef<HTMLDivElement>(null);
  const [viewSize, setViewSize] = useState({ w: 900, h: 560 });
  const [docSize, setDocSize] = useState({ w: DOC_W, h: DOC_H });

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

  // 滚轮缩放
  useEffect(() => {
    const el = vpRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const k = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      setZoom(z => Math.min(8, Math.max(0.05, z * k)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const toStage = (e: any) => {
    const st = stageRef.current;
    if (!st) return { x: 0, y: 0 };
    return st.getPointerPosition() ?? { x: 0, y: 0 };
  };

  const onStageMouseDown = (e: any) => {
    if (tool === "move") return;
    drawing.current = true;
    const p = toStage(e);
    if (tool === "brush" || tool === "eraser") {
      pointRef.current = [p.x, p.y, p.x, p.y];
    } else if (tool === "fill") {
      setLayers(ls => ls.map(l => l.id === activeLayer ? { ...l, shapes: [{ kind: "rect", x: 0, y: 0, w: DOC_W, h: DOC_H, fill: "rgba(120,220,210,0.35)", opacity: 1, cornerRadius: 0 }, ...l.shapes] } : l));
    } else if (tool === "text") {
      setLayers(ls => ls.map(l => l.id === activeLayer ? { ...l, shapes: [{ kind: "text", x: p.x, y: p.y, text: "文字", fontSize: 36, fill: "#ffffff", opacity: 1 }, ...l.shapes] } : l));
    }
  };

  const onStageMouseMove = (e: any) => {
    const p = toStage(e);
    setCursor({ x: p.x, y: p.y });
    if (!drawing.current) return;
    if (tool === "brush" || tool === "eraser") {
      pointRef.current = [...pointRef.current, p.x, p.y];
      setStrokes(s => ({ ...s, [activeLayer]: pointRef.current }));
    }
  };

  const endStroke = () => {
    if (!drawing.current) return;
    drawing.current = false;
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
      const { writePsd, canvasToPsdImage } = await import("ag-psd");
      const st = stageRef.current;
      if (!st) return;
      // Konva Stage 导出 base64 PNG → 画到 canvas → 写 PSD
      const dataUrl = st.toDataURL({ pixelRatio: 1, mimeType: "image/png" });
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
        children: [canvasToPsdImage(full)],
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
          <label className="flex h-7 cursor-pointer items-center rounded-md border border-border px-3 text-[11px] text-foreground/60 transition hover:text-foreground">
            导入 PSD
            <input type="file" accept=".psd,.psb" onChange={importPSD} className="hidden" />
          </label>
          <button onClick={exportPSD} className="h-7 rounded-md border border-foreground/30 bg-card px-3 text-[11px] text-foreground/80 transition hover:border-foreground/50">导出 PSD</button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 左：工具栏 */}
        <aside className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border py-2">
          {TOOLS.map(t => (
            <button key={t.id} title={t.label} onClick={() => setTool(t.id)}
              className={`flex h-9 w-9 items-center justify-center rounded-lg text-sm transition ${tool === t.id ? "bg-foreground/15 text-foreground" : "text-foreground/50 hover:bg-foreground/5 hover:text-foreground/80"}`}>
              {t.icon}
            </button>
          ))}
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
            <div ref={vpRef} className="relative min-w-0 flex-1 overflow-hidden" style={{ background: "oklch(0.14 0.005 260)" }}>
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
                  {layers.map(l => l.visible && (
                    <KLayer key={l.id} opacity={l.opacity} name={l.id}>
                      {l.shapes.map((s, i) => {
                        if (s.kind === "rect") return <KRect key={i} x={s.x} y={s.y} width={s.w} height={s.h} fill={s.fill} opacity={s.opacity} cornerRadius={s.cornerRadius} />;
                        if (s.kind === "text") return <KText key={i} x={s.x} y={s.y} text={s.text} fontSize={s.fontSize} fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth} opacity={s.opacity} fontFamily="serif" />;
                        if (s.kind === "line") return <KLine key={i} points={s.points} stroke={s.stroke} strokeWidth={s.strokeWidth} opacity={s.opacity} tension={s.tension} lineCap="round" lineJoin="round" />;
                        if (s.kind === "image") return <ImageShape key={i} s={s} />;
                        return null;
                      })}
                      {strokes[l.id] && <KLine points={strokes[l.id]} stroke={tool === "eraser" ? "rgba(0,0,0,0.7)" : "oklch(0.85 0.12 190)"} strokeWidth={tool === "eraser" ? 28 : 8} opacity={0.6} tension={0.5} />}
                    </KLayer>
                  ))}
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
