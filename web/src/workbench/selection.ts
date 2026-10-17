// 选区引擎：魔棒（种子填充）+ 套索（自由手绘）→ 位图选区
// 选区 = Uint8Array(w*h)，1=选中。魔棒按颜色距离阈值 BFS 扩散。
export type Selection = { w: number; h: number; data: Uint8Array };

// 魔棒：从 (sx,sy) 种子，颜色距离 <= tolerance 的连通区域全选中
export function magicWand(
  imgData: ImageData, sx: number, sy: number, tolerance = 32
): Selection {
  const { width: w, height: h, data } = imgData;
  const sel = new Uint8Array(w * h);
  const seed = (sy * w + sx) * 4;
  const sr = data[seed], sg = data[seed + 1], sb = data[seed + 2];
  const tol2 = tolerance * tolerance;
  const stack = [sy * w + sx];
  const match = (i: number) => {
    const d = i * 4;
    const dr = data[d] - sr, dg = data[d + 1] - sg, db = data[d + 2] - sb;
    return dr * dr + dg * dg + db * db <= tol2;
  };
  while (stack.length) {
    const p = stack.pop()!;
    if (sel[p]) continue;
    if (!match(p)) continue;
    sel[p] = 1;
    const x = p % w, y = (p / w) | 0;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - w);
    if (y < h - 1) stack.push(p + w);
  }
  return { w, h, data: sel };
}

// 套索：多边形顶点 → 填充多边形内部
export function lasso(
  points: { x: number; y: number }[], w: number, h: number
): Selection {
  const sel = new Uint8Array(w * h);
  if (points.length < 3) return { w, h, data: sel };
  const inside = (px: number, py: number) => {
    let c = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const xi = points[i].x, yi = points[i].y, xj = points[j].x, yj = points[j].y;
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (inside(x, y)) sel[y * w + x] = 1;
  return { w, h, data: sel };
}

// 对选区填充颜色（透明=清除）
export function fillSelection(imgData: ImageData, sel: Selection, color: string | null): ImageData {
  const out = new ImageData(new Uint8ClampedArray(imgData.data), imgData.width, imgData.height);
  if (color) {
    const c = hexToRgb(color);
    for (let i = 0; i < sel.data.length; i++) {
      if (!sel.data[i]) continue;
      const d = i * 4;
      out.data[d] = c.r; out.data[d + 1] = c.g; out.data[d + 2] = c.b; out.data[d + 3] = 255;
    }
  } else {
    for (let i = 0; i < sel.data.length; i++)
      if (sel.data[i]) out.data[i * 4 + 3] = 0;
  }
  return out;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = hex.replace('#', '');
  return {
    r: parseInt(m.slice(0, 2), 16) || 0,
    g: parseInt(m.slice(2, 4), 16) || 0,
    b: parseInt(m.slice(4, 6), 16) || 0,
  };
}

// 选区 → 半透明遮罩 canvas（渲染用：选中区染青色，一眼看清选了什么）
export function selectionToCanvas(sel: Selection, rgba = "rgba(60,220,205,0.32)"): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = sel.w; c.height = sel.h;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(sel.w, sel.h);
  const [r, g, b, a] = parseRgba(rgba);
  for (let i = 0; i < sel.data.length; i++) {
    if (!sel.data[i]) continue;
    const d = i * 4;
    img.data[d] = r; img.data[d + 1] = g; img.data[d + 2] = b; img.data[d + 3] = a;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function parseRgba(s: string): [number, number, number, number] {
  const m = s.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/);
  if (!m) return [60, 220, 205, 80];
  return [+m[1], +m[2], +m[3], Math.round((m[4] === undefined ? 1 : +m[4]) * 255)];
}
