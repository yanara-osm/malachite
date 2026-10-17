import json, time, urllib.request, websocket

PORT = 9223

def get_tabs():
    req = urllib.request.Request(f"http://127.0.0.1:{PORT}/json/list", method="GET")
    return json.load(urllib.request.urlopen(req, timeout=10))

def connect(url):
    return websocket.create_connection(url, timeout=120)

def evaluate(ws, expr):
    ws.send(json.dumps({"id": 1, "method": "Runtime.evaluate",
        "params": {"expression": expr, "returnByValue": True, "awaitPromise": True}}))
    while True:
        m = json.loads(ws.recv())
        if m.get("id") == 1:
            r = m.get("result", {}).get("result", {})
            return r.get("value")

tabs = get_tabs()
page = [t for t in tabs if t.get("type") == "page"]
t = page[0]
ws = connect(t["webSocketDebuggerUrl"])

# 确保在 project 页
evaluate(ws, "location.href.includes('/project') ? 'ok' : (location.href='http://127.0.0.1:'+location.port+'/project?id=ink', 'nav')")
time.sleep(3)

# 点 SAM 工具（⌁）
evaluate(ws, "Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='⌁')?.click(); 'clicked'")
time.sleep(1)
attr = evaluate(ws, "document.body.innerText.includes('全景分割') ? 'has-全景分割' : 'no'")
print(f"点 SAM 后属性栏含全景分割 = {attr}")

# 点全景分割
evaluate(ws, "Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='全景分割')?.click(); 'clicked'")
print("已点全景分割，等待推理（模型 172M 加载 + 256 点 WebGPU）…")

# 轮询属性栏文本
deadline = time.time() + 120
result = None
while time.time() < deadline:
    txt = evaluate(ws, "document.body.innerText")
    if "检测到" in txt and "个元素" in txt:
        import re
        m = re.search(r"检测到 (\d+) 个元素", txt)
        result = m.group(1) if m else "?"
        break
    if "失败" in txt or "error" in txt.lower():
        result = "ERROR: " + txt[-200:]
        break
    time.sleep(3)

print(f"全景分割结果: {result}")
ws.close()
print("=== SAM INFER DONE ===")
