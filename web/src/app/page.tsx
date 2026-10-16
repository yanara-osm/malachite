"use client";

import { useRef, useState } from "react";
import Image from "next/image";

const PRESETS = [
  { title: "水墨山水", sub: "主峰·皴法·留白", img: "/presets/ink.png" },
  { title: "赛博霓虹", sub: "城市·雨夜·光轨", img: "/presets/cyber.png" },
  { title: "鎏金浮雕", sub: "质感·金属·暗调", img: "/presets/gold.png" },
  { title: "极光之夜", sub: "星尘·流动·冷色", img: "/presets/aurora.png" },
  { title: "熔岩大地", sub: "炽热·肌理·暖调", img: "/presets/lava.png" },
  { title: "深海秘境", sub: "幽光·悬浮·纵深", img: "/presets/ocean.png" },
];

const SUGGESTIONS = [
  "把这张照片改成水墨风格，保留主体轮廓",
  "扩展画布到 16:9，补全两侧风景",
  "给角色换一套赛博朋克服装，保持姿态不变",
];

function Feather() {
  return (
    <svg viewBox="0 0 240 240" className="h-40 w-40 feather-breathe" fill="none" aria-hidden>
      <defs>
        <linearGradient id="fbarb" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="oklch(0.82 0.16 180)" />
          <stop offset="55%" stopColor="oklch(0.68 0.22 290)" />
          <stop offset="100%" stopColor="oklch(0.85 0.16 85)" />
        </linearGradient>
        <radialGradient id="feye" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="oklch(0.85 0.16 85)" />
          <stop offset="45%" stopColor="oklch(0.68 0.22 290)" />
          <stop offset="78%" stopColor="oklch(0.45 0.18 240)" />
          <stop offset="100%" stopColor="oklch(0.82 0.16 180)" />
        </radialGradient>
      </defs>
      {/* 羽轴（翎眼处截止，不拖尾）*/}
      <path d="M120 20 C118 80 116 130 119 152" stroke="url(#fbarb)" strokeWidth="3" strokeLinecap="round" opacity="0.9" />
      {/* 羽枝 */}
      {Array.from({ length: 15 }).map((_, i) => {
        const y = 40 + i * 11;
        const len = 60 - i * 3.0;
        return (
          <g key={i} stroke="url(#fbarb)" strokeWidth="1.6" strokeLinecap="round" opacity={0.78 - i * 0.022}>
            <path d={`M119 ${y} Q ${119 - len * 0.55} ${y - 6}, ${119 - len} ${y - 13}`} />
            <path d={`M121 ${y} Q ${121 + len * 0.55} ${y - 6}, ${121 + len} ${y - 13}`} />
          </g>
        );
      })}
      {/* 孔雀眼斑 */}
      <g>
        <circle cx="120" cy="150" r="32" fill="none" stroke="oklch(0.82 0.16 180 / 0.45)" strokeWidth="1.5" />
        <circle cx="120" cy="150" r="25" fill="url(#feye)" opacity="0.92" />
        <circle cx="120" cy="150" r="14" fill="oklch(0.18 0.08 260)" />
        <circle cx="120" cy="150" r="6.5" fill="oklch(0.88 0.15 85)" />
      </g>
    </svg>
  );
}

export default function Home() {
  const [text, setText] = useState("");
  const [img, setImg] = useState<{ url: string; name: string } | null>(null);
  const [drag, setDrag] = useState(false);
  const depth = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const accept = (files: FileList | null) => {
    const f = files?.[0];
    if (f && f.type.startsWith("image/")) {
      setImg({ url: URL.createObjectURL(f), name: f.name });
    }
  };

  return (
    <main className="relative flex-1 overflow-hidden">
      {/* 背景层（净化：单团冷青光，去脏紫光边）*/}
      <div className="pointer-events-none absolute inset-0">
        <div className="aurora-1 absolute -top-1/3 left-1/2 h-[60vh] w-[64vw] -translate-x-1/2 rounded-full opacity-30 blur-3xl"
          style={{ background: "radial-gradient(closest-side, oklch(0.6 0.16 210 / 0.5), transparent 72%)" }} />
        <div className="aurora-2 absolute bottom-[-25%] right-[-12%] h-[48vh] w-[46vw] rounded-full opacity-20 blur-3xl"
          style={{ background: "radial-gradient(closest-side, oklch(0.5 0.16 275 / 0.45), transparent 74%)" }} />
        <div className="absolute inset-0" style={{
          background: "radial-gradient(120% 85% at 50% -10%, transparent 42%, oklch(0.13 0.005 260) 100%)",
        }} />
      </div>

      {/* 拖拽提示 */}
      {drag && (
        <div className="absolute inset-4 z-30 flex items-center justify-center rounded-3xl border-2 border-dashed"
          style={{ borderColor: "oklch(0.82 0.16 180 / 0.7)", background: "oklch(0.82 0.16 180 / 0.06)" }}>
          <p className="text-lg font-medium" style={{ color: "var(--brand-cyan)" }}>松开 · 图片进入对话区</p>
        </div>
      )}

      <div className="relative z-10 mx-auto flex h-full max-w-3xl flex-col items-center justify-center px-6">
        {/* 若隐若现孔雀翎 */}
        <div className="fade-up mb-5" style={{ animationDelay: "0.05s" }}>
          <Feather />
        </div>

        <h1 className="fade-up mb-2 text-center text-lg font-medium tracking-wide text-foreground/85" style={{ animationDelay: "0.15s" }}>
          孔雀翎 <span className="text-foreground/50">Malachite</span>
        </h1>
        <p className="fade-up mb-8 text-center text-sm text-foreground/60" style={{ animationDelay: "0.25s" }}>
          智能体做你的美术，你负责修改与审查
        </p>

        {/* Chat Composer */}
        <div className={`ring-gradient fade-up w-full rounded-2xl p-2 ${img ? "" : "bg-card/80"} backdrop-blur-xl`}
          style={{ animationDelay: "0.35s" }}
          onDragEnter={(e) => { e.preventDefault(); depth.current += 1; setDrag(true); }}
          onDragLeave={(e) => { e.preventDefault(); depth.current = Math.max(0, depth.current - 1); if (depth.current === 0) setDrag(false); }}
          onDrop={(e) => { e.preventDefault(); depth.current = 0; setDrag(false); accept(e.dataTransfer.files); }}
        >
          {img && (
            <div className="relative mx-1 mb-2 overflow-hidden rounded-xl">
              <img src={img.url} alt={img.name} className="max-h-72 w-full object-contain" />
              <div className="absolute left-2 top-2 rounded-md bg-black/60 px-2 py-1 text-xs text-white/80 backdrop-blur">
                {img.name}
              </div>
              <button onClick={() => setImg(null)}
                className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-md bg-black/60 text-white/70 backdrop-blur transition hover:bg-black/80 hover:text-white">
                ✕
              </button>
            </div>
          )}
          <div className="flex items-end gap-2 px-1 pb-1">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={img ? 1 : 2}
              placeholder="描述你想要的图像，或拖一张图进来…"
              className="max-h-40 flex-1 resize-none bg-transparent px-2 py-2 text-[15px] text-foreground placeholder:text-foreground/30 focus:outline-none"
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); /* TODO: 发送 */ } }}
            />
            <button
              className="mb-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-primary-foreground transition hover:scale-105 active:scale-95"
              style={{ background: "oklch(0.94 0 0)", boxShadow: "0 4px 20px -6px oklch(0.78 0.14 190 / 0.5)" }}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          </div>
          <div className="flex items-center gap-1 px-1 pt-1">
            <button onClick={() => fileRef.current?.click()}
              className="rounded-lg px-2.5 py-1.5 text-xs text-foreground/50 transition hover:bg-accent hover:text-foreground">
              ⊕ 图片
            </button>
            <button className="rounded-lg px-2.5 py-1.5 text-xs text-foreground/50 transition hover:bg-accent hover:text-foreground">
              @ 引用
            </button>
            <button className="rounded-lg px-2.5 py-1.5 text-xs text-foreground/50 transition hover:bg-accent hover:text-foreground">
              / 工作流
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => accept(e.target.files)} />
          </div>
        </div>

        {/* 提示词 */}
        <div className="fade-up mt-5 flex flex-wrap items-center justify-center gap-2" style={{ animationDelay: "0.45s" }}>
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => setText(s)}
              className="rounded-full border border-border bg-card/60 px-3.5 py-1.5 text-xs text-foreground/70 backdrop-blur transition hover:border-foreground/25 hover:text-foreground">
              {s}
            </button>
          ))}
        </div>

        {/* Presets：炫彩集中地 */}
        <div className="fade-up mt-9 w-full" style={{ animationDelay: "0.55s" }}>
          <p className="mb-3 text-xs font-medium tracking-widest text-foreground/55">PRESETS · 示例</p>
          <div className="grid grid-cols-3 gap-3">
            {PRESETS.map((p) => (
              <button key={p.title} onClick={() => setText(p.title)}
                className="group relative aspect-[4/3] overflow-hidden rounded-xl border border-border">
                <Image src={p.img} alt={p.title} fill sizes="(max-width:768px) 100vw, 33vw"
                  className="object-cover transition duration-500 ease-out group-hover:scale-105" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/25 to-black/5" />
                <div className="absolute inset-x-0 bottom-0 p-3 text-left">
                  <p className="text-sm font-medium text-white/95">{p.title}</p>
                  <p className="text-[11px] text-white/70">{p.sub}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
