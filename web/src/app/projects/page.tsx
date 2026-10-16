"use client";

import Image from "next/image";
import Link from "next/link";

const PROJECTS = [
  { id: "ink", title: "水墨山水海报", time: "2 小时前", steps: 12, img: "/presets/ink.png" },
  { id: "cyber", title: "赛博城市概念图", time: "昨天", steps: 8, img: "/presets/cyber.png" },
  { id: "gold", title: "鎏金浮雕纹理", time: "3 天前", steps: 5, img: "/presets/gold.png" },
  { id: "aurora", title: "极光壁纸系列", time: "上周", steps: 14, img: "/presets/aurora.png" },
  { id: "lava", title: "熔岩地形概念", time: "上周", steps: 6, img: "/presets/lava.png" },
  { id: "ocean", title: "深海生物插画", time: "2 周前", steps: 22, img: "/presets/ocean.png" },
];

export default function ProjectPool() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-background">
      {/* 背景光（极淡，同 v4）*/}
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute -top-1/4 left-1/2 h-[50vh] w-[60vw] -translate-x-1/2 rounded-full opacity-20 blur-3xl"
          style={{ background: "radial-gradient(closest-side, oklch(0.6 0.16 210 / 0.4), transparent 72%)" }}
        />
      </div>

      <div className="relative z-10 mx-auto max-w-5xl px-6 py-10">
        {/* 顶栏 */}
        <header className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-sm text-foreground/60 transition hover:border-foreground/30 hover:text-foreground">
              ←
            </Link>
            <h1 className="text-lg font-medium text-foreground/90">项目</h1>
          </div>
          <Link
            href="/"
            className="rounded-full border border-border bg-card/60 px-4 py-1.5 text-xs text-foreground/70 backdrop-blur transition hover:border-foreground/25 hover:text-foreground"
          >
            + 新建项目
          </Link>
        </header>

        {/* 卡片池 */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {PROJECTS.map((p) => (
            <Link
              key={p.id}
              href={`/project/${p.id}`}
              className="group relative aspect-[4/3] overflow-hidden rounded-xl border border-border transition hover:border-foreground/20"
            >
              <Image
                src={p.img}
                alt={p.title}
                fill
                sizes="(max-width:640px) 50vw, 33vw"
                className="object-cover transition duration-500 ease-out group-hover:scale-105"
              />
              {/* scrim */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-black/5" />
              {/* 信息 */}
              <div className="absolute inset-x-0 bottom-0 p-3">
                <p className="text-sm font-medium text-white/95">{p.title}</p>
                <p className="mt-0.5 text-[11px] text-white/60">
                  {p.time} · {p.steps} 步
                </p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
