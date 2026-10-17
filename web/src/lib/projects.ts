// 拖拽新建项目的本地存储（零后端，localStorage）
export interface DragProject {
  id: string;
  title: string;
  img: string; // dataURL
  time: string;
  steps: number;
}

const KEY = "malachite:dragprojects";
// 历史 bug：旧 key 名曾被生成为省略号占位符，读到旧数据时迁移到新 key
const LEGACY_KEY = "malachi...ects";

export function getDragProjects(): DragProject[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY_KEY);
    if (raw && localStorage.getItem(KEY) === null) {
      // 迁移旧 key → 新 key
      localStorage.setItem(KEY, raw);
      localStorage.removeItem(LEGACY_KEY);
    }
    return JSON.parse(raw || "[]");
  } catch {
    return [];
  }
}

export function saveDragProject(p: DragProject): DragProject[] {
  const all = [p, ...getDragProjects()];
  // 上限 12 个，防 localStorage 爆
  const capped = all.slice(0, 12);
  try {
    localStorage.setItem(KEY, JSON.stringify(capped));
  } catch {
    // 空间不足：丢最旧的再试一次
    const smaller = capped.slice(0, 8);
    try { localStorage.setItem(KEY, JSON.stringify(smaller)); } catch { /* give up */ }
  }
  return getDragProjects();
}

export function findDragProject(id: string): DragProject | null {
  return getDragProjects().find(p => p.id === id) ?? null;
}

// 图片 File → 缩放 dataURL（最长边 maxSide，PNG 保透明）
export function fileToDataUrl(file: File, maxSide = 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = reject;
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d")!.drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL("image/png"));
      };
      img.onerror = reject;
      img.src = fr.result as string;
    };
    fr.readAsDataURL(file);
  });
}
