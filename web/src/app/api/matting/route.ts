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

    fs.mkdirSync(TEMP_DIR, { recursive: true });
    const ts = Date.now();
    const inPath = path.join(TEMP_DIR, `in_${ts}.png`);
    const outPath = path.join(TEMP_DIR, `out_${ts}.png`);
    fs.writeFileSync(inPath, Buffer.from(dataUrl.replace(/^data:image\/\w+;base64,/, ""), "base64"));

    const result = await runPython([SCRIPT, inPath, outPath]);
    if (result.exitCode !== 0 || !fs.existsSync(outPath)) {
      return NextResponse.json({ error: `matting failed: ${result.stderr}` }, { status: 500 });
    }

    const outBuf = fs.readFileSync(outPath);
    const outDataUrl = `data:image/png;base64,${outBuf.toString("base64")}`;
    try { fs.unlinkSync(inPath); fs.unlinkSync(outPath); } catch {}
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
