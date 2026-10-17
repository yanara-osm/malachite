// 孔雀翎 · Malachite — Electron 壳
// 纯前端 Next.js 静态导出（out/）由本地 http server 提供，
// 必须设置 COOP/COEP/CORP 头，否则 onnxruntime-web 的 WebGPU/多线程 wasm 不可用
// （SharedArrayBuffer 需要 crossOriginIsolated，COEP require-corp 才开启）。
const { app, BrowserWindow } = require("electron");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

// 打包后在 resources/app/out，开发时 ../web/out
const OUT_DIR = fs.existsSync(path.join(__dirname, "out"))
  ? path.join(__dirname, "out")
  : path.join(__dirname, "..", "web", "out");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".onnx": "application/octet-stream",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};

const SECURITY_HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "same-origin",
};

function startServer() {
  const root = path.resolve(OUT_DIR);
  const server = http.createServer((req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    } catch {
      res.writeHead(400); res.end("Bad request"); return;
    }
    if (pathname === "/") pathname = "/index.html";

    let filePath = path.resolve(root, "." + pathname);
    // 防路径穿越
    if (!filePath.startsWith(root)) { res.writeHead(403); res.end(); return; }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        // 无扩展名 → 尝试 .html（Next.js 静态导出的 /project → project.html）
        if (!path.extname(pathname)) {
          const alt = path.resolve(root, "." + pathname + ".html");
          if (alt.startsWith(root)) {
            fs.readFile(alt, (e2, d2) => {
              if (e2) { res.writeHead(404); res.end("404"); return; }
              res.writeHead(200, { "Content-Type": MIME[".html"], ...SECURITY_HEADERS });
              res.end(d2);
            });
            return;
          }
        }
        res.writeHead(404); res.end("404"); return;
      }
      const ext = path.extname(pathname).toLowerCase();
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", ...SECURITY_HEADERS });
      res.end(data);
    });
  });
  return server;
}

let server;

app.whenReady().then(async () => {
  server = startServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  const win = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 1024,
    minHeight: 700,
    autoHideMenuBar: true,
    backgroundColor: "#0a0a0a",
    title: "孔雀翎 · Malachite",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadURL(`http://127.0.0.1:${port}/`);

  // 外链用系统浏览器打开（当前无外链，预留）
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(`http://127.0.0.1:${port}`)) {
      require("electron").shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("quit", () => {
  if (server) server.close();
});
