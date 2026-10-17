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
  shapes: ShapeNode[];
}

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
