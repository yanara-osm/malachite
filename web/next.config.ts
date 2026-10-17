import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* 静态导出：纯前端应用，Electron 壳 serve out/ 目录 */
  output: "export",
  images: { unoptimized: true },
  async headers() {
    // dev 模式（next dev）下需要 COOP/COEP 让 onnxruntime-web 的 WebGPU/多线程 wasm 可用
    // 静态导出后由 Electron 的本地 http server 设置同样的头
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
        ],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
