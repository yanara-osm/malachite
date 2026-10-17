import json, time, urllib.request, websocket

PORT = 9223

def get_tabs():
    req = urllib.request.Request(f"http://127.0.0.1:{PORT}/json/list", method="GET")
    return json.load(urllib.request.urlopen(req, timeout=10))

def connect(url):
    return websocket.create_connection(url, timeout=60)

def evaluate(ws, expr):
    ws.send(json.dumps({"id": 1, "method": "Runtime.evaluate",
        "params": {"expression": expr, "returnByValue": True, "awaitPromise": True}}))
    while True:
        m = json.loads(ws.recv())
        if m.get("id") == 1:
            r = m.get("result", {}).get("result", {})
            return r.get("value")

tabs = get_tabs()
page = [t for t in tabs if t.get("type") == "page" and "devtools" not in t.get("url", "")]
if not page:
    print("NO PAGE TAB"); exit(1)
t = page[0]
ws = connect(t["webSocketDebuggerUrl"])

# 等待首页加载
time.sleep(2)
title = evaluate(ws, "document.title")
iso = evaluate(ws, "crossOriginIsolated")
gpu = evaluate(ws, "!!navigator.gpu")
url = evaluate(ws, "location.href")
print(f"首页: title={title!r} url={url}")
print(f"crossOriginIsolated={iso}  navigator.gpu={gpu}")

# 导航到 project?id=ink
evaluate(ws, "location.href='http://127.0.0.1:'+location.port+'/project?id=ink'; 'nav'")
time.sleep(3)
ptitle = evaluate(ws, "document.title")
btns = evaluate(ws, "Array.from(document.querySelectorAll('button')).map(b=>b.textContent).slice(0,25)")
print(f"project页: title={ptitle!r}")
print(f"按钮: {btns}")

# 检查 SAM 工具按钮（⌁）是否存在 + 图层
sam = evaluate(ws, "!!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='⌁')")
print(f"SAM 工具按钮(⌁)存在 = {sam}")

ws.close()
print("=== VERIFY DONE ===")
