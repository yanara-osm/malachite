# PS-like text editing E2E (v4, clean): contrast fill, drag-move, dblclick re-edit, anchor scale, delete, undo.
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
            if "error" in msg:
                raise RuntimeError(msg["error"])
            return msg.get("result", {})

def js(e):
    r = send("Runtime.evaluate", expression=e, returnByValue=True, awaitPromise=True)
    return r.get("result", {}).get("value")

def click(x, y, cc=1):
    for t in ("mousePressed", "mouseReleased"):
        send("Input.dispatchMouseEvent", type=t, x=float(x), y=float(y), button="left",
             clickCount=cc, buttons=1 if t == "mousePressed" else 0)

def drag(x0, y0, x1, y1, steps=12):
    send("Input.dispatchMouseEvent", type="mousePressed", x=float(x0), y=float(y0), button="left", clickCount=1, buttons=1)
    for i in range(1, steps + 1):
        f = i / steps
        send("Input.dispatchMouseEvent", type="mouseMoved", x=float(x0 + (x1 - x0) * f), y=float(y0 + (y1 - y0) * f), button="left", buttons=1)
    send("Input.dispatchMouseEvent", type="mouseReleased", x=float(x1), y=float(y1), button="left", clickCount=1, buttons=0)

def btn(label):
    v = js("(() => { const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()=== %s); if(!b)return null; const r=b.getBoundingClientRect(); return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2}); })()" % json.dumps(label))
    return json.loads(v) if v else None

HELPERS = """
window.__node = () => { const ns = Konva.stages[0].find('Text'); if (!ns.length) return null; const n = ns[0];
  return {x: n.x(), y: n.y(), sx: +n.scaleX().toFixed(3), sy: +n.scaleY().toFixed(3), text: n.text(), fill: n.fill(), draggable: n.draggable()}; };
window.__nodeScreen = () => { const ns = Konva.stages[0].find('Text'); if (!ns.length) return null; const n = ns[0];
  const st = Konva.stages[0]; const r = st.container().getBoundingClientRect();
  return {x: r.left + n.x() * st.scaleX(), y: r.top + n.y() * st.scaleY()}; };
window.__trAnchorBR = () => { const tr = Konva.stages[0].findOne('Transformer'); if (!tr || !tr.nodes().length) return null;
  const n = tr.nodes()[0]; const st = Konva.stages[0];
  const cr = st.container().getBoundingClientRect();
  const x = n.x() + n.width() * n.scaleX(), y = n.y() + n.height() * n.scaleY();
  return {x: cr.left + x * st.scaleX(), y: cr.top + y * st.scaleY()}; };
'ok'
"""

send("Page.enable")
send("Emulation.setDeviceMetricsOverride", width=1600, height=1000, deviceScaleFactor=1, mobile=False)
send("Page.navigate", url="http://localhost:3000/")
time.sleep(5)
p = btn("＋ 新建画布"); click(p["x"], p["y"]); time.sleep(3)
for l in ("创建", "确定", "开始"):
    p = btn(l)
    if p:
        click(p["x"], p["y"]); break
time.sleep(3)
assert js(HELPERS) == "ok"

# --- place text ---
p = btn("T"); click(p["x"], p["y"]); time.sleep(0.5)
stg = json.loads(js("(() => { const r=document.querySelector('.konvajs-content').getBoundingClientRect(); return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2}); })()"))
click(stg["x"], stg["y"]); time.sleep(1.5)  # contrast sampling
js("document.querySelector('input[placeholder=\"输入文字…\"]').focus()")
send("Input.insertText", text="测试汉字"); time.sleep(0.3)
p = btn("放置"); click(p["x"], p["y"]); time.sleep(1)

n = js("window.__node()")
print("1. placed node (expect fill #1c1a17 on white, draggable True):", n)

# --- drag move: press inside the glyph box, move +80/+60 screen px ---
s0 = js("window.__nodeScreen()")
before = js("window.__node()")
drag(s0["x"] + 40, s0["y"] + 12, s0["x"] + 120, s0["y"] + 72)
time.sleep(0.8)
after = js("window.__node()")
dx = after["x"] - before["x"]; dy = after["y"] - before["y"]
print(f"2. drag move: dx={dx:.0f} dy={dy:.0f} doc px (expect ~190,143 @0.42 zoom):", "PASS" if dx > 100 else "FAIL")

# --- dblclick re-edit ---
s1 = js("window.__nodeScreen()")
click(s1["x"] + 40, s1["y"] + 12, cc=1)
time.sleep(0.08)
click(s1["x"] + 40, s1["y"] + 12, cc=2)
time.sleep(0.6)
prefill = js("(() => { const i=document.querySelector('input[placeholder=\"输入文字…\"]'); return i? i.value : 'NO_OVERLAY'; })()")
print("3. dblclick re-edit prefill (expect 测试汉字):", prefill)
if prefill == "测试汉字":
    js("(() => { const i=document.querySelector('input[placeholder=\"输入文字…\"]'); i.focus(); i.select(); })()")
    send("Input.insertText", text="改成新的字"); time.sleep(0.2)
    p = btn("放置"); click(p["x"], p["y"]); time.sleep(0.8)
    print("   text after re-edit (expect 改成新的字, same pos kept):", js("window.__node()"))

# --- transformer anchor scale ---
time.sleep(0.3)
s2 = js("window.__nodeScreen()")
click(s2["x"] + 40, s2["y"] + 12); time.sleep(0.5)  # select
a = js("window.__trAnchorBR()")
if a:
    drag(a["x"], a["y"], a["x"] + 70, a["y"] + 50)
    time.sleep(0.8)
    n3 = js("window.__node()")
    time.sleep(1.2)  # autosave debounce
    saved = js("""(() => { const id=new URLSearchParams(location.search).get('id');
      const st=JSON.parse(localStorage.getItem('malachite:project:'+id)); const t=st.layers.flatMap(l=>l.shapes).find(s=>s.kind==='text');
      return t ? JSON.stringify({sx:t.scaleX,sy:t.scaleY,x:t.x,y:t.y}) : 'NO_TEXT'; })()""")
    print("4. anchor scale live:", n3)
    print("   persisted in save:", saved)
else:
    print("4. transformer NOT attached: FAIL")

# --- delete + undo ---
send("Input.dispatchKeyEvent", type="keyDown", key="Delete", code="Delete")
send("Input.dispatchKeyEvent", type="keyUp", key="Delete", code="Delete")
time.sleep(0.6)
print("5. after Delete (expect None):", js("window.__node()"))
send("Input.dispatchKeyEvent", type="keyDown", key="z", code="KeyZ", modifiers=2)
send("Input.dispatchKeyEvent", type="keyUp", key="z", code="KeyZ", modifiers=2)
time.sleep(0.5)
print("6. after ctrl+z (expect node back, scale preserved):", js("window.__node()"))
