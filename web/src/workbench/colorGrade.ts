// 像素级 Camera Raw 风格调色（原地修改 ImageData）
// 亮度域调整（曝光/对比度/高光/阴影/白色/黑色）在加权灰度上做差值，保持色相不变；
// 色域调整（色温/色调/色相/饱和度/自然饱和度）在 RGB/HSL 上做。
import type { ColorAdjust } from "./types";

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// RGB(0~1) → HSL
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h: number;
  if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (mx === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

// HSL → RGB(0~1)
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l];
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)];
}

export function isDefaultAdjust(adj: ColorAdjust | undefined): boolean {
  if (!adj) return true;
  return (Object.keys(adj) as (keyof ColorAdjust)[]).every(k => adj[k] === 0);
}

export function applyColorGrade(imageData: ImageData, adj: ColorAdjust): void {
  const data = imageData.data;
  const n = data.length;

  // 预计算
  const temp = adj.temperature / 100;   // -1~1
  const tint = adj.tint / 100;          // -1~1
  const ev = Math.pow(2, (adj.exposure / 100) * 2.2);
  const contrast = adj.contrast / 100;
  const shadows = adj.shadows / 100;
  const highlights = adj.highlights / 100;
  const whites = adj.whites / 100;
  const blacks = adj.blacks / 100;
  const hueShift = adj.hue / 360;
  const satMult = 1 + adj.saturation / 100;
  const vib = adj.vibrance / 100;
  const needsHsl = adj.hue !== 0 || adj.saturation !== 0 || adj.vibrance !== 0;

  for (let i = 0; i < n; i += 4) {
    if (data[i + 3] === 0) continue; // 跳过全透明
    let r = data[i], g = data[i + 1], b = data[i + 2];

    // 1. 白平衡：色温（暖 +红 -蓝）、色调（品红 +红+蓝 -绿）
    r += temp * 40;
    b -= temp * 40;
    r += tint * 20;
    b += tint * 20;
    g -= tint * 40;

    // 2. 曝光（RGB 乘法）
    r *= ev; g *= ev; b *= ev;

    // 3. 亮度域调整（对比度/高光/阴影/白色/黑色）—— 差值法，保持色相
    const lum0 = 0.299 * r + 0.587 * g + 0.114 * b;
    let lum = (lum0 - 127.5) * (1 + contrast) + 127.5;
    const ln = clamp01(lum / 255);
    lum += shadows * (1 - ln) * 128;   // 阴影提升暗部
    lum -= highlights * ln * 128;      // 高光压暗亮部
    lum += whites * ln * 64;           // 白色提亮亮部
    lum -= blacks * (1 - ln) * 64;     // 黑色压暗暗部
    lum = lum < 0 ? 0 : lum > 255 ? 255 : lum;
    const delta = lum - lum0;
    r += delta; g += delta; b += delta;

    // 4. 色域调整（色相/饱和度/自然饱和度）
    if (needsHsl) {
      let [h, s, l] = rgbToHsl(r / 255, g / 255, b / 255);
      h = (h + hueShift + 1) % 1;
      s = s * satMult + vib * (1 - s) * 0.5; // 自然饱和度：低饱和提升更多
      s = clamp01(s);
      const [nr, ng, nb] = hslToRgb(h, s, l);
      r = nr * 255; g = ng * 255; b = nb * 255;
    }

    data[i] = r < 0 ? 0 : r > 255 ? 255 : r;
    data[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
    data[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
  }
}
