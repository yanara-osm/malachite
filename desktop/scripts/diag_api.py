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

cdp(ws, "Page.navigate", {"url": "http://localhost:3000/api-config"})
time.sleep(3)

# 新建
js(ws, "[...document.querySelectorAll('button')].find(b => b.textContent.includes('新建 API')).click()")
time.sleep(1)

# 列出所有 input 的 placeholder + value
r = js(ws, "[...document.querySelectorAll('input')].map(i => ({ph: i.placeholder, v: i.value, t: i.type}))")
print("inputs:", json.dumps(r, ensure_ascii=False))

# 填命名（用 React 触发方式）
r = js(ws, """
(() => {
  const input = [...document.querySelectorAll('input')].find(i => i.placeholder === '如 OSM简单洗图');
  if (!input) return 'no-name-input';
  const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  s.call(input, '测试API');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return 'set: ' + input.value;
})()
""")
print("填命名:", r)

time.sleep(0.5)
# 检查命名 input 当前 value
print("命名 value:", js(ws, "[...document.querySelectorAll('input')].find(i => i.placeholder === '如 OSM简单洗图')?.value"))

ws.close()
print("=== DONE ===")
