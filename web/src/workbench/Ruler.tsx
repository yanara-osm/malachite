"use client";

import { useEffect, useRef } from "react";

const LADDER = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];

function pickStep(zoom: number) {
  const target = 64 / zoom;
  for (const s of LADDER) if (s >= target) return s;
  return 1000;
}

const INK = "oklch(0.55 0.01 260)";
const INK_DIM = "oklch(0.4 0.01 260)";
const BG = "oklch(0.17 0.005 260)";

export default function Ruler({ zoom, origin, length, dir }: { zoom: number; origin: number; length: number; dir: "h" | "v" }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const W = dir === "h" ? length : 20;
    const H = dir === "h" ? 20 : length;
    c.width = W * dpr; c.height = H * dpr;
    c.style.width = W + "px"; c.style.height = H + "px";
    const ctx = c.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = INK;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1;
    ctx.font = "9px ui-monospace, SFMono-Regular, monospace";

    const step = pickStep(zoom);
    const start = Math.floor(origin / step) * step;
    const end = origin + length;
    for (let v = start; v <= end; v += step) {
      const pos = (v - origin) * zoom;
      if (pos < 0 || pos > length) continue;
      const major = Math.abs(v % (step * 2)) < 0.001;
      if (dir === "h") {
        ctx.beginPath(); ctx.moveTo(pos + 0.5, 20); ctx.lineTo(pos + 0.5, 20 - (major ? 11 : 6)); ctx.stroke();
        if (major) { ctx.textBaseline = "top"; ctx.textAlign = "left"; ctx.fillText(String(v), pos + 3, 3); }
      } else {
        ctx.beginPath(); ctx.moveTo(20, pos + 0.5); ctx.lineTo(20 - (major ? 11 : 6), pos + 0.5); ctx.stroke();
        if (major) {
          ctx.save();
          ctx.translate(4, pos);
          ctx.rotate(-Math.PI / 2);
          ctx.textBaseline = "middle"; ctx.textAlign = "left";
          ctx.fillText(String(v), 0, 0);
          ctx.restore();
        }
      }
    }
    // 原点三角
    ctx.fillStyle = INK_DIM;
    if (dir === "h") { ctx.beginPath(); ctx.moveTo(0,20); ctx.lineTo(8,20); ctx.lineTo(0,12); ctx.fill(); }
    else { ctx.beginPath(); ctx.moveTo(20,0); ctx.lineTo(20,8); ctx.lineTo(12,0); ctx.fill(); }
  }, [zoom, origin, length, dir]);

  return <canvas ref={ref} className="block" />;
}
