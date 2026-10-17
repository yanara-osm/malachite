"use client";

import { useEffect, useRef, useState } from "react";

// ---- HSV ↔ hex 转换 ----
export function hsvToHex(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    const c = v - v * s * Math.max(0, Math.min(Math.min(k, 4 - k), 1));
    return Math.round(c * 255);
  };
  const r = f(5), g = f(3), b = f(1);
  return "#" + [r, g, b].map(x => x.toString(16).padStart(2, "0")).join("");
}

export function hexToHsv(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  let r = 0, g = 0, b = 0;
  if (m) {
    const n = parseInt(m[1], 16);
    r = (n >> 16) & 255; g = (n >> 8) & 255; b = n & 255;
  }
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const d = mx - mn;
  let h = 0, s = 0;
  const v = mx;
  if (d > 0) {
    s = d / mx;
    if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (mx === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [h * 360, s, v];
}

const SIZE = 168;         // 色轮直径
const WHEEL_THICK = 26;   // 色相环厚度
const SV_R = SIZE / 2 - WHEEL_THICK - 4; // 中心 SV 方块半径

// 色相环背景（conic-gradient，一圈完整色相）
const WHEEL_BG = "conic-gradient(#f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)";

export default function ColorWheelPicker({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const [open, setOpen] = useState(false);
  const [hsv, setHsv] = useState<[number, number, number]>(() => hexToHsv(value));
  const [draft, setDraft] = useState(value);
  const rootRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<"wheel" | "sv" | null>(null);

  // 外部 value 变化时同步
  useEffect(() => {
    setHsv(hexToHsv(value));
    setDraft(value);
  }, [value]);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const center = { x: SIZE / 2, y: SIZE / 2 };

  const pickWheel = (clientX: number, clientY: number) => {
    const rect = rootRef.current!.querySelector("[data-wheel]")!.getBoundingClientRect();
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    const ang = (Math.atan2(clientY - cy, clientX - cx) * 180) / Math.PI;
    const hue = (ang + 90 + 360) % 360; // conic-gradient 0° 在顶部
    const [, s, v] = hsv;
    setHsv([hue, s, v]);
  };

  const pickSv = (clientX: number, clientY: number) => {
    const rect = rootRef.current!.querySelector("[data-sv]")!.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    const [h] = hsv;
    setHsv([h, x, 1 - y]); // 顶部 v=1，底部 v=0
  };

  const onMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    if (dragging.current === "wheel") pickWheel(e.clientX, e.clientY);
    else pickSv(e.clientX, e.clientY);
  };

  // hsv 变化 → 同步 hex 到外部
  const commit = (h: number, s: number, v: number) => {
    const hex = hsvToHex(h, s, v);
    setDraft(hex);
    onChange(hex);
  };

  const setHsvAndCommit = (h: number, s: number, v: number) => {
    setHsv([h, s, v]);
    commit(h, s, v);
  };

  const [h, s, v] = hsv;
  const svBg = {
    background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${h}, 100%, 50%))`,
  };
  // 色相指示点角度（conic 0° 顶部，顺时针）
  const wheelAngle = h - 90;
  const wheelRad = SIZE / 2 - WHEEL_THICK / 2;
  const wheelDot = {
    left: center.x + wheelRad * Math.cos((wheelAngle * Math.PI) / 180) - 5,
    top: center.y + wheelRad * Math.sin((wheelAngle * Math.PI) / 180) - 5,
  };
  const svDot = {
    left: (SIZE / 2 - SV_R) + s * (SV_R * 2) - 5,
    top: (SIZE / 2 - SV_R) + (1 - v) * (SV_R * 2) - 5,
  };

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        onClick={() => setOpen(o => !o)}
        className="h-5 w-6 cursor-pointer rounded border border-border"
        style={{ background: value }}
        title="打开色轮拾色器"
      />
      {open && (
        <div className="absolute left-0 top-7 z-50 rounded-xl border border-border bg-card p-3 shadow-xl">
          <div
            data-wheel
            className="relative cursor-pointer"
            style={{ width: SIZE, height: SIZE, borderRadius: "50%", background: WHEEL_BG }}
            onPointerDown={(e) => { dragging.current = "wheel"; pickWheel(e.clientX, e.clientY); }}
            onPointerMove={onMove}
            onPointerUp={() => { dragging.current = null; }}
          >
            {/* 内圆挖空 = SV 方块 */}
            <div
              data-sv
              className="absolute rounded-full"
              style={{
                left: WHEEL_THICK, top: WHEEL_THICK,
                width: SIZE - WHEEL_THICK * 2, height: SIZE - WHEEL_THICK * 2,
                ...svBg,
              }}
              onPointerDown={(e) => { dragging.current = "sv"; pickSv(e.clientX, e.clientY); }}
            />
            {/* SV 指示点 */}
            <div className="pointer-events-none absolute h-2.5 w-2.5 rounded-full border-2 border-white shadow"
              style={{ ...svDot }} />
            {/* 色相指示点 */}
            <div className="pointer-events-none absolute h-2.5 w-2.5 rounded-full border-2 border-white shadow"
              style={{ ...wheelDot }} />
          </div>
          {/* hex 输入 + 预览 */}
          <div className="mt-3 flex items-center gap-2">
            <div className="h-6 w-6 shrink-0 rounded border border-border" style={{ background: draft }} />
            <input
              value={draft}
              onChange={e => {
                const t = e.target.value;
                setDraft(t);
                if (/^#?[0-9a-f]{6}$/i.test(t)) {
                  const nh = hexToHsv(t);
                  setHsv(nh);
                  onChange("#" + t.replace("#", ""));
                }
              }}
              spellCheck={false}
              className="w-20 rounded-md border border-border bg-transparent px-2 py-0.5 font-mono text-[11px] text-foreground/80 outline-none focus:border-foreground/30"
            />
            <span className="text-[10px] text-foreground/40">H{Math.round(h)}° S{Math.round(s * 100)} V{Math.round(v * 100)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
