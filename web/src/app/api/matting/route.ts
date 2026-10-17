import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";

const PYTHON = "python";
const SCRIPT = path.join(process.cwd(), "scripts", "matting.py");
const TEMP_DIR = path.join(process.cwd(), ".tmp-matting");

export async function POST(req: NextRequest) {
  try {
    const { dataUrl } = await req.json();
    if (!dataUrl) return NextResponse.json({ error: "missing dataUrl" }, { status: 400 });

    // 解析 data URL → 写入临时文件
    fs.mkdirSync(TEMP_DIR, { recursive: true });
    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
    const inputPath = path.join(TEMP_DIR, "input.png");
    const outputPath = path.join(TEMP_DIR, "output.png");
    fs.writeFileSync(inputPath, Buffer.from(base64, "base64"));

    // 调用 Python rembg
    const result = await runPython([SCRIPT, inputPath, outputPath]);
    if (result.exitCode !== 0) {
      return NextResponse.json({ error: `matting failed: ${result.stderr}` }, { status: 500 });
    }

    // 读取输出 → 返回 data URL
    const outBuf = fs.readFileSync(outputPath);
    const outDataUrl = `data:image/png;base64,${outBuf.toString("base64")}`;

    // 清理临时文件
    try { fs.unlinkSync(inputPath); fs.unlinkSync(outputPath); } catch {}

    return NextResponse.json({ dataUrl: outDataUrl });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "unknown" }, { status: 500 });
  }
}

function runPython(args: string[]): Promise<{ exitCode: number; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(PYTHON, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stdout.on("data", () => {});
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("close", (code) => resolve({ exitCode: code ?? 1, stderr }));
    proc.on("error", (err) => resolve({ exitCode: 1, stderr: err.message }));
  });
}
