// 项目自动保存：图层结构 + 小图留 localStorage（快、同步），
// 大图的 dataURL 卸到 IndexedDB（localStorage 只存 "idb:<key>" 引用），
// 从此不再有「超限就把图压到1024」——原图永远原尺寸。
import type { Layer } from "@/workbench/types";
import { idbSet, idbGet } from "./idb";

const PREFIX = "malachite:project:";
const IMG_PREFIX = "malachite:img:";
const OFFLOAD_AT = 100_000; // src 超 100KB 的图进 IDB

export interface ProjectState {
  layers: Layer[];
  docSize: { w: number; h: number };
  activeLayer: string;
  savedAt: number;
}

// 同步读（结构立即可用）；大图 src 为 "idb:…" 引用，需 hydrateProjectState 异步补全
export function loadProjectState(id: string): ProjectState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(PREFIX + id);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!Array.isArray(s.layers) || s.layers.length === 0) return null;
    return s as ProjectState;
  } catch {
    return null;
  }
}

// 把所有 "idb:…" 引用换成真实 dataURL（渲染前补全）
export async function hydrateProjectState(state: ProjectState): Promise<ProjectState> {
  const layers: Layer[] = [];
  for (const l of state.layers) {
    const shapes = [];
    for (const s of l.shapes) {
      if (s.kind === "image" && typeof s.src === "string" && s.src.startsWith("idb:")) {
        try {
          const real = await idbGet(IMG_PREFIX + s.src.slice(4));
          shapes.push({ ...s, src: real ?? "" });
        } catch { shapes.push({ ...s, src: "" }); }
      } else {
        shapes.push(s);
      }
    }
    layers.push({ ...l, shapes });
  }
  return { ...state, layers };
}

// 返回 true=成功保存；false=连降级都失败（真·存储满）
export async function saveProjectState(id: string, state: Omit<ProjectState, "savedAt">): Promise<boolean> {
  if (typeof window === "undefined") return false;
  // 1) 大图卸到 IDB，localStorage 里只留引用
  let layers = state.layers;
  try {
    const offloaded: Layer[] = [];
    for (const l of state.layers) {
      const shapes = [];
      let li = 0;
      for (const s of l.shapes) {
        if (s.kind === "image" && typeof s.src === "string" && s.src.length > OFFLOAD_AT) {
          const key = `${id}/${l.id}/${li}`;
          await idbSet(IMG_PREFIX + key, s.src);
          shapes.push({ ...s, src: "idb:" + key });
        } else {
          shapes.push(s);
        }
        li++;
      }
      offloaded.push({ ...l, shapes });
    }
    layers = offloaded;
  } catch { /* IDB 写失败：退回原样直存 localStorage */ }

  const build = (ls: Layer[]) => JSON.stringify({ ...state, layers: ls, savedAt: Date.now() });
  try {
    localStorage.setItem(PREFIX + id, build(layers));
    return true;
  } catch {
    // 极端情况（IDB 挂了 + 图巨大）：逐级压缩兜底，宁可糊不可丢
    for (const side of [1024, 768, 512]) {
      try {
        const shrunk = await shrinkLayers(layers, side);
        localStorage.setItem(PREFIX + id, build(shrunk));
        return true;
      } catch { /* 继续降级 */ }
    }
    return false;
  }
}

// 超限降级：缩图（仅 IDB 也救不了时才会走到）
async function shrinkLayers(layers: Layer[], maxSide: number): Promise<Layer[]> {
  const out: Layer[] = [];
  for (const l of layers) {
    const shapes = [];
    for (const s of l.shapes) {
      if (s.kind === "image" && typeof s.src === "string" && s.src.startsWith("data:") && s.src.length > 200_000) {
        shapes.push({ ...s, src: await shrinkDataUrl(s.src, maxSide) });
      } else {
        shapes.push(s);
      }
    }
    out.push({ ...l, shapes });
  }
  return out;
}

function shrinkDataUrl(src: string, maxSide: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d")!.drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL("image/png"));
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = reject;
    img.src = src;
  });
}
