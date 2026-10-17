// 纯前端 SAM 分割：onnxruntime-web 跑官方 SAM ViT-B（WebGPU 优先，WASM 兜底）
// encoder = vit_b fp16 (172MB)，decoder = mask decoder (16MB)
// 两种模式：
//   1) 点选（官方交互范式）：encoder 缓存一次 → 左键前景/右键背景多点 → 实时 mask 预览 → 确认导出
//   2) 全景分割（automatic mask generator）：网格采样点 → NMS 去重 → 彩色叠图，点选抠出
// ViT-B 预处理：长边 resize 1024 → pad 1024×1024 → SAM 归一化 → NCHW [1,3,1024,1024]

import * as ort from "onnxruntime-web/webgpu";

const DIM = 1024;
const MEAN = [123.675, 116.28, 103.53];
const STD = [58.395, 57.12, 57.375];

export interface SamPoint {
  x: number;
  y: number;
  label: 1 | 0; // 1=前景（选中），0=背景（排除）
}

export interface SamRegion {
  color: string;
  mask: Uint8Array; // 二值 0/255，尺寸 nh×nw（resize 后）
  nw: number;
  nh: number;
  area: number; // 前景像素数
}

let encSess: ort.InferenceSession | null = null;
let decSess: ort.InferenceSession | null = null;
let cachedEmb: ort.Tensor | null = null;
let cachedKey = "";
let cachedGeom = { nw: 0, nh: 0, scale: 1 };

async function setupOrt() {
  ort.env.wasm.wasmPaths = "/";
  const canMulti = typeof SharedArrayBuffer !== "undefined";
  ort.env.wasm.numThreads = canMulti ? 4 : 1;
}

async function getEnc(): Promise<ort.InferenceSession> {
  if (encSess) return encSess;
  await setupOrt();
  encSess = await ort.InferenceSession.create("/models/sam_b_encoder.onnx", {
    executionProviders: ["webgpu", "wasm"],
    graphOptimizationLevel: "all",
  });
  return encSess;
}

async function getDec(): Promise<ort.InferenceSession> {
  if (decSess) return decSess;
  await setupOrt();
  decSess = await ort.InferenceSession.create("/models/sam_b_decoder.onnx", {
    executionProviders: ["webgpu", "wasm"],
    graphOptimizationLevel: "all",
  });
  return decSess;
}

// 底图 → NCHW 归一化 tensor（长边 resize 1024 → pad 1024×1024 → (x-mean)/std → [1,3,1024,1024]）
function preprocess(src: HTMLCanvasElement): { tensor: ort.Tensor; nw: number; nh: number; scale: number } {
  const w = src.width, h = src.height;
  const scale = DIM / Math.max(w, h);
  const nw = Math.round(w * scale), nh = Math.round(h * scale);

  const c = document.createElement("canvas");
  c.width = DIM; c.height = DIM;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, DIM, DIM);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, nw, nh);
  const { data } = ctx.getImageData(0, 0, DIM, DIM);

  const plane = DIM * DIM;
  const input = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    const p = i * 4;
    input[i] = (data[p] - MEAN[0]) / STD[0];
    input[plane + i] = (data[p + 1] - MEAN[1]) / STD[1];
    input[2 * plane + i] = (data[p + 2] - MEAN[2]) / STD[2];
  }
  const tensor = new ort.Tensor("float32", input, [1, 3, DIM, DIM]);
  return { tensor, nw, nh, scale };
}

// encoder 一次，按 key 缓存 embedding
export async function samEmbed(src: HTMLCanvasElement, key: string): Promise<void> {
  if (cachedEmb && cachedKey === key) return;
  const { tensor, nw, nh, scale } = preprocess(src);
  const enc = await getEnc();
  const out = await enc.run({ input_image: tensor });
  cachedEmb = out.image_embeddings as ort.Tensor;
  cachedKey = key;
  cachedGeom = { nw, nh, scale };
}

// 多点跑 decoder，返回最佳 mask 二值 Uint8Array（尺寸 nh×nw）+ iou
// 原始 decoder 调用：返回 iou 最高的 mask logits（Float32Array，长度 nh×nw）+ iou
async function decodeRaw(points: SamPoint[]): Promise<{ logits: Float32Array; iou: number }> {
  const emb = cachedEmb!;
  const { nw, nh, scale } = cachedGeom;
  const n = points.length;
  const coords = new Float32Array(n * 2);
  const labels = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    coords[i * 2] = points[i].x * scale;
    coords[i * 2 + 1] = points[i].y * scale;
    labels[i] = points[i].label;
  }
  const dec = await getDec();
  const feeds: Record<string, ort.Tensor> = {
    image_embeddings: emb,
    point_coords: new ort.Tensor("float32", coords, [1, n, 2]),
    point_labels: new ort.Tensor("float32", labels, [1, n]),
    mask_input: new ort.Tensor("float32", new Float32Array(256 * 256), [1, 1, 256, 256]),
    has_mask_input: new ort.Tensor("float32", new Float32Array([0]), [1]),
    orig_im_size: new ort.Tensor("float32", new Float32Array([nh, nw]), [2]),
  };
  const out = await dec.run(feeds);
  const masks = out.masks as unknown as { data: Float32Array; dims: number[] };
  const ious = out.iou_predictions as unknown as { data: Float32Array; dims: number[] };
  // 单 mask（dims[1]=1）或 multi-mask（dims[1]=3）：取 iou 最高
  const nm = masks.dims[1] ?? 1;
  let bi = 0;
  for (let i = 1; i < nm; i++) if (ious.data[i] > ious.data[bi]) bi = i;
  const total = nh * nw;
  const logits = masks.data.subarray(bi * total, (bi + 1) * total);
  return { logits, iou: ious.data[bi] };
}

async function decodePoints(points: SamPoint[]): Promise<{ mask: Uint8Array; iou: number }> {
  const { logits, iou } = await decodeRaw(points);
  const mask = new Uint8Array(logits.length);
  for (let i = 0; i < mask.length; i++) mask[i] = logits[i] > 0 ? 1 : 0;
  return { mask, iou };
}

// 把 nh×nw 二值 mask 上采样回原图尺寸，返回 Uint8Array（0/255）
function upsampleMask(mask: Uint8Array, nw: number, nh: number, w: number, h: number): Uint8Array {
  const c = document.createElement("canvas");
  c.width = nw; c.height = nh;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(nw, nh);
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i] ? 255 : 0;
    img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = v;
  }
  ctx.putImageData(img, 0, 0);
  const c2 = document.createElement("canvas");
  c2.width = w; c2.height = h;
  const ctx2 = c2.getContext("2d")!;
  ctx2.imageSmoothingEnabled = true;
  ctx2.imageSmoothingQuality = "high";
  ctx2.drawImage(c, 0, 0, w, h);
  return new Uint8Array(ctx2.getImageData(0, 0, w, h).data.filter((_, i) => i % 4 === 0));
}

// mask 二值（原图尺寸）→ 透明背景主体 canvas
function maskToCutout(src: HTMLCanvasElement, maskFull: Uint8Array, w: number, h: number): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = w; out.height = h;
  const octx = out.getContext("2d")!;
  octx.drawImage(src, 0, 0);
  const odata = octx.getImageData(0, 0, w, h);
  for (let i = 0; i < w * h; i++) odata.data[i * 4 + 3] = maskFull[i];
  octx.putImageData(odata, 0, 0);
  return out;
}

// 点选：返回 mask 高亮预览 canvas（原图尺寸，选区内半透明青色）
export async function samPredict(src: HTMLCanvasElement, points: SamPoint[]): Promise<HTMLCanvasElement> {
  const { mask } = await decodePoints(points);
  const { nw, nh } = cachedGeom;
  const w = src.width, h = src.height;
  const maskFull = upsampleMask(mask, nw, nh, w, h);
  // 生成高亮层：选区内青色半透明，选区外透明
  const out = document.createElement("canvas");
  out.width = w; out.height = h;
  const octx = out.getContext("2d")!;
  const img = octx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    if (maskFull[i] > 127) {
      img.data[i * 4] = 60; img.data[i * 4 + 1] = 220; img.data[i * 4 + 2] = 205; img.data[i * 4 + 3] = 110;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

// 点选确认：当前 mask 抠成透明背景新图层
export async function samComposite(src: HTMLCanvasElement, points: SamPoint[]): Promise<HTMLCanvasElement> {
  const { mask } = await decodePoints(points);
  const { nw, nh } = cachedGeom;
  const w = src.width, h = src.height;
  const maskFull = upsampleMask(mask, nw, nh, w, h);
  return maskToCutout(src, maskFull, w, h);
}

// ===== 全景分割（automatic mask generator 简化版）=====
const PALETTE = [
  "#e6194b", "#3cb44b", "#ffe119", "#4363d8", "#f58231", "#911eb4", "#46f0f0", "#f032e6",
  "#bcf60c", "#fabebe", "#008080", "#e6beff", "#9a6324", "#fffac8", "#800000", "#aaffc3",
  "#808000", "#ffd8b1", "#000075", "#808080", "#ffffff", "#000000",
];

export async function samSegmentAll(
  src: HTMLCanvasElement,
  key: string,
  pointsPerSide = 16,
  onProgress?: (done: number, total: number) => void
): Promise<{ overlay: HTMLCanvasElement; regions: SamRegion[] }> {
  await samEmbed(src, key);
  const { nw, nh, scale } = cachedGeom;
  const w = src.width, h = src.height;

  // 1. 网格采样点（在有效区域 nw×nh 内均匀分布）
  const pts: { x: number; y: number }[] = [];
  const stepX = nw / (pointsPerSide + 1), stepY = nh / (pointsPerSide + 1);
  for (let i = 1; i <= pointsPerSide; i++)
    for (let j = 1; j <= pointsPerSide; j++)
      pts.push({ x: j * stepX, y: i * stepY });
  // 网格点坐标是 1024 空间，但 decodePoints 会 ×scale；这里直接用文档坐标 = 1024空间/scale
  const docPts = pts.map(p => ({ x: p.x / scale, y: p.y / scale, label: 1 as const }));

  // 2. 逐点 decoder + 一次扫描（二值化 + bbox + area 合并，避免双重全图扫描）
  const totalPx = nw * nh;
  const MIN_AREA = totalPx * 0.002; // 0.2% 以下忽略
  const candidates: { mask: Uint8Array; area: number; bbox: [number, number, number, number] }[] = [];
  const total = pts.length;
  for (let i = 0; i < total; i++) {
    const { logits } = await decodeRaw([docPts[i]]);
    const mask = new Uint8Array(totalPx);
    let area = 0, x0 = nw, y0 = nh, x1 = 0, y1 = 0;
    for (let y = 0; y < nh; y++) {
      const row = y * nw;
      for (let x = 0; x < nw; x++) {
        if (logits[row + x] > 0) {
          mask[row + x] = 1;
          area++;
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    if (area >= MIN_AREA && area <= totalPx * 0.95) candidates.push({ mask, area, bbox: [x0, y0, x1, y1] });
    if (i % 8 === 0 || i === total - 1) onProgress?.(i + 1, total);
  }
  candidates.sort((a, b) => b.area - a.area);

  // 3. NMS（bbox IoU）

  const bboxIoU = (a: number[], b: number[]) => {
    const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
    const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
    const inter = ix * iy;
    const ua = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
    return ua > 0 ? inter / ua : 0;
  };

  const kept: typeof candidates = [];
  for (const cand of candidates) {
    let dup = false;
    for (const k of kept) {
      if (bboxIoU(cand.bbox, k.bbox) > 0.7) { dup = true; break; }
    }
    if (!dup) kept.push(cand);
  }

  // 4. 合成彩色叠图 + 生成 regions
  const regions: SamRegion[] = [];
  const overlay = document.createElement("canvas");
  overlay.width = w; overlay.height = h;
  const octx = overlay.getContext("2d")!;
  const overlayImg = octx.createImageData(w, h);
  for (let i = 0; i < kept.length; i++) {
    const k = kept[i];
    const color = PALETTE[i % PALETTE.length];
    const [r, g, b] = hexToRgb(color);
    const maskFull = upsampleMask(k.mask, nw, nh, w, h);
    regions.push({ color, mask: k.mask, nw, nh, area: k.area });
    for (let p = 0; p < w * h; p++) {
      if (maskFull[p] > 127) {
        overlayImg.data[p * 4] = r; overlayImg.data[p * 4 + 1] = g; overlayImg.data[p * 4 + 2] = b; overlayImg.data[p * 4 + 3] = 140;
      }
    }
  }
  octx.putImageData(overlayImg, 0, 0);
  return { overlay, regions };
}

function hexToRgb(hex: string): [number, number, number] {
  const s = hex.replace("#", "");
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

// 抠出某个 region
export async function samExtractRegion(src: HTMLCanvasElement, region: SamRegion): Promise<HTMLCanvasElement> {
  const w = src.width, h = src.height;
  const maskFull = upsampleMask(region.mask, region.nw, region.nh, w, h);
  return maskToCutout(src, maskFull, w, h);
}

export function samClearCache() {
  cachedEmb = null;
  cachedKey = "";
}
