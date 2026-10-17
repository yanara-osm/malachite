import json, time, urllib.request, websocket

PORT = 9222

def tabs(): return json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/list", timeout=10))
def cdp(ws, m, p=None, mid=1):
    ws.send(json.dumps({"id": mid, "method": m, "params": p or {}}))
    while True:
        r = json.loads(ws.recv())
        if r.get("id") == mid: return r
def js(ws, e):
    r = cdp(ws, "Runtime.evaluate", {"expression": e, "returnByValue": True})
    return r.get("result", {}).get("result", {}).get("value")

tab = next(t for t in tabs() if t.get("type") == "page")
ws = websocket.create_connection(tab["webSocketDebuggerUrl"], timeout=60)

cdp(ws, "Page.navigate", {"url": "http://localhost:3000/project?id=ink"})
time.sleep(5)

# 1. 样式区 UI 存在？
print("样式区标题:", js(ws, "document.body.innerText.includes('样式')"))
print("不透明度:", js(ws, "document.body.innerText.includes('不透明度')"))
print("混合模式:", js(ws, "document.body.innerText.includes('混合模式')"))
print("调色标题:", js(ws, "document.body.innerText.includes('调色')"))
print("色温:", js(ws, "document.body.innerText.includes('色温')"))
print("自然饱和度:", js(ws, "document.body.innerText.includes('自然饱和度')"))
print("range 滑块数:", js(ws, "document.querySelectorAll('input[type=range]').length"))
print("混合模式选项数:", js(ws, "document.querySelectorAll('select option').length"))

# 2. 改色温滑块到 +100（第一个 range 是透明度，调色滑块在 select 之后）
r = js(ws, """(() => {
  const ranges = [...document.querySelectorAll('input[type=range]')];
  // 色温 = 第一个调色滑块 = 第 2 个 range（第 1 个是透明度）
  const temp = ranges[1];
  if (!temp) return 'no slider';
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(temp, '100');
  temp.dispatchEvent(new Event('input', { bubbles: true }));
  return 'set temp=100';
})()""")
print("设置色温:", r)
time.sleep(1)

# 3. 检查 localStorage 里的 adjust.temperature
save = js(ws, "JSON.parse(localStorage.getItem('malachite:project:ink') || '{}')")
layers = save.get("layers") if isinstance(save, dict) else None
# 找 activeLayer 的 adjust
print("layers 数:", len(layers) if layers else 0)
adj = None
if layers:
    for l in layers:
        if l.get("adjust"):
            adj = l["adjust"]; break
print("某个图层的 adjust:", adj)

ws.close()
print("=== DONE ===")
