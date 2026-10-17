// 纯前端 SAM 点击分割：onnxruntime-web 跑通用 MobileSAM
// encoder = TinyViT (28MB)，decoder = SAM mask decoder (16.5MB)
// 交互：点击某个物体 → 该物体 mask（前景），选区内像素保留、选区外透明
// 预处理/后处理与 SAM v1 官方对齐（本地 onnxruntime 实测通过）

import * as ort from "onnxruntime-web";

const MEAN = [123.675, 116.28, 103.53];
const STD = [58.395, 57.12, 57.375];
const DIM = 1024;

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
    input[i] = (data[p] - MEAN[0]) / STD[0];
    input[plane + i] = (data[p + 1] - MEAN[1]) / STD[1];
    input[2 * plane + i] = (data[p + 2] - MEAN[2]) / STD[2];
  }
  const tensor = new ort.Tensor("float32", input, [DIM, DIM, 3]);
  const enc = await getEnc();
  const out = await enc.run({ input_image: tensor });
  return out.image_embeddings as ort.Tensor;
}

// 点击点 → 单个前景 mask，返回透明背景主体 canvas（尺寸 = src 原始尺寸）
export async function samSegment(
  src: HTMLCanvasElement,
  docX: number,
  docY: number,
  key: string
): Promise<HTMLCanvasElement> {
  const w = src.width, h = src.height;
  const scale = DIM / Math.max(w, h);
  const nw = Math.round(w * scale), nh = Math.round(h * scale);

  // 1. embedding（缓存）
  let emb = cachedEmb;
  if (!emb || cachedKey !== key) {
    emb = await encode(src);
    cachedEmb = emb;
    cachedKey = key;
  }

  // 2. 点击坐标 → 1024 空间（长边缩放后坐标，未 pad 偏移，因图贴左上角）
  const px = docX * scale, py = docY * scale;

  // 3. decoder：单前景点
  const dec = await getDec();
  const pointCoords = new ort.Tensor("float32", new Float32Array([px, py]), [1, 1, 2]);
  const pointLabels = new ort.Tensor("float32", new Float32Array([1]), [1, 1]);
  const maskInput = new ort.Tensor("float32", new Float32Array(256 * 256), [1, 1, 256, 256]);
  const hasMask = new ort.Tensor("float32", new Float32Array([0]), [1]);
  const origSize = new ort.Tensor("float32", new Float32Array([nh, nw]), [2]);
  const out = await dec.run({
    image_embeddings: emb,
    point_coords: pointCoords,
    point_labels: pointLabels,
    mask_input: maskInput,
    has_mask_input: hasMask,
    orig_im_size: origSize,
  });
  const masks = out.masks as unknown as { data: Float32Array; dims: number[] };
  const mdata = masks.data;
  const mh = nh, mw = nw; // masks 已 resize 回 (nh, nw)

  // 4. logits > 0 → 前景 mask，上采样回原图尺寸
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

  // 5. 合成：原图像素 + mask alpha（mask 内不透明，mask 外透明）
  const outCanvas = document.createElement("canvas");
  outCanvas.width = w; outCanvas.height = h;
  const octx = outCanvas.getContext("2d")!;
  octx.drawImage(src, 0, 0);
  const odata = octx.getImageData(0, 0, w, h);
  const fdata = mfctx.getImageData(0, 0, w, h);
  for (let i = 0; i < w * h; i++) {
    odata.data[i * 4 + 3] = fdata.data[i * 4];
  }
  octx.putImageData(odata, 0, 0);
  return outCanvas;
}
