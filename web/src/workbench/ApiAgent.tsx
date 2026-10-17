"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getApiDefs, getApiKey, type ApiDef, type ApiParam } from "@/lib/apis";
import { rhUpload, rhRun, buildNodeInfoList, rhDownloadAsDataUrl } from "@/lib/runninghub";

// 图片来源三选一
export type ImageSource = "layer" | "selection" | "full";
const IMAGE_SOURCES: { value: ImageSource; label: string }[] = [
  { value: "full", label: "整图" },
  { value: "layer", label: "活动图层" },
  { value: "selection", label: "当前选区" },
];

interface Props {
  onAddImage: (dataUrl: string, name: string) => void;
  getImageSource: (source: ImageSource) => Promise<Blob | null>;
  hasSelection: boolean;
}

const inputCls = "w-full rounded-md border border-border bg-card px-2 py-1 text-[11px] text-foreground/90 outline-none focus:border-foreground/30";

export default function ApiAgent({ onAddImage, getImageSource, hasSelection }: Props) {
  const [defs, setDefs] = useState<ApiDef[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [imageSources, setImageSources] = useState<Record<string, ImageSource>>({});
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const list = getApiDefs();
    setDefs(list);
    if (list.length > 0) selectDef(list[0].id, list);
  }, []);

  const def = defs.find(d => d.id === selectedId) ?? null;

  const selectDef = (id: string, list = defs) => {
    setSelectedId(id);
    const d = list.find(x => x.id === id);
    if (!d) return;
    const v: Record<string, unknown> = {};
    const img: Record<string, ImageSource> = {};
    d.params.forEach(p => {
      v[p.key] = p.default ?? "";
      if (p.type === "image") img[p.key] = "full";
    });
    setValues(v);
    setImageSources(img);
    setError("");
    setProgress("");
  };

  const setValue = (key: string, val: unknown) => setValues(v => ({ ...v, [key]: val }));

  const run = async () => {
    if (!def) return;
    const apiKey = getApiKey();
    if (!apiKey) { setError("请先到「AI API 管理」填 API Key"); return; }
    if (!def.webappId) { setError("该 API 缺 webappId"); return; }
    for (const p of def.params) {
      if (p.type === "image") continue; // 图片参数走来源三选一自动取图，无需填值
      if (p.required && (values[p.key] === "" || values[p.key] === undefined)) {
        setError(`请填写「${p.label}」`); return;
      }
    }
    setRunning(true);
    setError("");
    setProgress("");
    try {
      // 1. 图片参数：取图 → 上传 → fileName
      setProgress("取图…");
      const uploaded: Record<string, string> = {};
      for (const p of def.params) {
        if (p.type !== "image") continue;
        const src = imageSources[p.key] ?? "full";
        const blob = await getImageSource(src);
        if (!blob) throw new Error(`取图失败（${p.label}）`);
        setProgress(`上传 ${p.label}…`);
        const up = await rhUpload(blob, apiKey);
        uploaded[p.key] = up.fileName;
      }
      // 2. 组装 nodeInfoList → 提交 → 轮询
      const nodeInfoList = buildNodeInfoList(def, values, uploaded);
      const urls = await rhRun(def, apiKey, nodeInfoList, setProgress);
      // 3. 结果进图层
      setProgress("下载结果…");
      for (const url of urls) {
        const dataUrl = await rhDownloadAsDataUrl(url);
        onAddImage(dataUrl, `${def.name} · 结果`);
      }
      setProgress("完成 ✓");
    } catch (e) {
      setError(e instanceof Error ? e.message : "运行失败");
    } finally {
      setRunning(false);
    }
  };

  const renderParam = (p: ApiParam) => {
    if (p.type === "image") {
      return (
        <div key={p.key} className="mb-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] text-foreground/50">{p.label}</span>
          </div>
          <div className="flex gap-1">
            {IMAGE_SOURCES.map(s => (
              <button key={s.value}
                disabled={s.value === "selection" && !hasSelection}
                onClick={() => setImageSources(v => ({ ...v, [p.key]: s.value }))}
                className={`flex-1 rounded-md border px-1 py-1 text-[10px] transition ${imageSources[p.key] === s.value
                  ? "border-foreground/40 bg-foreground/10 text-foreground"
                  : "border-border text-foreground/50 hover:bg-foreground/5"} ${s.value === "selection" && !hasSelection ? "cursor-not-allowed opacity-30" : ""}`}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
      );
    }
    if (p.type === "textarea") {
      return (
        <div key={p.key} className="mb-2">
          <span className="mb-1 block text-[10px] text-foreground/50">{p.label}</span>
          <textarea rows={3} className={inputCls} value={String(values[p.key] ?? "")} onChange={e => setValue(p.key, e.target.value)} />
        </div>
      );
    }
    if (p.type === "boolean") {
      return (
        <div key={p.key} className="mb-2">
          <label className="flex items-center gap-1.5 text-[10px] text-foreground/60">
            <input type="checkbox" checked={Boolean(values[p.key])} onChange={e => setValue(p.key, e.target.checked)} />
            {p.label}
          </label>
        </div>
      );
    }
    if (p.type === "select") {
      return (
        <div key={p.key} className="mb-2">
          <span className="mb-1 block text-[10px] text-foreground/50">{p.label}</span>
          <select className={inputCls} value={String(values[p.key] ?? "")} onChange={e => setValue(p.key, e.target.value)}>
            {(p.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
      );
    }
    if (p.type === "slider") {
      const v = Number(values[p.key] ?? p.min ?? 0);
      return (
        <div key={p.key} className="mb-2">
          <div className="mb-0.5 flex justify-between text-[10px] text-foreground/50">
            <span>{p.label}</span><span className="tabular-nums">{v}</span>
          </div>
          <input type="range" min={p.min ?? 0} max={p.max ?? 100} value={v}
            onChange={e => setValue(p.key, Number(e.target.value))} className="w-full accent-cyan-500" />
        </div>
      );
    }
    // text / number 默认
    return (
      <div key={p.key} className="mb-2">
        <span className="mb-1 block text-[10px] text-foreground/50">{p.label}</span>
        <input type={p.type === "number" ? "number" : "text"} className={inputCls}
          value={String(values[p.key] ?? "")} onChange={e => setValue(p.key, p.type === "number" ? Number(e.target.value) : e.target.value)} />
      </div>
    );
  };

  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5">
        <select value={selectedId} onChange={e => selectDef(e.target.value)} className={`${inputCls} flex-1`}>
          {defs.length === 0 && <option value="">（去管理区添加 API）</option>}
          {defs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <Link href="/api-config" title="AI API 管理"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border text-[11px] text-foreground/60 transition hover:border-foreground/30 hover:text-foreground">⚙</Link>
      </div>

      {defs.length === 0 && (
        <p className="text-[10px] text-foreground/40">点 ⚙ 到「AI API 管理」配置你的 AI 应用（如 RunningHub 的「OSM简单洗图」）。</p>
      )}

      {def && (
        <div>
          {def.description && <p className="mb-2 text-[10px] text-foreground/40">{def.description}</p>}
          {def.params.map(renderParam)}
          <button onClick={run} disabled={running}
            className="w-full rounded-md border border-foreground/30 bg-foreground/10 py-1.5 text-[11px] text-foreground transition hover:bg-foreground/15 disabled:cursor-not-allowed disabled:opacity-40">
            {running ? "运行中…" : "▶ 运行"}
          </button>
          {progress && <p className="mt-2 text-[10px] text-cyan-500/80">{progress}</p>}
          {error && <p className="mt-2 text-[10px] text-red-400">{error}</p>}
        </div>
      )}
    </div>
  );
}
