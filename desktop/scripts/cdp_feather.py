# Verify feather: soft brush = alpha gradient at stroke edge; soft eraser = partial alpha band
import json, time, os, subprocess, urllib.request
import websocket
CHROME=r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PORT = 9370
UA = os.path.expandvars(r"%LOCALAPPDATA%\Temp\malachite-feather-cdp")

def wait_main():
    for _ in range(60):
        time.sleep(2)
        try:
            for p in json.loads(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json").read()):
                if "localhost:3000" in p.get("url", "") and p.get("webSocketDebuggerUrl"):
                    return websocket.create_connection(p["webSocketDebuggerUrl"], max_size=50*1024*1024, origin="null")
        except Exception as e:
            last=e
        time.sleep(0)
proc = subprocess.Popen([CHROME,"--headless=new",f"--user-data-dir={UA}",f"--remote-debugging-port={PORT}","--remote-allow-origins=*","--no-first-run","--no-default-browser-check","--no-sandbox","--window-size=1440,900","http://localhost:3000/"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
ws = wait_main(); assert ws, "chrome not ready"
_id=[0]
def send(**kw):
    _id[0]+=1; kw["id"]=_id[0]; ws.send(json.dumps(kw)); return _id[0]
def recv(eid, timeout=20):
    ws.settimeout(timeout)
    while True:
        m=json.loads(ws.recv())
        if m.get("id")==eid: return m
def ev(expr):
    r=recv(send(method="Runtime.evaluate", params={"expression":expr,"returnByValue":True,"awaitPromise":True}))
    if "exceptionDetails" in r.get("result",{}):
        raise RuntimeError(r["result"]["exceptionDetails"].get("exception",{}).get("description","js err"))
    return r["result"]["result"].get("value")
def key(k, code):
    send(method="Input.dispatchKeyEvent", type="keyDown", key=k, code=code, windowsVirtualKeyCode=ord(k.upper()))
    send(method="Input.dispatchKeyEvent", type="keyUp", key=k, code=code, windowsVirtualKeyCode=ord(k.upper()))
    time.sleep(0.2)
def stroke(x, y, dx=4, n=15):
    send(method="Input.dispatchMouseEvent", type="mouseMoved", x=x, y=y, buttons=0); time.sleep(0.1)
    send(method="Input.dispatchMouseEvent", type="mousePressed", x=x, y=y, button="left", buttons=1, clickCount=1)
    for i in range(1, n+1):
        send(method="Input.dispatchMouseEvent", type="mouseMoved", x=x+i*dx, y=y, buttons=1); time.sleep(0.02)
    send(method="Input.dispatchMouseEvent", type="mouseReleased", x=x+n*dx, y=y, button="left", buttons=0)
    time.sleep(0.5)
def setrange(label, val):
    return ev(f"""(() => {{
      const lab=[...document.querySelectorAll('label')].find(l=>l.firstChild.textContent.trim()==='{label}');
      const inp=lab && lab.querySelector('input[type=range]');
      if(!inp) return 'no-slider';
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(inp,'{val}');
      inp.dispatchEvent(new Event('input',{{bubbles:true}}));
      return 'ok';
    }})()""")

for _ in range(60):
    if ev("!!(window.Konva&&document.body.innerText.includes('导出'))"): break
    time.sleep(2)
print("ready")
seed_js = """(() => { localStorage.clear(); const c=document.createElement('canvas'); c.width=800; c.height=600; const g=c.getContext('2d'); g.clearRect(0,0,800,600); const d=c.toDataURL('image/png'); localStorage.setItem('malachite:dragprojects', JSON.stringify([{id:'dFeather',title:'feathertest',img:d,thumb:d,w:800,h:600,docSize:{w:800,h:600},createdAt:1}])); return 'ok'; })()"""
print("seed:", ev(seed_js))
ev("location.href='http://localhost:3000/project?id=dFeather'")
time.sleep(5)
for _ in range(30):
    if ev("!!(window.Konva&&Konva.stages[0])"): break
    time.sleep(1)
key("b","KeyB")  # brush
assert ev("document.body.innerText.includes('羽化')"), "no feather slider"
print("in workbench")

# --- 1) soft brush stroke: vertical alpha profile across the line must have gradient
assert setrange("大小", 40)=="ok" and setrange("羽化", 30)=="ok"
stroke(360, 300)
assert ev("""(() => { const st=window.Konva.stages[0]; window.__cs=st.find('Layer').map(l=>l.getCanvas()._canvas); return window.__cs.length; })()""")
# pick the layer canvas that actually has nontransparent pixels
pick=ev("""(() => { for(const c of window.__cs){ const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data; let n=0; for(let i=3;i<d.length;i+=4) if(d[i]>4){n++; if(n>20){window.__c=c; return 'picked '+c.width+'x'+c.height;}} } return 'none'; })()""")
print("layer:", pick)
assert pick.startswith('picked'), pick
rows = json.loads(ev("""(() => {
  const d=window.__c.getContext('2d').getImageData(360,250,80,100).data;
  const rows=[]; for(let y=0;y<100;y++){let m=0;for(let x=0;x<80;x++)m=Math.max(m,d[(y*80+x)*4+3]);rows.push(m);}
  return JSON.stringify(rows);
})()"""))
peak=max(rows)
# distance from edge row (first nonzero) to peak row = feather ramp width
nz=[i for i,r in enumerate(rows) if r>8]
ramp = None
for i in nz:
    # first row where alpha starts climbing; find rows strictly between low and peak
    lows=[r for r in rows if 10 < r < peak-10]
    if lows: ramp=len(lows); break
print("SOFT BRUSH: peak a=%d, ramp rows with partial alpha=%s" % (peak, ramp))
assert peak > 200 and ramp and ramp >= 8, ("soft edge expected", peak, ramp)

# --- 2) hard stroke nearby, then soft eraser grazes it: expect partial-alpha band, not hard cut
assert setrange("羽化", 0)=="ok"
stroke(360, 500)
core = ev("""(() => { const d=window.__c.getContext('2d').getImageData(360,490,80,20).data; let m=0; for(let i=3;i<d.length;i+=4)m=Math.max(m,d[i]); return m; })()""")
print("HARD stroke core a=", core); assert core > 250
assert setrange("羽化", 30)=="ok"
key("e","KeyE")
stroke(360, 462)  # erase just above the hard stroke, feather reaches down into its top edge
band = json.loads(ev("""(() => {
  const d=window.__c.getContext('2d').getImageData(360,455,80,60).data;
  const rows=[]; for(let y=0;y<60;y++){let m=0;for(let x=0;x<80;x++)m=Math.max(m,d[(y*60+x*0+y*0)*4+3*0+ (y*80+x)*4+3]);rows.push(m);}
  return JSON.stringify(rows);
})()"""))
# rows 40+ = doc y 495+ = hard stroke body. fully erased center should be low; edge rows partial.
zone=[r for r in band[25:55] if r>0]
partial=len([r for r in zone if 10<r<245])
print("ERASER zone alpha set sample:", zone[:14])
print("PARTIAL-ALPHA rows (feather effect):", partial)
assert partial >= 3, ("expected partial alpha from soft eraser", partial)
print("ALL PASS")
ws.close(); proc.terminate()
