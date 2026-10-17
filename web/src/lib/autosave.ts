// 项目自动保存（localStorage，零后端）
// 每次编辑后把图层状态持久化，刷新/重开可恢复。
// localStorage 上限 ~5MB，大图 dataUrl 可能超限 → 逐级压缩 image 再试。
import type { Layer } from "@/workbench/types";

const PREFIX = "malachite:project:";

export interface ProjectState {
  layers: Layer[];
  docSize: { w: number; h: number };
  activeLayer: string;
  savedAt: number;
}

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

// 图片 dataUrl 缩到最长边 maxSide（保持 PNG 透明），用于超限降级
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

async function shrinkLayers(layers: Layer[], maxSide: number): Promise<Layer[]> {
  const out: Layer[] = [];
  for (const l of layers) {
    const shapes = [];
    for (const s of l.shapes) {
      // 只压大体积图片（>200KB），小图和矢量形状原样保留
      if (s.kind === "image" && s.src.startsWith("data:") && s.src.length > 200_000) {
        shapes.push({ ...s, src: await shrinkDataUrl(s.src, maxSide) });
      } else {
        shapes.push(s);
      }
    }
    out.push({ ...l, shapes });
  }
  return out;
}

// 返回 true=成功保存；false=空间不足且降级也失败
export async function saveProjectState(id: string, state: Omit<ProjectState, "savedAt">): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const build = (layers: Layer[]) => JSON.stringify({ ...state, layers, savedAt: Date.now() });
  try {
    localStorage.setItem(PREFIX + id, build(state.layers));
    return true;
  } catch {
    // 超限：逐级压缩大图（1024 → 768 → 512）
    for (const side of [1024, 768, 512]) {
      try {
        const shrunk = await shrinkLayers(state.layers, side);
        localStorage.setItem(PREFIX + id, build(shrunk));
        return true;
      } catch {
        // 继续降级
      }
    }
    return false;
  }
}
