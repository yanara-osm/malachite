export type ShapeNode =
  | { kind: "rect"; x: number; y: number; w: number; h: number; fill: string; opacity: number; cornerRadius: number }
  | { kind: "line"; points: number[]; stroke: string; strokeWidth: number; opacity: number; tension: number; composite: string }
  | { kind: "image"; x: number; y: number; w: number; h: number; src: string; opacity: number }
  | { kind: "text"; x: number; y: number; text: string; fontSize: number; fill: string; opacity: number; stroke?: string; strokeWidth?: number };

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  blendMode?: BlendMode;
  adjust?: ColorAdjust;
  shapes: ShapeNode[];
}

export type BlendMode =
  | "normal" | "multiply" | "screen" | "overlay" | "darken" | "lighten"
  | "color-dodge" | "color-burn" | "soft-light" | "hard-light" | "difference" | "exclusion"
  | "hue" | "saturation" | "color" | "luminosity";

export interface ColorAdjust {
  temperature: number; // 色温 -100 ~ 100（蓝-黄）
  tint: number;        // 色调 -100 ~ 100（绿-品红，白平衡第二轴）
  exposure: number;    // 曝光 -100 ~ 100
  contrast: number;    // 对比度 -100 ~ 100
  highlights: number;  // 高光 -100 ~ 100
  shadows: number;     // 阴影 -100 ~ 100
  whites: number;      // 白色色阶 -100 ~ 100
  blacks: number;      // 黑色色阶 -100 ~ 100
  hue: number;         // 色相 -180 ~ 180
  saturation: number;  // 饱和度 -100 ~ 100
  vibrance: number;    // 自然饱和度 -100 ~ 100
}

export const DEFAULT_ADJUST: ColorAdjust = {
  temperature: 0, tint: 0, exposure: 0, contrast: 0,
  highlights: 0, shadows: 0, whites: 0, blacks: 0,
  hue: 0, saturation: 0, vibrance: 0,
};

// 调色面板的滑块定义（顺序 = UI 顺序，模仿 Camera Raw 基础面板）
export const ADJUST_FIELDS: { key: keyof ColorAdjust; label: string; min: number; max: number }[] = [
  { key: "temperature", label: "色温", min: -100, max: 100 },
  { key: "tint", label: "色调", min: -100, max: 100 },
  { key: "exposure", label: "曝光", min: -100, max: 100 },
  { key: "contrast", label: "对比度", min: -100, max: 100 },
  { key: "highlights", label: "高光", min: -100, max: 100 },
  { key: "shadows", label: "阴影", min: -100, max: 100 },
  { key: "whites", label: "白色", min: -100, max: 100 },
  { key: "blacks", label: "黑色", min: -100, max: 100 },
  { key: "hue", label: "色相", min: -180, max: 180 },
  { key: "saturation", label: "饱和度", min: -100, max: 100 },
  { key: "vibrance", label: "自然饱和度", min: -100, max: 100 },
];

// 混合模式 → canvas globalCompositeOperation（normal 在 canvas 里是 source-over）
export const BLEND_TO_COMPOSITE: Record<BlendMode, GlobalCompositeOperation> = {
  normal: "source-over", multiply: "multiply", screen: "screen", overlay: "overlay",
  darken: "darken", lighten: "lighten", "color-dodge": "color-dodge", "color-burn": "color-burn",
  "soft-light": "soft-light", "hard-light": "hard-light", difference: "difference",
  exclusion: "exclusion", hue: "hue", saturation: "saturation", color: "color", luminosity: "luminosity",
};

// 混合模式下拉（模仿 PS 混合模式菜单的中文名）
export const BLEND_MODES: { value: BlendMode; label: string }[] = [
  { value: "normal", label: "正常" },
  { value: "multiply", label: "正片叠底" },
  { value: "screen", label: "滤色" },
  { value: "overlay", label: "叠加" },
  { value: "darken", label: "变暗" },
  { value: "lighten", label: "变亮" },
  { value: "color-dodge", label: "颜色减淡" },
  { value: "color-burn", label: "颜色加深" },
  { value: "soft-light", label: "柔光" },
  { value: "hard-light", label: "强光" },
  { value: "difference", label: "差值" },
  { value: "exclusion", label: "排除" },
  { value: "hue", label: "色相" },
  { value: "saturation", label: "饱和度" },
  { value: "color", label: "颜色" },
  { value: "luminosity", label: "明度" },
];

export type Tool = "move" | "brush" | "eraser" | "fill" | "text" | "wand" | "lasso" | "rect" | "ellipse" | "sam";

export interface StepEntry {
  id: string;
  label: string;
  by: "AI" | "你";
  status: "pending" | "accepted" | "rejected";
  time: string;
}

export const DOC_W = 1920;
export const DOC_H = 1080;
