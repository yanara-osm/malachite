"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  getApiDefs, saveApiDef, deleteApiDef, getApiKey, setApiKey, newApiId,
  type ApiDef, type ApiParam, type ApiParamType,
} from "@/lib/apis";
import { fetchRhAppParams } from "@/lib/runninghub";

const PARAM_TYPES: { value: ApiParamType; label: string }[] = [
  { value: "text", label: "文本" },
  { value: "textarea", label: "多行文本" },
  { value: "number", label: "数字" },
  { value: "slider", label: "滑块" },
  { value: "select", label: "下拉" },
  { value: "boolean", label: "开关" },
  { value: "image", label: "图片" },
];

const OUTPUT_TYPES = [
  { value: "image", label: "图片" },
  { value: "text", label: "文本" },
];

function emptyParam(): ApiParam {
  return { key: "", label: "", type: "text", required: false, nodeId: "", fieldName: "" };
}

export default function ApiConfigPage() {
  const [apiKey, setKey] = useState("");
  const [defs, setDefs] = useState<ApiDef[]>([]);
  const [editing, setEditing] = useState<ApiDef | null>(null);
  const [keySaved, setKeySaved] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [pullMsg, setPullMsg] = useState("");

  useEffect(() => {
    setKey(getApiKey());
    setDefs(getApiDefs());
  }, []);

  const saveKey = () => {
    setApiKey(apiKey.trim());
    setKeySaved(true);
    setTimeout(() => setKeySaved(false), 1500);
  };

  const startNew = () => setEditing({
    id: newApiId(), name: "", description: "", protocol: "runninghub-ai-app",
    webappId: "", params: [emptyParam()], outputType: "image",
  });

  const startEdit = (d: ApiDef) => setEditing(JSON.parse(JSON.stringify(d)));

  const saveDef = () => {
    if (!editing || !editing.name.trim()) return;
    const cleaned: ApiDef = {
      ...editing,
      params: editing.params.filter(p => p.label.trim() && p.key.trim()),
    };
    saveApiDef(cleaned);
    setDefs(getApiDefs());
    setEditing(null);
  };

  const removeDef = (id: string) => {
    setDefs(deleteApiDef(id));
    if (editing?.id === id) setEditing(null);
  };

  const updateParam = (i: number, patch: Partial<ApiParam>) => {
    if (!editing) return;
    const params = editing.params.map((p, idx) => idx === i ? { ...p, ...patch } : p);
    setEditing({ ...editing, params });
  };

  const addParam = () => {
    if (!editing) return;
    setEditing({ ...editing, params: [...editing.params, emptyParam()] });
  };

  const removeParam = (i: number) => {
    if (!editing) return;
    setEditing({ ...editing, params: editing.params.filter((_, idx) => idx !== i) });
  };

  // 从 RunningHub 详情页自动拉取输入参数（nodeId/fieldName/类型/默认值）
  const pullParams = async () => {
    if (!editing || !editing.webappId?.trim()) { setPullMsg("先填 webappId"); return; }
    setPulling(true); setPullMsg("");
    try {
      const params = await fetchRhAppParams(editing.webappId.trim());
      if (!params.length) { setPullMsg("未解析到输入参数，请核对 webappId"); return; }
      setEditing({
        ...editing,
        params: params.map((p) => ({
          key: p.key, label: p.label, type: p.type,
          nodeId: p.nodeId, fieldName: p.fieldName,
          required: false, default: p.default, min: p.min, max: p.max,
        })),
      });
      setPullMsg(`已拉取 ${params.length} 个参数，可再微调`);
    } catch (e) {
      setPullMsg(e instanceof Error ? e.message : "拉取失败");
    } finally {
      setPulling(false);
    }
  };

  const input = "w-full rounded-md border border-border bg-card px-2 py-1.5 text-xs text-foreground/90 outline-none focus:border-foreground/30";
  const label = "mb-1 block text-[10px] text-foreground/50";

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-6 py-8">
        <header className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-xs text-foreground/60 transition hover:border-foreground/30 hover:text-foreground">←</Link>
            <h1 className="text-base font-medium text-foreground/90">AI API 管理</h1>
          </div>
        </header>

        {/* API Key（本机自用，不进代码/git） */}
        <section className="mb-6 rounded-xl border border-border bg-card/40 p-4">
          <p className="mb-1 text-[10px] tracking-widest text-foreground/40">RUNNINGHUB API KEY</p>
          <p className="mb-3 text-[11px] text-foreground/50">只存本机浏览器，绝不提交到代码仓库。开源版使用者在这里填自己的 Key。</p>
          <div className="flex gap-2">
            <input type="password" value={apiKey} onChange={e => setKey(e.target.value)}
              placeholder="粘贴你的 RunningHub API Key"
              className="flex-1 rounded-md border border-border bg-card px-2 py-1.5 text-xs text-foreground/90 outline-none focus:border-foreground/30" />
            <button onClick={saveKey}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground/70 transition hover:bg-secondary hover:text-foreground">
              {keySaved ? "已保存 ✓" : "保存"}
            </button>
          </div>
        </section>

        {/* API 列表 */}
        <section className="mb-6">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[10px] tracking-widest text-foreground/40">已配置的 API</p>
            <button onClick={startNew}
              className="rounded-md border border-border px-2 py-1 text-[11px] text-foreground/70 transition hover:bg-secondary hover:text-foreground">＋ 新建 API</button>
          </div>
          {defs.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-4 text-center text-[11px] text-foreground/40">
              还没有 API。点「＋ 新建 API」添加（例如你的「OSM简单洗图」）。
            </div>
          ) : (
            <div className="space-y-1.5">
              {defs.map(d => (
                <div key={d.id} className="flex items-center gap-2 rounded-lg border border-border bg-card/40 px-3 py-2">
                  <div className="flex-1">
                    <p className="text-xs text-foreground/90">{d.name}</p>
                    <p className="text-[10px] text-foreground/40">{d.description || d.protocol}</p>
                  </div>
                  <button onClick={() => startEdit(d)} className="rounded-md border border-border px-2 py-0.5 text-[11px] text-foreground/60 hover:bg-secondary hover:text-foreground">编辑</button>
                  <button onClick={() => removeDef(d.id)} className="px-1 text-[11px] text-foreground/40 hover:text-red-400">✕</button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 编辑表单 */}
        {editing && (
          <section className="rounded-xl border border-border bg-card/40 p-4">
            <p className="mb-3 text-[10px] tracking-widest text-foreground/40">{defs.some(d => d.id === editing.id) ? "编辑 API" : "新建 API"}</p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>命名 *</label>
                <input className={input} value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder="如 OSM简单洗图" />
              </div>
              <div>
                <label className={label}>功能说明</label>
                <input className={input} value={editing.description} onChange={e => setEditing({ ...editing, description: e.target.value })} placeholder="如 精修·图生图" />
              </div>
              <div>
                <label className={label}>协议</label>
                <select className={input} value={editing.protocol} onChange={e => setEditing({ ...editing, protocol: e.target.value as ApiDef["protocol"] })}>
                  <option value="runninghub-ai-app">RunningHub AI App</option>
                  <option value="generic-rest">通用 REST（预留）</option>
                </select>
              </div>
              {editing.protocol === "runninghub-ai-app" ? (
                <div>
                  <label className={label}>webappId *</label>
                  <div className="flex gap-1.5">
                    <input className={input} value={editing.webappId ?? ""} onChange={e => setEditing({ ...editing, webappId: e.target.value })} placeholder="从 ai-detail 链接末尾取" />
                    <button onClick={pullParams} disabled={pulling}
                      className="shrink-0 rounded-md border border-border px-2 py-1.5 text-[11px] text-foreground/70 transition hover:bg-secondary hover:text-foreground disabled:opacity-50">
                      {pulling ? "拉取中…" : "拉取参数"}
                    </button>
                  </div>
                  {pullMsg && <p className="mt-1 text-[10px] text-foreground/50">{pullMsg}</p>}
                </div>
              ) : (
                <div>
                  <label className={label}>接口地址</label>
                  <input className={input} value={editing.endpoint ?? ""} onChange={e => setEditing({ ...editing, endpoint: e.target.value })} placeholder="https://..." />
                </div>
              )}
              <div>
                <label className={label}>结果类型</label>
                <select className={input} value={editing.outputType} onChange={e => setEditing({ ...editing, outputType: e.target.value as ApiDef["outputType"] })}>
                  {OUTPUT_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>

            {/* 参数列表 */}
            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[10px] tracking-widest text-foreground/40">输入参数（搭配）</p>
                <button onClick={addParam} className="rounded-md border border-border px-2 py-0.5 text-[11px] text-foreground/60 hover:bg-secondary hover:text-foreground">＋ 加参数</button>
              </div>
              <div className="space-y-2">
                {editing.params.map((p, i) => (
                  <div key={i} className="rounded-lg border border-border/60 bg-background/40 p-3">
                    <div className="mb-2 grid grid-cols-3 gap-2">
                      <div>
                        <label className={label}>显示名 *</label>
                        <input className={input} value={p.label} onChange={e => updateParam(i, { label: e.target.value, key: p.key || e.target.value })} placeholder="如 原始图" />
                      </div>
                      <div>
                        <label className={label}>参数 key</label>
                        <input className={input} value={p.key} onChange={e => updateParam(i, { key: e.target.value })} placeholder="如 image" />
                      </div>
                      <div>
                        <label className={label}>类型</label>
                        <select className={input} value={p.type} onChange={e => updateParam(i, { type: e.target.value as ApiParamType })}>
                          {PARAM_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className={label}>nodeId（RH 节点）</label>
                        <input className={input} value={p.nodeId ?? ""} onChange={e => updateParam(i, { nodeId: e.target.value })} placeholder="如 6" />
                      </div>
                      <div>
                        <label className={label}>fieldName（RH 字段）</label>
                        <input className={input} value={p.fieldName ?? ""} onChange={e => updateParam(i, { fieldName: e.target.value })} placeholder="如 text" />
                      </div>
                      <div>
                        <label className={label}>默认值</label>
                        <input className={input} value={p.default == null ? "" : String(p.default)} onChange={e => updateParam(i, { default: e.target.value })} />
                      </div>
                    </div>
                    {(p.type === "number" || p.type === "slider") && (
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <div>
                          <label className={label}>最小值</label>
                          <input type="number" className={input} value={p.min ?? ""} onChange={e => updateParam(i, { min: Number(e.target.value) })} />
                        </div>
                        <div>
                          <label className={label}>最大值</label>
                          <input type="number" className={input} value={p.max ?? ""} onChange={e => updateParam(i, { max: Number(e.target.value) })} />
                        </div>
                      </div>
                    )}
                    {p.type === "select" && (
                      <div className="mt-2">
                        <label className={label}>选项（逗号分隔）</label>
                        <input className={input} value={(p.options ?? []).join(",")} onChange={e => updateParam(i, { options: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })} placeholder="如 模型A,模型B" />
                      </div>
                    )}
                    <div className="mt-2 flex items-center justify-between">
                      <label className="flex items-center gap-1.5 text-[10px] text-foreground/50">
                        <input type="checkbox" checked={p.required} onChange={e => updateParam(i, { required: e.target.checked })} />
                        必填
                      </label>
                      <button onClick={() => removeParam(i)} className="px-1 text-[11px] text-foreground/40 hover:text-red-400">删除参数</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              <button onClick={saveDef}
                className="rounded-md border border-foreground/30 bg-foreground/10 px-4 py-1.5 text-xs text-foreground transition hover:bg-foreground/15">
                保存
              </button>
              <button onClick={() => setEditing(null)}
                className="rounded-md border border-border px-4 py-1.5 text-xs text-foreground/60 transition hover:bg-secondary hover:text-foreground">
                取消
              </button>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
