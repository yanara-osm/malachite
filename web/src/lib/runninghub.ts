// RunningHub AI App 适配器：上传文件 → 提交任务 → 轮询结果
// 协议（已从 RunningHub API 文档确认）：
//   上传   POST /task/openapi/upload          form: apiKey, fileType=input, file
//   提交   POST /task/openapi/ai-app/run      json: { webappId, apiKey, nodeInfoList }
//   查询   POST /task/openapi/outputs         json: { apiKey, taskId }
// CORS：Electron 环境走主进程代理（window.rhProxy），浏览器环境直接 fetch。
import type { ApiDef, ApiParamType } from "./apis";

const RH_HOST = "https://www.runninghub.cn";

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length);
  const arr = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

function bytesToB64(arr: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin);
}

async function blobToB64(blob: Blob): Promise<string> {
  return bytesToB64(new Uint8Array(await blob.arrayBuffer()));
}

interface RhResp {
  status: number;
  json: () => Promise<any>;
  bytes: () => Promise<Uint8Array>;
}

// 统一请求：Electron 走主进程代理（绕过 CORS），浏览器直接 fetch
async function rhRequest(opts: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  json?: unknown;
  form?: { fileData: string; fileType: string; fileName: string; apiKey: string };
}): Promise<RhResp> {
  const proxy = typeof window !== "undefined" ? (window as any).rhProxy : undefined;
  if (proxy) {
    const res = await proxy.request({
      url: opts.url,
      method: opts.method || "POST",
      headers: opts.headers || {},
      body: opts.json ? JSON.stringify(opts.json) : undefined,
      form: opts.form ? {
        file: { data: opts.form.fileData, type: opts.form.fileType, name: opts.form.fileName },
        fileType: "input",
        apiKey: opts.form.apiKey,
      } : undefined,
      apiKey: opts.form?.apiKey,
    });
    if (res?.error) throw new Error(res.error);
    const bytes = b64ToBytes(res.body || "");
    return {
      status: res.status,
      json: async () => JSON.parse(new TextDecoder().decode(bytes)),
      bytes: async () => bytes,
    };
  }
  // 浏览器直连
  const init: RequestInit = { method: opts.method || "POST", headers: { ...(opts.headers || {}) } };
  if (opts.json) {
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
    init.body = JSON.stringify(opts.json);
  }
  if (opts.form) {
    const fd = new FormData();
    fd.append("apiKey", opts.form.apiKey);
    fd.append("fileType", "input");
    fd.append("file", new Blob([b64ToBytes(opts.form.fileData)], { type: opts.form.fileType }), opts.form.fileName);
    init.body = fd;
    delete (init.headers as Record<string, string>)["Content-Type"];
  }
  const res = await fetch(opts.url, init);
  return {
    status: res.status,
    json: () => res.json(),
    bytes: async () => new Uint8Array(await res.arrayBuffer()),
  };
}

export interface RhUploadResult {
  fileName: string;
  fileType: string;
  downloadUrl: string;
}

// 上传图片/文件 → fileName（nodeInfoList 的 fieldValue 用）
export async function rhUpload(file: Blob, apiKey: string): Promise<RhUploadResult> {
  const fileData = await blobToB64(file);
  const res = await rhRequest({
    url: `${RH_HOST}/task/openapi/upload`,
    form: { fileData, fileType: "image/png", fileName: "image.png", apiKey },
  });
  const json: any = await res.json();
  if (json.code !== 0) throw new Error(`上传失败: ${json.msg || json.code}`);
  return { fileName: json.data.fileName, fileType: json.data.fileType, downloadUrl: json.data.download_url };
}

// 提交任务 → taskId
export async function rhSubmit(webappId: string, apiKey: string, nodeInfoList: unknown[]): Promise<string> {
  const res = await rhRequest({
    url: `${RH_HOST}/task/openapi/ai-app/run`,
    headers: { "Content-Type": "application/json" },
    json: { webappId, apiKey, nodeInfoList },
  });
  const json: any = await res.json();
  if (json.code !== 0) throw new Error(`提交失败: ${json.msg || json.code}`);
  const tips = json.data?.promptTips;
  if (tips) {
    try {
      const t = typeof tips === "string" ? JSON.parse(tips) : tips;
      if (t?.node_errors && Object.keys(t.node_errors).length > 0) {
        throw new Error(`节点错误: ${JSON.stringify(t.node_errors)}`);
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("节点错误")) throw e;
    }
  }
  return json.data.taskId;
}

// 查询结果：返回图片 URL 数组（空数组 = 还在排队/生成中）
export async function rhQuery(taskId: string, apiKey: string): Promise<string[]> {
  const res = await rhRequest({
    url: `${RH_HOST}/task/openapi/outputs`,
    headers: { "Content-Type": "application/json" },
    json: { apiKey, taskId },
  });
  const json: any = await res.json();
  if (json.code === 805) throw new Error("任务失败");
  if (json.code !== 0 || !Array.isArray(json.data) || json.data.length === 0) return [];
  return json.data.map((d: { fileUrl?: string }) => d.fileUrl).filter(Boolean) as string[];
}

// 下载结果图 → dataUrl（走代理，绕过 COS 的 CORS）
export async function rhDownloadAsDataUrl(url: string): Promise<string> {
  const res = await rhRequest({ url, method: "GET" });
  const bytes = await res.bytes();
  const type = url.toLowerCase().endsWith(".jpg") || url.toLowerCase().endsWith(".jpeg") ? "image/jpeg"
    : url.toLowerCase().endsWith(".webp") ? "image/webp" : "image/png";
  return `data:${type};base64,${bytesToB64(bytes)}`;
}

// 组装 nodeInfoList：把用户填的参数值映射到 RH 节点字段
export function buildNodeInfoList(
  def: ApiDef,
  values: Record<string, unknown>,
  uploadedImages: Record<string, string>,
): { nodeId: string; fieldName: string; fieldValue: unknown }[] {
  return def.params
    .filter((p) => p.nodeId && p.fieldName)
    .map((p) => {
      let fieldValue = values[p.key] ?? p.default ?? "";
      if (p.type === "image" && uploadedImages[p.key]) fieldValue = uploadedImages[p.key];
      if (p.type === "number" || p.type === "slider") fieldValue = Number(fieldValue);
      return { nodeId: p.nodeId as string, fieldName: p.fieldName as string, fieldValue };
    });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 完整流程：提交 → 轮询 → 图片 URL 数组
export async function rhRun(
  def: ApiDef,
  apiKey: string,
  nodeInfoList: unknown[],
  onProgress: (msg: string) => void,
  timeoutMs = 10 * 60 * 1000,
): Promise<string[]> {
  if (!def.webappId) throw new Error("缺少 webappId");
  onProgress("提交任务…");
  const taskId = await rhSubmit(def.webappId, apiKey, nodeInfoList);
  onProgress(`已提交，排队/生成中…`);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await sleep(3000);
    const urls = await rhQuery(taskId, apiKey);
    if (urls.length > 0) return urls;
    onProgress("生成中…");
  }
  throw new Error("超时：任务未在限定时间内完成");
}

// ============ 从 RunningHub 详情页自动拉取输入参数定义 ============

export interface RhParam {
  label: string;      // 中文显示名（description）
  key: string;        // 参数 key（fieldName）
  type: ApiParamType; // 控件类型：image / number / text
  nodeId: string;     // RH 节点 ID
  fieldName: string;  // RH 字段名
  default?: number;
  min?: number;
  max?: number;
}

// 解析 fieldData（形如 ["FLOAT", {"max":8,"min":0.01,"step":0.01,"default":1}] 或 image_upload 结构）
function parseFieldData(fd: string): { type?: string; constraints: Record<string, unknown> } {
  try {
    const unescaped = fd.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    const obj = JSON.parse(unescaped);
    if (Array.isArray(obj) && obj.length && typeof obj[0] === "string") {
      const c = obj[1] && typeof obj[1] === "object" ? obj[1] as Record<string, unknown> : {};
      return { type: obj[0], constraints: c };
    }
    if (Array.isArray(obj) && obj.length && Array.isArray(obj[0])) {
      const c = obj[1] && typeof obj[1] === "object" ? obj[1] as Record<string, unknown> : {};
      return { type: "IMAGE", constraints: c };
    }
  } catch { /* 忽略，尽力而为 */ }
  return { constraints: {} };
}

const fieldTypeToParamType = (t?: string): ApiParamType => {
  if (t === "IMAGE") return "image";
  if (t === "FLOAT" || t === "INT") return "number";
  return "text";
};

// RunningHub 用 uint64 极值（1.8e19）当"无约束"哨兵，过滤掉避免滑块坏掉
const clampNum = (n: unknown): number | undefined => {
  if (typeof n !== "number" || !isFinite(n) || Math.abs(n) > 1e15) return undefined;
  return n;
};

// 从 RunningHub 详情页 HTML（SSR __NUXT__ 数据）解析输入节点定义
export function parseRhAppParams(html: string): RhParam[] {
  const m = html.match(/\[\d+,\d+,\d+,\d+\][^{]*\{"nodeId":/);
  if (!m || m.index === undefined) return [];
  const seg = html.slice(m.index, m.index + 6000);

  const schemaStarts: number[] = [];
  const schemaRe = /\{"nodeId":\d+/g;
  let mm: RegExpExecArray | null;
  while ((mm = schemaRe.exec(seg)) !== null) schemaStarts.push(mm.index);

  const results: RhParam[] = [];
  let prevFieldName: string | undefined;

  for (let i = 0; i < schemaStarts.length; i++) {
    const ss = schemaStarts[i];
    const braceEnd = seg.indexOf("}", ss) + 1;
    const pIdx = seg.indexOf("<p>");
    const dataEnd = i + 1 < schemaStarts.length ? schemaStarts[i + 1] : (pIdx > 0 ? pIdx : seg.length);
    const dataSeg = seg.slice(braceEnd, dataEnd);
    const vals = [...dataSeg.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1]);
    if (vals.length < 2) continue;

    const nodeId = vals[0];
    const nodeName = vals[1];
    const third = vals[2];
    let fieldName: string;
    let rest: string[];
    if (third && /^[a-z_][a-z0-9_]*$/.test(third)) {
      fieldName = third;
      rest = vals.slice(3);
    } else {
      fieldName = prevFieldName || "value";
      rest = vals.slice(2);
    }

    const fieldData = rest.find((v) => v.startsWith("["));
    const description = rest.find((v) => /^[^\x00-\x7f]/.test(v));

    let fieldType: string | undefined;
    let constraints: Record<string, unknown> = {};
    if (fieldData) {
      const parsed = parseFieldData(fieldData);
      fieldType = parsed.type;
      constraints = parsed.constraints;
    }
    const explicitType = rest.find((v) => /^(IMAGE|FLOAT|INT|STRING|BOOLEAN|LIST)$/.test(v));
    if (explicitType) fieldType = explicitType;

    results.push({
      label: description || nodeName || nodeId,
      key: fieldName,
      type: fieldTypeToParamType(fieldType),
      nodeId,
      fieldName,
      default: clampNum(constraints.default),
      min: clampNum(constraints.min),
      max: clampNum(constraints.max),
    });
    prevFieldName = fieldName;
  }
  return results;
}

// 拉取：抓详情页 HTML → 解析参数（Electron 走代理，浏览器直连）
export async function fetchRhAppParams(webappId: string): Promise<RhParam[]> {
  const url = `https://www.runninghub.cn/ai-detail/${webappId}`;
  const proxy = typeof window !== "undefined" ? (window as any).rhProxy : undefined;
  if (proxy?.fetchHtml) {
    const res = await proxy.fetchHtml(url);
    if (!res?.ok) throw new Error(res?.error || "抓取详情页失败");
    return parseRhAppParams(res.text);
  }
  const html = await (await fetch(url)).text();
  return parseRhAppParams(html);
}
