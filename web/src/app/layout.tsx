import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "孔雀翎 Malachite — 智能体画布",
  description: "智能体做你的美术，你负责修改与审查。OSM 开源电影厂牌。",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className="dark h-full antialiased">
      <body className="min-h-full flex flex-col bg-background text-foreground font-sans">
        {children}
      </body>
    </html>
  );
}
