import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";

const COMFY_URL = "http://127.0.0.1:8188";
const INPUT_DIR = path.join("H:", "ComfyUI_windows_portable_nvidia2", "ComfyUI_windows_portable", "ComfyUI", "input");
const OUTPUT_DIR = path.join("H:", "ComfyUI_windows_portable_nvidia2", "ComfyUI_windows_portable", "ComfyUI", "output");

export async function POST(req: NextRequest) {
  try {
    const { image, mask, prompt } = await req.json();
    if (!image || !mask) return NextResponse.json({ error: "missing image/mask" }, { status: 400 });

    // 1. 写入 ComfyUI input 目录
    fs.mkdirSync(INPUT_DIR, { recursive: true });
    const ts = Date.now();
    const imgFile = `malachite_img_${ts}.png`;
    const maskFile = `malachite_mask_${ts}.png`;
    fs.writeFileSync(path.join(INPUT_DIR, imgFile), Buffer.from(image.replace(/^data:image\/\w+;base64,/, ""), "base64"));
    fs.writeFileSync(path.join(INPUT_DIR, maskFile), Buffer.from(mask.replace(/^data:image\/\w+;base64,/, ""), "base64"));

    // 2. 构建 ComfyUI inpaint 工作流
    const workflow = buildInpaintWorkflow(imgFile, maskFile, prompt || "fill naturally");

    // 3. 提交 ComfyUI
    const submitRes = await fetch(`${COMFY_URL}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflow }),
    });
    if (!submitRes.ok) {
      const err = await submitRes.text();
      return NextResponse.json({ error: `ComfyUI submit failed: ${err}` }, { status: 502 });
    }
    const { prompt_id } = await submitRes.json();

    // 4. 轮询历史
    const result = await pollHistory(prompt_id, 120);
    if (!result) return NextResponse.json({ error: "ComfyUI timeout" }, { status: 504 });

    // 5. 读取输出图
    const outFile = path.join(OUTPUT_DIR, result.subfolder || "", result.filename);
    const outBuf = fs.readFileSync(outFile);
    const outDataUrl = `data:image/png;base64,${outBuf.toString("base64")}`;

    // 6. 清理 input
    try { fs.unlinkSync(path.join(INPUT_DIR, imgFile)); fs.unlinkSync(path.join(INPUT_DIR, maskFile)); } catch {}

    return NextResponse.json({ dataUrl: outDataUrl, prompt_id });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "unknown" }, { status: 500 });
  }
}

// ComfyUI inpaint 最小工作流: LoadImage → LoadImage(mask) → INPAINT_MODEL条件 → KSampler → VAEDecode → SaveImage
// 注意：需要模型已加载。这里用 UNETLoader + CLIPLoader + VAELoader 通用链。
function buildInpaintWorkflow(imgFile: string, maskFile: string, prompt: string): Record<string, any> {
  return {
    "3": { class_type: "LoadImage", inputs: { image: imgFile } },
    "4": { class_type: "LoadImage", inputs: { image: maskFile } },
    "5": { class_type: "MaskComposite", inputs: { image: ["3", 0], mask: ["4", 0], operation: "multiply" } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["8", 0] } },
    "7": { class_type: "KSampler", inputs: {
      model: ["10", 0], seed: Math.floor(Math.random() * 1e10), steps: 20, cfg: 7.0, sampler_name: "euler", scheduler: "normal",
      denoise: 1.0, positive: ["6", 0], negative: ["9", 0], latent_image: ["11", 0]
    }},
    "8": { class_type: "CLIPLoader", inputs: { clip_name: "clip_l.safetensors", type: "sdxl" } },
    "9": { class_type: "CLIPTextEncode", inputs: { text: "", clip: ["8", 0] } },
    "10": { class_type: "UNETLoader", inputs: { unet_name: "sd_xl_base_1.0.safetensors", weight_dtype: "default" } },
    "11": { class_type: "VAEEncode", inputs: { pixels: ["3", 0], vae: ["12", 0] } },
    "12": { class_type: "VAELoader", inputs: { vae_name: "ae.safetensors" } },
    "13": { class_type: "VAEDecode", inputs: { samples: ["7", 0], vae: ["12", 0] } },
    "14": { class_type: "SaveImage", inputs: { images: ["13", 0], filename_prefix: "malachite_inpaint" } },
  };
}

async function pollHistory(promptId: string, maxSec: number): Promise<{ filename: string; subfolder: string } | null> {
  const start = Date.now();
  while (Date.now() - start < maxSec * 1000) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const res = await fetch(`${COMFY_URL}/history/${promptId}`);
      if (!res.ok) continue;
      const hist = await res.json();
      const entry = hist[promptId];
      if (!entry?.outputs) continue;
      for (const nodeOut of Object.values(entry.outputs)) {
        const images = (nodeOut as any).images;
        if (images?.[0]) return images[0];
      }
    } catch {}
  }
  return null;
}
