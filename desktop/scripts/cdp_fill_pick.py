# Verify paint bucket (fill) has color option in property bar + Alt+click eyedropper.
import json, time, os, subprocess, urllib.request
import websocket
PORT=9440; CHROME=r"C:\Program Files\Google\Chrome\Application\chrome.exe"
UA=os.path.expandvars(r"%LOCALAPPDATA%\Temp\malachite-fillpick")
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
time.sleep(6)
ev("""(() => { [...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes('新建画布')).click(); return '1'; })()""")
time.sleep(0.4)
ev("""(() => { [...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='创建').click(); return '1'; })()""")
for _ in range(40):
    time.sleep(1)
    if ev("!!(window.Konva&&Konva.stages[0])"): break

# 1) draw a dark brush stroke
ev("""(() => { const b=[...document.querySelectorAll('button')].find(x=>((x.getAttribute('aria-label')||x.title||'')==='画笔')); b.click(); return '1'; })()""")
st=ev("""(() => { const s=Konva.stages[0];const c=s.content;const r=(typeof c==='function'?c.call(s):c).getBoundingClientRect(); return JSON.stringify({l:r.left,t:r.top}); })()""")
R=json.loads(st)
def mouse(t,x,y,alt=False):
    call("Input.dispatchMouseEvent",type=t,x=x,y=y,button="left",clickCount=1,buttons=1 if t!="mouseReleased" else 0,modifiers=1 if alt else 0)
ix,iy=R['l']+300,R['t']+200
mouse("mousePressed",ix,iy)
for k in range(4): mouse("mouseMoved",ix+20+k*20,iy)
mouse("mouseReleased",ix+100,iy)
time.sleep(0.6)

# 2) switch to fill tool, inspect property bar
ev("""(() => { const b=[...document.querySelectorAll('button')].find(x=>((x.getAttribute('aria-label')||x.title||'')||'').startsWith('油漆桶')); if(!b){const c=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='⬒'); if(c)c.click(); return !!c;} b.click(); return '1'; })()""")
time.sleep(0.5)
bar=ev("""(() => { const el=[...document.querySelectorAll('div')].find(d=>d.className&&d.className.includes('h-9')); return el? el.innerText.replace(/\\n/g,' | ') : 'NOT FOUND'; })()""")
print("PROPERTY BAR:", bar)

print("fillColor before:", ev("window.__fillColor"))
layers_before=ev("Konva.stages[0].find('Layer').length")
# 3) Alt+click on the dark stroke -> should pick #1c1a17, and NOT fill
mouse("mousePressed",ix+50,iy,alt=True)
mouse("mouseReleased",ix+50,iy,alt=True)
time.sleep(0.7)
print("fillColor after dark pick:", ev("window.__fillColor"))
print("layers before/after:", layers_before, ev("Konva.stages[0].find('Layer').length"))
# 4) Alt+click white area -> #ffffff
mouse("mousePressed",R['l']+900,R['t']+450,alt=True)
mouse("mouseReleased",R['l']+900,R['t']+450,alt=True)
time.sleep(0.7)
print("fillColor after white pick:", ev("window.__fillColor"))
ws.close(); p.terminate()
