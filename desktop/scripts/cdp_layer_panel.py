# E2E: 图层面板素材子行（放置文字 → 面板出现 T 子行 → 点子行选中画布节点 → 子行删除）
import json, time, urllib.request
import websocket

PORT = 9333
tab = [t for t in json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/list")) if t["type"] == "page"][0]
ws = websocket.create_connection(tab["webSocketDebuggerUrl"], timeout=30)
_id = [0]

def send(m, **p):
    _id[0] += 1
    ws.send(json.dumps({"id": _id[0], "method": m, "params": p}))
    while True:
        msg = json.loads(ws.recv())
        if msg.get("id") == _id[0]:
            return msg.get("result", {})

def js(e):
    r = send("Runtime.evaluate", expression=e, returnByValue=True, awaitPromise=True)
    return r.get("result", {}).get("value")

def click(x, y, cc=1):
    for t in ("mousePressed", "mouseReleased"):
        send("Input.dispatchMouseEvent", type=t, x=float(x), y=float(y), button="left",
             clickCount=cc, buttons=1 if t == "mousePressed" else 0)

def btn(label):
    v = js("(() => { const els=[...document.querySelectorAll('button')].filter(b=>b.textContent.trim()=== %s); const b=els[0]; if(!b)return null; const r=b.getBoundingClientRect(); return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2}); })()" % json.dumps(label))
    return json.loads(v) if v else None

send("Page.enable")
send("Emulation.setDeviceMetricsOverride", width=1600, height=1000, deviceScaleFactor=1, mobile=False)
send("Page.navigate", url="http://localhost:3000/")
time.sleep(5)
p = btn("＋ 新建画布"); click(p["x"], p["y"]); time.sleep(3)
for l in ("创建", "确定", "开始"):
    p = btn(l)
    if p: click(p["x"], p["y"]); break
time.sleep(3)

# place a text
p = btn("T"); click(p["x"], p["y"]); time.sleep(0.5)
stg = json.loads(js("(() => { const r=document.querySelector('.konvajs-content').getBoundingClientRect(); return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2}); })()"))
click(stg["x"], stg["y"]); time.sleep(1.2)
js("document.querySelector('input[placeholder=\"输入文字…\"]').focus()")
send("Input.insertText", text="图层文字测试"); time.sleep(0.3)
p = btn("放置"); click(p["x"], p["y"]); time.sleep(1)

# 1) panel shows the text sub-row
row = js("""(() => { const rows=[...document.querySelectorAll('div[title]')].filter(d=>d.title.indexOf('重编辑')>=0); const r=rows.find(d=>d.textContent.indexOf('图层文字测试')>=0); if(!r)return null; const b=r.getBoundingClientRect(); return JSON.stringify({x:b.x+b.width/2,y:b.y+b.height/2,text:r.textContent.trim()}); })()""")
print("1. text sub-row in layers panel:", row)
assert row, "FAIL: no text sub-row"
rowj = json.loads(row)

# 2) Escape deselect, then click the sub-row -> Transformer attaches to the text node
send("Input.dispatchKeyEvent", type="keyDown", key="Escape", code="Escape")
send("Input.dispatchKeyEvent", type="keyUp", key="Escape", code="Escape")
time.sleep(0.4)
click(rowj["x"], rowj["y"]); time.sleep(0.6)
attached = js("""(() => { const tr=Konva.stages[0].findOne('Transformer'); if(!tr||!tr.nodes().length)return null; const n=tr.nodes()[0]; return {cls:n.className, text:n.text&&n.text()}; })()""")
print("2. select via panel sub-row ->", attached)

# 3) delete via sub-row button
deljs = """(() => { const rows=[...document.querySelectorAll('div[title]')].filter(d=>d.title.indexOf('重编辑')>=0); const r=rows.find(d=>d.textContent.indexOf('图层文字测试')>=0); if(!r)return null; const b=r.querySelector('button[title="删除素材"]'); if(!b)return null; b.click(); return 'clicked'; })()"""
print("3. sub-row delete:", js(deljs)); time.sleep(0.8)
gone = js("""(() => { const ns=Konva.stages[0].find('Text'); return ns.filter(n=>n.text()==='图层文字测试').length; })()""")
print("   text nodes remaining (expect 0):", gone)
