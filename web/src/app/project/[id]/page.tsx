import Image from "next/image";
import Link from "next/link";

const PROJECTS: Record<string, { title: string; img: string }> = {
  ink: { title: "水墨山水海报", img: "/presets/ink.png" },
  cyber: { title: "赛博城市概念图", img: "/presets/cyber.png" },
  gold: { title: "鎏金浮雕纹理", img: "/presets/gold.png" },
  aurora: { title: "极光壁纸系列", img: "/presets/aurora.png" },
  lava: { title: "熔岩地形概念", img: "/presets/lava.png" },
  ocean: { title: "深海生物插画", img: "/presets/ocean.png" },
};

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = PROJECTS[id] ?? { title: "项目", img: "/presets/ink.png" };

  return (
    <main className="relative min-h-screen overflow-hidden bg-background">
      <div className="relative z-10 mx-auto flex h-full max-w-5xl flex-col px-6 py-8">
        {/* 顶栏 */}
        <header className="mb-6 flex items-center gap-3">
          <Link
            href="/projects"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-sm text-foreground/60 transition hover:border-foreground/30 hover:text-foreground"
          >
            ←
          </Link>
          <h1 className="text-base font-medium text-foreground/90">{p.title}</h1>
        </header>

        {/* 画布占位（工作台待做）*/}
        <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border bg-card/30">
          <div className="text-center">
            <Image
              src={p.img}
              alt={p.title}
              width={480}
              height={360}
              className="mx-auto mb-4 rounded-lg opacity-40"
            />
            <p className="text-sm text-foreground/50">工作台 · step timeline 画布（待做）</p>
          </div>
        </div>
      </div>
    </main>
  );
}
