// 纯前端 SAM 交互分割：onnxruntime-web 跑通用 MobileSAM
// encoder = TinyViT (28MB)，decoder = SAM mask decoder (16.5MB)
// 官方范式：encoder 缓存一次 → 多点累积（左键前景/右键背景）→ 实时 mask 预览 → 确认导出
// 预处理/后处理与 SAM v1 官方对齐（本地 onnxruntime 实测通过）

import * as ort from "onnxruntime-web";

const DIM = 1024;

export interface SamPoint {
  x: number; // 文档坐标
  y: number;
  label: 1 | 0; // 1=前景（要抠），0=背景（排除）
}

let encSess: ort.InferenceSession | null = null;
let decSess: ort.InferenceSession | null = null;
// embedding 缓存：同一张底图只跑一次 encoder，之后点击秒级
let cachedEmb: ort.Tensor | null = null;
let cachedKey = "";

async function setupOrt() {
  ort.env.wasm.wasmPaths = "/";
  // 多线程 WASM 需要 SharedArrayBuffer（COOP/COEP）。真实浏览器 tab 可用；无隔离环境降单线程
  const canMulti = typeof SharedArrayBuffer !== "undefined";
  ort.env.wasm.numThreads = canMulti ? 4 : 1;
}

async function getEnc(): Promise<ort.InferenceSession> {
  if (encSess) return encSess;
  await setupOrt();
  encSess = await ort.InferenceSession.create("/models/mobilesam.encoder.onnx", {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  });
  return encSess;
}

async function getDec(): Promise<ort.InferenceSession> {
  if (decSess) return decSess;
  await setupOrt();
  decSess = await ort.InferenceSession.create("/models/mobilesam.decoder.onnx", {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  });
  return decSess;
}

// 底图 → encoder embedding（长边 resize 1024 → pad 1024×1024 → SAM 归一化 → HWC fp32）
async function encode(src: HTMLCanvasElement): Promise<ort.Tensor> {
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
    // 注意：encoder ONNX 内部已 bake 归一化（Sub mean / Div std），此处喂原始 [0,255] 即可
    input[i] = data[p];
    input[plane + i] = data[p + 1];
    input[2 * plane + i] = data[p + 2];
  }
  const tensor = new ort.Tensor("float32", input, [DIM, DIM, 3]);
  const enc = await getEnc();
  const out = await enc.run({ input_image: tensor });
  return out.image_embeddings as ort.Tensor;
}

// 取得（或缓存）底图 embedding。key 变化则重跑 encoder。
export async function samEmbed(src: HTMLCanvasElement, key: string): Promise<void> {
  if (cachedEmb && cachedKey === key) return;
  cachedEmb = await encode(src);
  cachedKey = key;
}

export function samClearCache() {
  cachedEmb = null;
  cachedKey = "";
}

// 多点预测 → 返回 mask 高亮预览 canvas（原尺寸；前景半透明、背景透明）
// points 为空时返回 null（无 mask）
export async function samPredict(
  src: HTMLCanvasElement,
  points: SamPoint[]
): Promise<HTMLCanvasElement | null> {
  if (!cachedEmb || points.length === 0) return null;

  const w = src.width, h = src.height;
  const scale = DIM / Math.max(w, h);
  const nw = Math.round(w * scale), nh = Math.round(h * scale);

  // 文档坐标 → 1024 空间
  const coords = new Float32Array(points.length * 2);
  const labels = new Float32Array(points.length);
  points.forEach((p, i) => {
    coords[i * 2] = p.x * scale;
    coords[i * 2 + 1] = p.y * scale;
    labels[i] = p.label;
  });

  const dec = await getDec();
  const pointCoords = new ort.Tensor("float32", coords, [1, points.length, 2]);
  const pointLabels = new ort.Tensor("float32", labels, [1, points.length]);
  const maskInput = new ort.Tensor("float32", new Float32Array(256 * 256), [1, 1, 256, 256]);
  const hasMask = new ort.Tensor("float32", new Float32Array([0]), [1]);
  const origSize = new ort.Tensor("float32", new Float32Array([nh, nw]), [2]);
  const out = await dec.run({
    image_embeddings: cachedEmb,
    point_coords: pointCoords,
    point_labels: pointLabels,
    mask_input: maskInput,
    has_mask_input: hasMask,
    orig_im_size: origSize,
  });
  const masks = out.masks as unknown as { data: Float32Array; dims: number[] };
  const mdata = masks.data;
  const mh = nh, mw = nw; // masks 已 resize 回 (nh, nw)

  // logits > 0 → 前景，上采样回原图尺寸，合成半透明高亮
  const mc = document.createElement("canvas");
  mc.width = mw; mc.height = mh;
  const mctx = mc.getContext("2d")!;
  const mimg = mctx.createImageData(mw, mh);
  for (let i = 0; i < mw * mh; i++) {
    const v = mdata[i] > 0 ? 255 : 0;
    const d = i * 4;
    mimg.data[d] = v; mimg.data[d + 1] = v; mimg.data[d + 2] = v; mimg.data[d + 3] = v;
  }
  mctx.putImageData(mimg, 0, 0);

  const maskFull = document.createElement("canvas");
  maskFull.width = w; maskFull.height = h;
  const mfctx = maskFull.getContext("2d")!;
  mfctx.imageSmoothingEnabled = true;
  mfctx.imageSmoothingQuality = "high";
  mfctx.drawImage(mc, 0, 0, w, h);
  const fdata = mfctx.getImageData(0, 0, w, h);

  // 高亮层：前景 = 青色半透明，背景透明
  const hi = document.createElement("canvas");
  hi.width = w; hi.height = h;
  const hctx = hi.getContext("2d")!;
  const hidata = hctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    if (fdata.data[i * 4] > 127) {
      const d = i * 4;
      hidata.data[d] = 60; hidata.data[d + 1] = 220; hidata.data[d + 2] = 205; hidata.data[d + 3] = 110;
    }
  }
  hctx.putImageData(hidata, 0, 0);
  return hi;
}

// 把当前预测 mask 合成到原图：前景保留原像素，背景透明（确认导出时用）
export async function samComposite(
  src: HTMLCanvasElement,
  points: SamPoint[]
): Promise<HTMLCanvasElement> {
  if (!cachedEmb || points.length === 0) return src;

  const w = src.width, h = src.height;
  const scale = DIM / Math.max(w, h);
  const nw = Math.round(w * scale), nh = Math.round(h * scale);

  const coords = new Float32Array(points.length * 2);
  const labels = new Float32Array(points.length);
  points.forEach((p, i) => {
    coords[i * 2] = p.x * scale;
    coords[i * 2 + 1] = p.y * scale;
    labels[i] = p.label;
  });

  const dec = await getDec();
  const pointCoords = new ort.Tensor("float32", coords, [1, points.length, 2]);
  const pointLabels = new ort.Tensor("float32", labels, [1, points.length]);
  const maskInput = new ort.Tensor("float32", new Float32Array(256 * 256), [1, 1, 256, 256]);
  const hasMask = new ort.Tensor("float32", new Float32Array([0]), [1]);
  const origSize = new ort.Tensor("float32", new Float32Array([nh, nw]), [2]);
  const out = await dec.run({
    image_embeddings: cachedEmb,
    point_coords: pointCoords,
    point_labels: pointLabels,
    mask_input: maskInput,
    has_mask_input: hasMask,
    orig_im_size: origSize,
  });
  const masks = out.masks as unknown as { data: Float32Array; dims: number[] };
  const mdata = masks.data;

  const mc = document.createElement("canvas");
  mc.width = nw; mc.height = nh;
  const mctx = mc.getContext("2d")!;
  const mimg = mctx.createImageData(nw, nh);
  for (let i = 0; i < nw * nh; i++) {
    const v = mdata[i] > 0 ? 255 : 0;
    const d = i * 4;
    mimg.data[d] = v; mimg.data[d + 1] = v; mimg.data[d + 2] = v; mimg.data[d + 3] = v;
  }
  mctx.putImageData(mimg, 0, 0);

  const maskFull = document.createElement("canvas");
  maskFull.width = w; maskFull.height = h;
  const mfctx = maskFull.getContext("2d")!;
  mfctx.imageSmoothingEnabled = true;
  mfctx.imageSmoothingQuality = "high";
  mfctx.drawImage(mc, 0, 0, w, h);
  const fdata = mfctx.getImageData(0, 0, w, h);

  const outCanvas = document.createElement("canvas");
  outCanvas.width = w; outCanvas.height = h;
  const octx = outCanvas.getContext("2d")!;
  octx.drawImage(src, 0, 0);
  const odata = octx.getImageData(0, 0, w, h);
  for (let i = 0; i < w * h; i++) {
    odata.data[i * 4 + 3] = fdata.data[i * 4];
  }
  octx.putImageData(odata, 0, 0);
  return outCanvas;
}
