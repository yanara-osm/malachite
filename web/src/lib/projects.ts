// 拖拽新建项目存储：原图（不压缩）进 IndexedDB，localStorage 只留元数据+列表缩略图，
// 从此「拖入项目」不再被 5MB 上限逼着压到 1024。
import { idbSet, idbGet } from "./idb";

export interface DragProject {
  id: string;
  title: string;
  img: string; // 列表缩略图 dataURL（≤512，JPEg/PNG）
  time: string;
  steps: number;
  docSize?: { w: number; h: number }; // 空白画布的自定义尺寸（PS 式新建）
}

const KEY = "malachite:dragprojects";
// 历史 bug：旧 key 名曾被生成为省略号占位符，读到旧数据时迁移到新 key
const LEGACY_KEY = "malachi...ects";

export function getDragProjects(): DragProject[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY_KEY);
    if (raw && localStorage.getItem(KEY) === null) {
      localStorage.setItem(KEY, raw);
      localStorage.removeItem(LEGACY_KEY);
    }
    return JSON.parse(raw || "[]");
  } catch {
    return [];
  }
}

// 保存项目：元数据+缩略图进 localStorage；原图（full，若有）进 IndexedDB
export async function saveDragProject(p: DragProject, full?: string): Promise<DragProject[]> {
  if (full) {
    try { await idbSet(`full:${p.id}`, full); } catch { /* IDB 写不进：缩略图兜底 */ }
  }
  const all = [p, ...getDragProjects()];
  const capped = all.slice(0, 12);
  try {
    localStorage.setItem(KEY, JSON.stringify(capped));
  } catch {
    const smaller = capped.slice(0, 8);
    try { localStorage.setItem(KEY, JSON.stringify(smaller)); } catch { /* give up */ }
  }
  return getDragProjects();
}

export function findDragProject(id: string): DragProject | null {
  return getDragProjects().find(p => p.id === id) ?? null;
}

// 进画布用的原图：IDB 优先；读不到（旧项目）回落列表缩略图
export async function getProjectFullImage(id: string): Promise<string | null> {
  try {
    const full = await idbGet(`full:${id}`);
    if (full) return full;
  } catch { /* fallthrough */ }
  return findDragProject(id)?.img || null;
}

// 原尺寸 dataURL（maxSide=0 默认不缩放；canvas 中转烘焙 EXIF）。超大原图转 JPEG 防爆内存。
export function fileToDataUrl(file: File, maxSide = 0): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = reject;
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        try {
          const scale = maxSide > 0 ? Math.min(1, maxSide / Math.max(img.width, img.height)) : 1;
          const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
          const c = document.createElement("canvas");
          c.width = w; c.height = h;
          const ctx = c.getContext("2d")!;
          ctx.drawImage(img, 0, 0, w, h);
          // 画布过大或原文件是 JPEG（无透明）→ JPEG 编码省一半体积；否则 PNG 保透明
          const opaque = /jpe?g/i.test(file.type);
          resolve(w * h > 4_000_000 || opaque ? c.toDataURL("image/jpeg", 0.92) : c.toDataURL("image/png"));
        } catch (e) { reject(e); }
      };
      img.onerror = reject;
      img.src = fr.result as string;
    };
    fr.readAsDataURL(file);
  });
}

// 列表缩略图（最长边 512）
export async function fileToThumb(file: File): Promise<string> {
  return fileToDataUrl(file, 512);
}
