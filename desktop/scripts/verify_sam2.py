import json, time, urllib.request, websocket, re

PORT = 9224

def get_tabs():
    req = urllib.request.Request(f"http://127.0.0.1:{PORT}/json/list", method="GET")
    return json.load(urllib.request.urlopen(req, timeout=10))

def connect(url):
    return websocket.create_connection(url, timeout=180)

tabs = get_tabs()
page = [t for t in tabs if t.get("type") == "page"]
t = page[0]
ws = connect(t["webSocketDebuggerUrl"])

# 启用 console 捕获
ws.send(json.dumps({"id": 100, "method": "Runtime.enable"}))
ws.send(json.dumps({"id": 101, "method": "Log.enable"}))

console_errors = []

def evaluate(expr):
    ws.send(json.dumps({"id": 1, "method": "Runtime.evaluate",
        "params": {"expression": expr, "returnByValue": True, "awaitPromise": True}}))
    while True:
        m = json.loads(ws.recv())
        mid = m.get("id")
        if mid == 1:
            return m.get("result", {}).get("result", {}).get("value")
        # 收集 console/异常
        if m.get("method") == "Runtime.exceptionThrown":
            d = m.get("params", {}).get("exceptionDetails", {})
            console_errors.append("EXC: " + str(d.get("text") or d.get("exception", {}).get("description", ""))[:200])
        elif m.get("method") == "Log.entryAdded":
            e = m.get("params", {}).get("entry", {})
            if e.get("level") in ("error", "warning"):
                console_errors.append(f"{e.get('level')}: {str(e.get('text'))[:200]}")

# 重新导航到 project?id=ink（干净状态）
evaluate("location.href='http://127.0.0.1:'+location.port+'/project?id=ink'; 'nav'")
time.sleep(4)

# 点 SAM 工具 + 全景分割
evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='⌁')?.click(); 'c'")
time.sleep(1)
evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='全景分割')?.click(); 'c'")
print("已点全景分割")

deadline = time.time() + 150
result = "TIMEOUT"
while time.time() < deadline:
    txt = evaluate("document.body.innerText")
    m = re.search(r"检测到 (\d+) 个元素", txt)
    if m:
        result = f"成功: {m.group(1)} 个元素"; break
    if "全景分割失败" in txt or "没有可分割的图层" in txt:
        result = "失败: " + (txt[txt.find("全景分割失败"):txt.find("全景分割失败")+120] if "全景分割失败" in txt else "没有可分割的图层"); break
    time.sleep(3)

print(f"结果: {result}")
print(f"console 错误({len(console_errors)}):")
for e in console_errors[-10:]:
    print("  ", e)

ws.close()
print("=== DONE ===")
