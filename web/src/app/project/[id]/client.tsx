"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { findDragProject } from "@/lib/projects";

const Workbench = dynamic(() => import("@/workbench/Workbench"), { ssr: false });

export default function WorkbenchClient({ id, title, cover }: { id: string; title: string; cover: string }) {
  // 拖入项目（d 前缀）：cover 在 localStorage，服务端给的是占位，客户端补
  const [ready, setReady] = useState(!id.startsWith("d"));
  const [finalCover, setFinalCover] = useState(cover);
  const [finalTitle, setFinalTitle] = useState(title);

  useEffect(() => {
    if (!id.startsWith("d")) return;
    const p = findDragProject(id);
    if (p) {
      setFinalCover(p.img);
      setFinalTitle(p.title);
    }
    setReady(true);
  }, [id]);

  if (!ready) {
    return <div className="flex min-h-screen items-center justify-center bg-black text-sm text-white/40">载入项目…</div>;
  }
  return <Workbench id={id} title={finalTitle} cover={finalCover} />;
}
