import type { Metadata } from "next";
import { Suspense } from "react";
import WorkbenchClient from "./client";

const PROJECTS: Record<string, { title: string; img: string }> = {
  ink: { title: "水墨山水海报", img: "/presets/ink.png" },
  cyber: { title: "赛博城市概念图", img: "/presets/cyber.png" },
  gold: { title: "鎏金浮雕纹理", img: "/presets/gold.png" },
  aurora: { title: "极光壁纸系列", img: "/presets/aurora.png" },
  lava: { title: "熔岩地形概念", img: "/presets/lava.png" },
  ocean: { title: "深海生物插画", img: "/presets/ocean.png" },
};

export function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return params.then(({ id }) => ({ title: (PROJECTS[id]?.title ?? "项目") + " · 孔雀翎" }));
}

function WorkbenchView({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense>
      <Inner params={params} />
    </Suspense>
  );
}

async function Inner({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = PROJECTS[id] ?? { title: "项目", img: "/presets/ink.png" };
  return <WorkbenchClient id={id} title={p.title} cover={p.img} />;
}

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  return <WorkbenchView params={params} />;
}
