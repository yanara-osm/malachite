import json, time, urllib.request, websocket

PORT = 9222

def get_tabs():
    return json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/list", timeout=10))

def cdp(ws, m, p=None, mid=1):
    ws.send(json.dumps({"id": mid, "method": m, "params": p or {}}))
    while True:
        r = json.loads(ws.recv())
        if r.get("id") == mid:
            return r

def js(ws, e):
    r = cdp(ws, "Runtime.evaluate", {"expression": e, "returnByValue": True})
    return r.get("result", {}).get("result", {}).get("value")

tabs = get_tabs()
tab = next(t for t in tabs if t.get("type") == "page")
ws = websocket.create_connection(tab["webSocketDebuggerUrl"], timeout=60)

# 1. 导航 projects 页
cdp(ws, "Page.navigate", {"url": "http://localhost:3000/projects"})
time.sleep(3)

def has_test():
    return js(ws, "document.body.innerText.includes('测试项目XYZ')")

print("初始（未写数据）测试项目存在:", has_test())

# 2. 写 localStorage（模拟已保存的拖图项目）
js(ws, """localStorage.setItem('malachite:dragprojects', JSON.stringify([{id:'dTEST1234', title:'测试项目XYZ', img:'data:image/png;base64,iVBORw0KGgo=', time:'刚刚', steps:1}])); 'written'""")
print("已写入 localStorage['malachite:dragprojects']")

# 3. 刷新页面（等价于「点返回重新进列表页」）
cdp(ws, "Page.reload")
time.sleep(3)

print("刷新后 测试项目存在:", has_test())

# 4. 顺带验证旧 key 迁移
js(ws, """localStorage.setItem('malachi...ects', JSON.stringify([{id:'dLEGACY', title:'旧key项目', img:'data:image/png;base64,AA==', time:'昨天', steps:2}])); 'written'""")
cdp(ws, "Page.reload")
time.sleep(3)
legacy_migrated = js(ws, "localStorage.getItem('malachite:dragprojects')?.includes('旧key项目') ?? false")
print("旧 key 迁移到新 key:", legacy_migrated)
print("旧 key 已清除:", js(ws, "localStorage.getItem('malachi...ects') === null"))

ws.close()
print("=== DONE ===")
