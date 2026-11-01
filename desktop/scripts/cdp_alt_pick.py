# Verify brush Alt+click picks color (built-in eyedropper, no tool switch).
import json, time, os, subprocess, urllib.request
import websocket
PORT=9421; CHROME=r"C:\Program Files\Google\Chrome\Application\chrome.exe"
UA=os.path.expandvars(r"%LOCALAPPDATA%\Temp\malachite-altpick2")
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
    if r.get("exceptionDetails"): print("JSERR",json.dumps(r["exceptionDetails"])[:400])
    return r["result"].get("value")
time.sleep(6)
ev("""(() => { [...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes('新建画布')).click(); return '1'; })()""")
time.sleep(0.4)
ev("""(() => { [...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='创建').click(); return '1'; })()""")
for _ in range(40):
    time.sleep(1)
    if ev("!!(window.Konva&&Konva.stages[0])"): break
print("brush:", ev("""(() => { const b=[...document.querySelectorAll('button')].find(x=>((x.getAttribute('aria-label')||x.title||'')==='画笔')); if(b)b.click(); return !!b; })()"""))
# set brush color to a known red via the color state: easiest is to set via React is hard.
# Instead draw with default dark color, then change brush color through ColorWheelPicker is complex;
# Simpler: directly read what pickColorAt returns via Alt path and confirm brushColor changes from initial.
rect=ev("""(() => { const st0=Konva.stages[0];const ce0=st0.content;const r=(typeof ce0==='function'?ce0.call(st0):ce0).getBoundingClientRect(); return JSON.stringify({l:r.left,t:r.top}); })()""")
R=json.loads(rect)
ix=R['l']+300; iy=R['t']+200
def mouse(t,x,y,alt=False):
    mods=1 if alt else 0
    call("Input.dispatchMouseEvent",type=t,x=x,y=y,button="left",clickCount=1,buttons=1 if t!="mouseReleased" else 0, modifiers=mods)
# draw a stroke (default brush color #1c1a17)
mouse("mousePressed",ix,iy)
for k in range(4): mouse("mouseMoved",ix+20+k*20,iy)
mouse("mouseReleased",ix+100,iy)
time.sleep(0.6)
# Now read current brush color baseline via the committed line stroke color
base=ev("""(() => { const ls=Konva.stages[0].find('Line'); for(const n of ls){ if(n.attrs.stroke) return n.attrs.stroke; } return null; })()""")
print("drawn stroke color:", base)
# We need brushColor currently something else. Use the color picker swatch? Instead trigger Alt+click
# on the white area first -> should pick white #ffffff
mouse("mousePressed",R['l']+120,R['t']+120,alt=True)
mouse("mouseReleased",R['l']+120,R['t']+120,alt=True)
time.sleep(0.6)
xxx=ev("""(() => { const sw=[...document.querySelectorAll('input')].find(i=>i.value==='#ffffff'||i.value==='ffffff'); return sw?sw.value:'check'; })()""")
# Easier: read brushColor from a newly drawn stroke preview is unreliable. Expose via window? Instead
# verify through DOM color input if ColorWheelPicker shows hex. Print all small text inputs values.
print("brush after white pick:", ev("window.__brushColor"))
# Now Alt+click on the dark stroke center (ix+50,iy)
mouse("mousePressed",ix+50,iy,alt=True)
mouse("mouseReleased",ix+50,iy,alt=True)
time.sleep(0.6)
print("brush after dark stroke pick:", ev("window.__brushColor"))
ws.close(); p.terminate()
