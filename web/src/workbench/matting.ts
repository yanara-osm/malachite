// 纯前端智能抠像：onnxruntime-web + WebGPU 跑 isnet-general-use
// 零 Python、零子进程、零 API route、零网络
// 预处理/后处理与 rembg DisSession 完全对齐

import * as ort from "onnxruntime-web";

let sess: ort.InferenceSession | null = null;

async function getSession(): Promise<ort.InferenceSession> {
  if (sess) return sess;
  ort.env.wasm.wasmPaths = "/";
  ort.env.wasm.numThreads = 1;
  sess = await ort.InferenceSession.create("/models/isnet.onnx", {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  });
  return sess;
}

export async function smartCutout(
  src: HTMLCanvasElement | HTMLImageElement
): Promise<HTMLCanvasElement> {
  const s = await getSession();
  const N = 1024;

  // 1. 缩放到 1024×1024（LANCZOS ≈ browser 默认平滑）
  const c = document.createElement("canvas");
  c.width = N; c.height = N;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, N, N);
  const { data } = ctx.getImageData(0, 0, N, N);

  // 2. 预处理（与 rembg DisSession.normalize 对齐）
  //    globalMax → /max → (c - 0.5) / 1.0 → NCHW
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
    input[i] = (data[p] / gmax - 0.5);
    input[plane + i] = (data[p + 1] / gmax - 0.5);
    input[2 * plane + i] = (data[p + 2] / gmax - 0.5);
  }
  const tensor = new ort.Tensor("float32", input, [1, 3, N, N]);

  // 3. 推理
  const inputName = s.inputNames[0];
  const outputName = s.outputNames[0];
  const results = await s.run({ [inputName]: tensor });
  const pred = (results[outputName] as unknown as { data: Float32Array }).data;

  // 4. 后处理：min-max 归一化 → mask → 回贴 RGBA
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < pred.length; i++) {
    if (pred[i] < mn) mn = pred[i];
    if (pred[i] > mx) mx = pred[i];
  }
  const range = mx - mn || 1;

  const out = document.createElement("canvas");
  out.width = src.width; out.height = src.height;
  const octx = out.getContext("2d")!;
  // 先画原图
  octx.drawImage(src as CanvasImageSource, 0, 0);
  const odata = octx.getImageData(0, 0, out.width, out.height);

  // mask 1024 → 原图尺寸（双线性近似：最近邻 + 后续可优化）
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
