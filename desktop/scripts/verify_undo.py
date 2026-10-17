import json, time, urllib.request, websocket

PORT = 9222
URL = "http://localhost:3000/project?id=ink"

def get_tabs():
    req = urllib.request.Request(f"http://127.0.0.1:{PORT}/json/list", method="GET")
    return json.load(urllib.request.urlopen(req, timeout=10))

def cdp(ws, method, params=None, mid=1):
    ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
    while True:
        r = json.loads(ws.recv())
        if r.get("id") == mid:
            return r

def js(ws, expr):
    r = cdp(ws, "Runtime.evaluate", {"expression": expr, "returnByValue": True})
    return r.get("result", {}).get("result", {}).get("value")

# 连接第一个 tab
tabs = get_tabs()
tab = next(t for t in tabs if t.get("type") == "page")
ws = websocket.create_connection(tab["webSocketDebuggerUrl"], timeout=60)

# 1. 导航到 ink 项目
cdp(ws, "Page.navigate", {"url": URL})
time.sleep(4)

# 2. 等 Workbench 加载（找撤销按钮）
def btn_text(name):
    return js(ws, f"[...document.querySelectorAll('button')].find(b => b.textContent.includes('{name}'))?.textContent || 'NOT_FOUND'")

for _ in range(15):
    t = btn_text("撤销")
    if t != "NOT_FOUND" and "撤销" in t:
        break
    time.sleep(1)
print("初始撤销按钮:", btn_text("撤销"), "| 重做按钮:", btn_text("重做"))

# 3. 找 canvas 位置
rect = js(ws, "(() => { const c = [...document.querySelectorAll('canvas')].find(c => c.parentElement?.className?.includes('konvajs-content')); if(!c) return null; const r = c.getBoundingClientRect(); return {x:r.x, y:r.y, w:r.width, h:r.height}; })()")
print("canvas rect:", rect)
if not rect:
    print("找不到 canvas"); raise SystemExit

cx = rect["x"] + rect["w"] / 2
cy = rect["y"] + rect["h"] / 2

# 4. 画一笔：mousedown → mousemove → mouseup
def mouse(typ, x, y, btn=1):
    cdp(ws, "Input.dispatchMouseEvent", {"type": typ, "x": x, "y": y, "button": "left", "buttons": btn, "clickCount": 1})

mouse("mousePressed", cx - 30, cy - 30, 1)
mouse("mouseMoved", cx, cy, 1)
mouse("mouseMoved", cx + 30, cy + 30, 1)
mouse("mouseReleased", cx + 30, cy + 30, 0)
time.sleep(1)

print("画一笔后   撤销:", btn_text("撤销"), "| 重做:", btn_text("重做"))

# 5. 点撤销
js(ws, "[...document.querySelectorAll('button')].find(b => b.textContent.includes('撤销')).click()")
time.sleep(0.6)
print("点撤销后   撤销:", btn_text("撤销"), "| 重做:", btn_text("重做"))

# 6. 点重做
js(ws, "[...document.querySelectorAll('button')].find(b => b.textContent.includes('重做')).click()")
time.sleep(0.6)
print("点重做后   撤销:", btn_text("撤销"), "| 重做:", btn_text("重做"))

ws.close()
print("=== DONE ===")
