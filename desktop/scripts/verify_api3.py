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

# 直接写一个含 image 参数的 API 定义（绕开 select 定位问题）
js(ws, """
localStorage.setItem('malachite:apidefs', JSON.stringify([{
  id: 't1', name: 'OSM简单洗图', description: '精修·图生图', protocol: 'runninghub-ai-app',
  webappId: '2079471819890974721', outputType: 'image',
  params: [
    { key: 'image', label: '原始图', type: 'image', required: true, nodeId: '6', fieldName: 'image' },
    { key: 'scale', label: '画面缩放倍数', type: 'number', required: false, nodeId: '7', fieldName: 'scale', default: '2' },
    { key: 'radius', label: '洗图前模糊半径', type: 'number', required: false, nodeId: '8', fieldName: 'radius', default: '5' },
    { key: 'sigma', label: '洗图前模糊sigma值', type: 'number', required: false, nodeId: '9', fieldName: 'sigma', default: '1.5' }
  ]
}]))
""")

cdp(ws, "Page.navigate", {"url": "http://localhost:3000/project?id=ink"})
time.sleep(4)

print("下拉含 OSM简单洗图:", js(ws, "[...document.querySelectorAll('option')].some(o => o.textContent === 'OSM简单洗图')"))
print("三选一按钮存在:", js(ws, "['整图','活动图层','当前选区'].every(t => document.body.innerText.includes(t))"))
print("数字参数标签存在:", js(ws, "['画面缩放倍数','洗图前模糊半径','洗图前模糊sigma值'].every(t => document.body.innerText.includes(t))"))
print("运行按钮存在:", js(ws, "[...document.querySelectorAll('button')].some(b => b.textContent.includes('运行'))"))
print("⚙管理入口存在:", js(ws, "!![...document.querySelectorAll('a')].find(a => a.getAttribute('href') === '/api-config')"))

ws.close()
print("=== DONE ===")
