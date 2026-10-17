// 纯前端快速抠像：onnxruntime-web (WASM 多线程) 跑 u2netp
// 4.36MB 模型，320×320 输入，秒级推理
// 预处理/后处理与 rembg U2netpSession 完全对齐

import * as ort from "onnxruntime-web";

let sess: ort.InferenceSession | null = null;

async function getSession(): Promise<ort.InferenceSession> {
  if (sess) return sess;
  ort.env.wasm.wasmPaths = "/";
  // 多线程 WASM 需要 SharedArrayBuffer（COOP/COEP）。
  // 真实浏览器 tab 里可用→4线程快；iframe/无隔离环境→自动降单线程（慢但能跑）
  const canMulti = typeof SharedArrayBuffer !== "undefined";
  ort.env.wasm.numThreads = canMulti ? 4 : 1;
  sess = await ort.InferenceSession.create("/models/u2netp.onnx", {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  });
  return sess;
}

export async function smartCutout(
  src: HTMLCanvasElement | HTMLImageElement
): Promise<HTMLCanvasElement> {
  const s = await getSession();
  const N = 320;

  // 1. resize 320×320（LANCZOS ≈ browser 高质量平滑）
  const c = document.createElement("canvas");
  c.width = N; c.height = N;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, N, N);
  const { data } = ctx.getImageData(0, 0, N, N);

  // 2. 预处理（与 rembg base.normalize 对齐）
  //    / globalMax → (c - mean)/std per channel → NCHW float32
  const MEAN = [0.485, 0.456, 0.406];
  const STD = [0.229, 0.224, 0.225];
  let gmax = 1e-6;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > gmax) gmax = data[i];
    if (data[i + 1] > gmax) gmax = data[i + 1];
    if (data[i + 2] > gmax) gmax = data[i + 2];
  }
  const plane = N * N;
  const input = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    const p = i * 4;
    input[i] = (data[p] / gmax - MEAN[0]) / STD[0];
    input[plane + i] = (data[p + 1] / gmax - MEAN[1]) / STD[1];
    input[2 * plane + i] = (data[p + 2] / gmax - MEAN[2]) / STD[2];
  }
  const tensor = new ort.Tensor("float32", input, [1, 3, N, N]);

  // 3. 推理
  const inputName = s.inputNames[0];
  const outputName = s.outputNames[0];
  const results = await s.run({ [inputName]: tensor });
  const pred = (results[outputName] as unknown as { data: Float32Array }).data;

  // 4. 后处理：min-max → mask → 回贴 RGBA（最近邻，320→原图）
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < pred.length; i++) {
    if (pred[i] < mn) mn = pred[i];
    if (pred[i] > mx) mx = pred[i];
  }
  const range = mx - mn || 1;

  const out = document.createElement("canvas");
  out.width = src.width; out.height = src.height;
  const octx = out.getContext("2d")!;
  octx.drawImage(src as CanvasImageSource, 0, 0);
  const odata = octx.getImageData(0, 0, out.width, out.height);
  const sx = N / out.width, sy = N / out.height;
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const mx2 = Math.min(N - 1, Math.floor(x * sx));
      const my2 = Math.min(N - 1, Math.floor(y * sy));
      const a = Math.round(((pred[my2 * N + mx2] - mn) / range) * 255);
      const p = (y * out.width + x) * 4;
      odata.data[p + 3] = a;
    }
  }
  octx.putImageData(odata, 0, 0);
  return out;
}
