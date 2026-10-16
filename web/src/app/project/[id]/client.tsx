"use client";

import dynamic from "next/dynamic";

const Workbench = dynamic(() => import("@/workbench/Workbench"), { ssr: false });

export default function WorkbenchClient({ id, title, cover }: { id: string; title: string; cover: string }) {
  return <Workbench id={id} title={title} cover={cover} />;
}
