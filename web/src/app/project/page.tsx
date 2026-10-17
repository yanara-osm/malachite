"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { findDragProject } from "@/lib/projects";

const Workbench = dynamic(() => import("@/workbench/Workbench"), { ssr: false });

const PRESETS: Record<string, { title: string; img: string }> = {
  ink: { title: "水墨山水海报", img: "/presets/ink.png" },
  cyber: { title: "赛博城市概念图", img: "/presets/cyber.png" },
  gold: { title: "鎏金浮雕纹理", img: "/presets/gold.png" },
  aurora: { title: "极光壁纸系列", img: "/presets/aurora.png" },
  lava: { title: "熔岩地形概念", img: "/presets/lava.png" },
  ocean: { title: "深海生物插画", img: "/presets/ocean.png" },
};

const LOADING = <div className="flex min-h-screen items-center justify-center bg-black text-sm text-white/40">载入项目…</div>;

function Inner() {
  const sp = useSearchParams();
  const id = sp.get("id") ?? "ink";
  const preset = PRESETS[id];
  // 拖入项目（d 前缀）：cover 在 localStorage，用占位先渲染再客户端补
  const [ready, setReady] = useState(!id.startsWith("d"));
  const [cover, setCover] = useState(preset?.img ?? "/presets/ink.png");
  const [title, setTitle] = useState(preset?.title ?? "项目");
  const [docSize, setDocSize] = useState<{ w: number; h: number } | undefined>(undefined);

  useEffect(() => {
    if (!id.startsWith("d")) return;
    const p = findDragProject(id);
    if (p) { setCover(p.img); setTitle(p.title); setDocSize(p.docSize); }
    setReady(true);
  }, [id]);

  if (!ready) return LOADING;
  return <Workbench id={id} title={title} cover={cover} docSize={docSize} />;
}

export default function ProjectPage() {
  return (
    <Suspense fallback={LOADING}>
      <Inner />
    </Suspense>
  );
}
