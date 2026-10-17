"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fileToDataUrl, saveDragProject } from "@/lib/projects";

const SUGGESTIONS = [
  "把这张照片改成水墨风格，保留主体轮廓",
  "扩展画布到 16:9，补全两侧风景",
  "给角色换一套赛博朋克服装，保持姿态不变",
];

// PS 式新建画布预设尺寸
const CANVAS_PRESETS = [
  { label: "方形 1:1", w: 1024, h: 1024 },
  { label: "横屏 16:9", w: 1920, h: 1080 },
  { label: "竖屏 9:16", w: 1080, h: 1920 },
  { label: "横屏 4:3", w: 1600, h: 1200 },
  { label: "竖屏 3:4", w: 1200, h: 1600 },
  { label: "超宽 21:9", w: 2560, h: 1080 },
];

// 优雅粒子：logo 附近缓慢上升 + 正弦漂移 + 呼吸闪烁（青/金）
function FeatherParticles() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current!;
    const ctx = cv.getContext("2d")!;
    let w = 0, h = 0, raf = 0;
    const DPR = Math.min(2, window.devicePixelRatio || 1);
    const COLORS = [
      [150, 220, 235],  // 冷青
      [190, 230, 240],  // 亮青
      [230, 210, 150],  // 暖金
      [200, 190, 220],  // 淡紫
    ];
    type P = { x: number; y: number; r: number; vx: number; vy: number; c: number; ph: number; tw: number };
    let ps: P[] = [];
    const seed = () => {
      // 粒子集中在画布中部（logo 区域）：中心 x=50%，y=34%
      const cx = w / 2, cy = h * 0.34;
      const R = Math.min(w, h) * 0.28;
      ps = Array.from({ length: 46 }, () => {
        const a = Math.random() * Math.PI * 2;
        const d = Math.pow(Math.random(), 0.6) * R; // 偏中心
        return {
          x: cx + Math.cos(a) * d,
          y: cy + Math.sin(a) * d,
          r: 0.6 + Math.random() * 1.8,
          vx: (Math.random() - 0.5) * 0.06,
          vy: -(0.04 + Math.random() * 0.1),   // 缓慢上升
          c: (Math.random() * COLORS.length) | 0,
          ph: Math.random() * Math.PI * 2,
          tw: 0.5 + Math.random() * 1.2,
        };
      });
    };
    const resize = () => {
      w = cv.clientWidth; h = cv.clientHeight;
      cv.width = w * DPR; cv.height = h * DPR;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      seed();
    };
    let t = 0;
    const tick = () => {
      t += 0.016;
      ctx.clearRect(0, 0, w, h);
      for (const p of ps) {
        p.x += p.vx + Math.sin(t * 0.6 + p.ph) * 0.08;
        p.y += p.vy;
        // 出界回绕到下方中心区
        if (p.y < h * 0.05) { p.y = h * 0.62; p.x = w / 2 + (Math.random() - 0.5) * Math.min(w, h) * 0.5; }
        if (p.x < -10) p.x = w + 10;
        if (p.x > w + 10) p.x = -10;
        const alpha = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(t * p.tw + p.ph)); // 呼吸
        const [r, g, b] = COLORS[p.c];
        // 光晕
        const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4);
        grd.addColorStop(0, `rgba(${r},${g},${b},${alpha})`);
        grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 4, 0, Math.PI * 2);
        ctx.fill();
        // 芯
        ctx.fillStyle = `rgba(255,255,255,${alpha * 0.9})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 0.7, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    };
    resize();
    window.addEventListener("resize", resize);
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, []);
  return <canvas ref={ref} className="pointer-events-none absolute inset-0 z-[5]" style={{ width: "100%", height: "100%" }} />;
}

export default function Home() {
  const [text, setText] = useState("");
  const [img, setImg] = useState<{ url: string; name: string } | null>(null);
  const [drag, setDrag] = useState(false);
  const [logoDrag, setLogoDrag] = useState(false);
  const [creating, setCreating] = useState(false);
  const depth = useRef(0);
  const logoDepth = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  // PS 式新建画布对话框
  const [newCanvas, setNewCanvas] = useState(false);
  const [cw, setCw] = useState("1920");
  const [ch, setCh] = useState("1080");

  const accept = (files: FileList | null) => {
    const f = files?.[0];
    if (f && f.type.startsWith("image/")) {
      setImg({ url: URL.createObjectURL(f), name: f.name });
    }
  };

  // 拖图到 logo → 创建新项目 → 跳编辑页
  const onLogoDrop = async (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    logoDepth.current = 0; setLogoDrag(false);
    const f = Array.from(e.dataTransfer.files).find(f => f.type.startsWith("image/"));
    if (!f || creating) return;
    setCreating(true);
    try {
      const dataUrl = await fileToDataUrl(f, 1024);
      const id = "d" + Date.now() + Math.random().toString(36).slice(2, 6);
      saveDragProject({ id, title: f.name.replace(/\.\w+$/, ""), img: dataUrl, time: "刚刚", steps: 1 });
      router.push(`/project?id=${id}`);
    } finally {
      setCreating(false);
    }
  };

  // 新建空白画布（PS 式：预设 + 自定义宽高）
  const createCanvas = () => {
    const w = Math.max(16, Math.min(10000, parseInt(cw) || 1920));
    const h = Math.max(16, Math.min(10000, parseInt(ch) || 1080));
    const id = "d" + Date.now() + Math.random().toString(36).slice(2, 6);
    saveDragProject({ id, title: `画布 ${w}×${h}`, img: "", docSize: { w, h }, time: "刚刚", steps: 0 });
    setNewCanvas(false);
    router.push(`/project?id=${id}`);
  };

  return (
    <main className="relative flex flex-1 flex-col overflow-hidden">
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

      {/* 优雅粒子（logo 附近飘动）*/}
      <FeatherParticles />

      <div className="relative z-10 mx-auto flex w-full max-w-3xl flex-1 flex-col items-center px-6 pb-12 min-h-0">
        {/* 顶栏：新建画布 + 项目入口 */}
        <div className="fade-up absolute right-6 top-6 flex items-center gap-2" style={{ animationDelay: "0.1s" }}>
          <button
            onClick={() => setNewCanvas(true)}
            className="rounded-full border border-border bg-card/60 px-4 py-1.5 text-xs text-foreground/60 backdrop-blur transition hover:border-foreground/25 hover:text-foreground"
          >
            ＋ 新建画布
          </button>
          <Link
            href="/projects"
            className="rounded-full border border-border bg-card/60 px-4 py-1.5 text-xs text-foreground/60 backdrop-blur transition hover:border-foreground/25 hover:text-foreground"
          >
            项目 →
          </Link>
        </div>

        {/* 上半：logo + 标题，垂直居中占满 */}
        <div className="flex flex-1 flex-col items-center justify-center">
          {/* 孔雀翎 logo（拖图到此 → 新建项目）*/}
          <div
            className="fade-up relative mb-8"
            style={{ animationDelay: "0.05s" }}
            onDragEnter={(e) => { e.preventDefault(); logoDepth.current += 1; setLogoDrag(true); }}
            onDragOver={(e) => e.preventDefault()}
            onDragLeave={(e) => { e.preventDefault(); logoDepth.current = Math.max(0, logoDepth.current - 1); if (logoDepth.current === 0) setLogoDrag(false); }}
            onDrop={onLogoDrop}
          >
            <img src="/logo.png" alt="孔雀翎"
              className={`h-80 w-80 object-contain transition duration-300 ${logoDrag ? "scale-105" : ""}`}
              style={logoDrag ? { filter: "drop-shadow(0 0 24px oklch(0.82 0.16 180 / 0.6))" } : undefined} />
            {logoDrag && (
              <div className="absolute inset-0 flex items-center justify-center rounded-3xl border-2 border-dashed"
                style={{ borderColor: "oklch(0.82 0.16 180 / 0.7)", background: "oklch(0.82 0.16 180 / 0.07)" }}>
                <span className="text-sm font-medium" style={{ color: "var(--brand-cyan)" }}>
                  {creating ? "正在创建项目…" : "松开 · 新建项目并打开"}
                </span>
              </div>
            )}
          </div>

          <h1 className="fade-up mb-2 text-center text-2xl font-medium tracking-[0.18em] text-foreground/90"
            style={{ fontFamily: "var(--font-serif-sc)", animationDelay: "0.15s" }}>
            孔雀翎
            <span className="mt-1 block font-sans text-sm font-normal tracking-[0.35em] text-foreground/45">Malachite</span>
          </h1>
          <p className="fade-up text-center text-sm text-foreground/60" style={{ animationDelay: "0.25s" }}>
            智能体做你的美术，你负责修改与审查
          </p>
        </div>

        {/* Chat Composer（底部）*/}
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

      {/* PS 式新建画布对话框 */}
      {newCanvas && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setNewCanvas(false)}>
          <div className="w-[420px] rounded-2xl border border-border bg-card p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-4 text-sm font-medium text-foreground/80">新建画布</h2>
            {/* 预设 */}
            <div className="mb-4 grid grid-cols-3 gap-2">
              {CANVAS_PRESETS.map((p) => {
                const active = cw === String(p.w) && ch === String(p.h);
                return (
                  <button key={p.label}
                    onClick={() => { setCw(String(p.w)); setCh(String(p.h)); }}
                    className={`rounded-lg border px-2 py-2 text-xs transition ${active ? "text-foreground" : "border-border text-foreground/60 hover:border-foreground/25"}`}
                    style={active ? { borderColor: "var(--brand-cyan)" } : undefined}>
                    <span className="block">{p.label}</span>
                    <span className="mt-0.5 block text-[10px] text-foreground/40 tabular-nums">{p.w}×{p.h}</span>
                  </button>
                );
              })}
            </div>
            {/* 自定义宽高 */}
            <div className="mb-5 flex items-center gap-2">
              <label className="flex-1">
                <span className="mb-1 block text-[11px] text-foreground/45">宽（px）</span>
                <input value={cw} onChange={(e) => setCw(e.target.value.replace(/\D/g, ""))}
                  className="w-full rounded-lg border border-border bg-black/40 px-3 py-2 text-sm tabular-nums focus:border-foreground/30 focus:outline-none" />
              </label>
              <span className="mt-5 text-foreground/40">×</span>
              <label className="flex-1">
                <span className="mb-1 block text-[11px] text-foreground/45">高（px）</span>
                <input value={ch} onChange={(e) => setCh(e.target.value.replace(/\D/g, ""))}
                  className="w-full rounded-lg border border-border bg-black/40 px-3 py-2 text-sm tabular-nums focus:border-foreground/30 focus:outline-none" />
              </label>
            </div>
            {/* 操作 */}
            <div className="flex justify-end gap-2">
              <button onClick={() => setNewCanvas(false)}
                className="rounded-lg px-4 py-2 text-sm text-foreground/60 transition hover:bg-accent hover:text-foreground">取消</button>
              <button onClick={createCanvas}
                className="rounded-lg px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
                style={{ background: "oklch(0.94 0 0)" }}>创建</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
