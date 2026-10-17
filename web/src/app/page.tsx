"use client";

import { useRef, useState } from "react";
import Link from "next/link";

const SUGGESTIONS = [
  "把这张照片改成水墨风格，保留主体轮廓",
  "扩展画布到 16:9，补全两侧风景",
  "给角色换一套赛博朋克服装，保持姿态不变",
];

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
        {/* 顶栏：项目入口 */}
        <Link
          href="/projects"
          className="fade-up absolute right-6 top-6 rounded-full border border-border bg-card/60 px-4 py-1.5 text-xs text-foreground/60 backdrop-blur transition hover:border-foreground/25 hover:text-foreground"
          style={{ animationDelay: "0.1s" }}
        >
          项目 →
        </Link>

        {/* 孔雀翎 logo */}
        <div className="fade-up mb-5" style={{ animationDelay: "0.05s" }}>
          <img src="/logo.png" alt="孔雀翎" className="h-40 w-40 object-contain" />
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

      </div>
    </main>
  );
}
