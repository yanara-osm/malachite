// AI API 定义 + 存储（localStorage，零后端）
// 关键安全约定：API Key 由用户在运行时输入，只存本机 localStorage，绝不硬编码/进 git。

// 协议类型：RunningHub AI App 为第一个适配器，generic-rest 为通用扩展位
export type ApiProtocol = "runninghub-ai-app" | "generic-rest";

// 输入参数类型
export type ApiParamType = "text" | "textarea" | "number" | "slider" | "select" | "boolean" | "image";

// 单个输入参数定义
export interface ApiParam {
  key: string;      // 参数唯一 key
  label: string;    // 显示名
  type: ApiParamType;
  required: boolean;
  default?: string | number | boolean;
  options?: string[];  // select 用（逗号分隔或数组）
  min?: number;        // number/slider 用
  max?: number;
  // RunningHub nodeInfoList 映射（用户填「输入参数的搭配」）
  nodeId?: string;    // RH 节点 ID
  fieldName?: string; // RH 字段名
}

// 一个 API 定义
export interface ApiDef {
  id: string;
  name: string;          // 命名
  description: string;   // 功能
  protocol: ApiProtocol;
  // RunningHub AI App 配置
  webappId?: string;
  // 通用 REST 配置（预留）
  endpoint?: string;
  method?: "POST" | "GET";
  params: ApiParam[];
  outputType: "image" | "text";  // 结果类型
}

const API_DEFS_KEY = "malachite:apidefs";
const API_KEY_KEY = "malachite:apikey";

export function getApiDefs(): ApiDef[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(API_DEFS_KEY) || "[]"); } catch { return []; }
}

export function saveApiDef(def: ApiDef): ApiDef[] {
  const all = getApiDefs();
  const i = all.findIndex(d => d.id === def.id);
  if (i >= 0) all[i] = def; else all.push(def);
  localStorage.setItem(API_DEFS_KEY, JSON.stringify(all));
  return all;
}

export function deleteApiDef(id: string): ApiDef[] {
  const all = getApiDefs().filter(d => d.id !== id);
  localStorage.setItem(API_DEFS_KEY, JSON.stringify(all));
  return all;
}

// RunningHub API Key（运行时输入，本地自用；开源版绝不进代码/git）
export function getApiKey(): string {
  if (typeof window === "undefined") return "";
  try { return localStorage.getItem(API_KEY_KEY) || ""; } catch { return ""; }
}

export function setApiKey(key: string): void {
  localStorage.setItem(API_KEY_KEY, key);
}

export function newApiId(): string {
  return "api_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
