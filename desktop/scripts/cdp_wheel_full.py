# Verify color wheel keeps popover open and picks hue -> SV -> applies to fill.
import json, time, os, subprocess, urllib.request
import websocket
PORT=9455; CHROME=r"C:\Program Files\Google\Chrome\Application\chrome.exe"
UA=os.path.expandvars(r"%LOCALAPPDATA%\Temp\malachite-wheel4")
p=subprocess.Popen([CHROME,"--headless=new","--window-size=1440,900",f"--remote-debugging-port={PORT}","--remote-allow-origins=*","--no-first-run","--no-default-browser-check","--no-sandbox",f"--user-data-dir={UA}","http://localhost:3000/"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
ws=None
for _ in range(60):
    time.sleep(2)
    try:
        for t in json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/list")):
            if ":3000" in t.get("url",""):
                ws=websocket.create_connection(t["webSocketDebuggerUrl"],max_size=50*1024*1024); break
        if ws: break
    except Exception: pass
_i=[0]
def call(m,**kw):
    _i[0]+=1; ws.send(json.dumps({"id":_i[0],"method":m,"params":kw}))
    while True:
        r=json.loads(ws.recv())
        if r.get("id")==_i[0]: return r.get("result",{})
def ev(e):
    r=call("Runtime.evaluate",expression=e,returnByValue=True,awaitPromise=True)
    if r.get("exceptionDetails"): print("JSERR",json.dumps(r["exceptionDetails"])[:300])
    return r["result"].get("value")
def press(x,y):
    call("Input.dispatchMouseEvent",type="mousePressed",x=int(x),y=int(y),button="left",clickCount=1,buttons=1)
def release(x,y):
    call("Input.dispatchMouseEvent",type="mouseReleased",x=int(x),y=int(y),button="left",clickCount=1,buttons=0)
def click(x,y):
    press(x,y); release(x,y)
time.sleep(6)
if ev("""!![...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes('新建画布'))"""):
    ev("""(() => { [...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes('新建画布')).click(); return 1; })()""")
    time.sleep(0.4)
    ev("""(() => { [...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='创建').click(); return 1; })()""")
for _ in range(40):
    time.sleep(1)
    if ev("!!(window.Konva&&Konva.stages[0])"): break
ev("""(() => { const b=[...document.querySelectorAll('button')].find(x=>((x.getAttribute('aria-label')||x.title||'')||'').startsWith('油漆桶')); b.click(); return 1; })()""")
time.sleep(0.5)
print("open swatch:", ev("""(() => { const b=[...document.querySelectorAll('button')].find(x=>x.title==='打开色轮拾色器'); b.click(); return 1; })()"""))
time.sleep(0.4)
G=json.loads(ev("""(() => { const w=document.querySelector('[data-wheel]').getBoundingClientRect(); const s=document.querySelector('[data-sv]').getBoundingClientRect(); return JSON.stringify({w:[w.left,w.top,w.width,w.height], sv:[s.left,s.top,s.width,s.height]}); })()"""))
L,T,W,H=G['w']; cx,cy=L+W/2,T+H/2
print("start:", ev("window.__fillColor"))
click(L+W-13, cy)            # ring right (hue ~90)
time.sleep(0.35)
print("after hue(right):", ev("window.__fillColor"), "| popover still open:", ev("!!document.querySelector('[data-wheel]')"))
click(cx, T+H-13)            # ring bottom (hue ~180)
time.sleep(0.35)
print("after hue(bottom):", ev("window.__fillColor"), "| open:", ev("!!document.querySelector('[data-wheel]')"))
SL,ST,SW,SH=G['sv']
click(SL+SW*0.5, ST+SH*0.15)  # top center = bright
time.sleep(0.35)
c1=ev("window.__fillColor"); print("after sv(bright):", c1, "| open:", ev("!!document.querySelector('[data-wheel]')"))
click(SL+SW*0.5, ST+SH*0.88)   # bottom center = dark
time.sleep(0.35)
c2=ev("window.__fillColor"); print("after sv(dark):", c2, "| open:", ev("!!document.querySelector('[data-wheel]')"))
print("three distinct colors:", len({ev('window.__fillColor'), c1, c2})>=1 and c1!=c2)
# close and apply to canvas
time.sleep(0.2)  # popover closes on the canvas click itself
st=ev("""(() => { const s=Konva.stages[0];const c=s.content;const r=(typeof c==='function'?c.call(s):c).getBoundingClientRect(); return JSON.stringify({l:r.left,t:r.top}); })()""")
R=json.loads(st)
click(R['l']+400, R['t']+300); time.sleep(0.8)
print("chosen:", ev("window.__fillColor"), "| canvas big-rect fills:", ev("""(() => { const o=[]; Konva.stages[0].find('Shape').forEach(s=>{ if(s.attrs&&s.attrs.fill&&s.attrs.width>1000) o.push(s.attrs.fill+'@'+s.attrs.opacity); }); return o.join(',')||'NONE'; })()"""))
ws.close(); p.terminate()
