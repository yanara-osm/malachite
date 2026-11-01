# Verify brush tracks outside stage bounds: one continuous stroke with points beyond the edge.
import json, time, os, subprocess, urllib.request
import websocket
PORT=9404; CHROME=r"C:\Program Files\Google\Chrome\Application\chrome.exe"
UA=os.path.expandvars(r"%LOCALAPPDATA%\Temp\malachite-outside5")
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
# create blank canvas default (4:3)
ev("""(() => { [...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes('新建画布')).click(); return '1'; })()""")
time.sleep(0.4)
ev("""(() => { [...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='创建').click(); return '1'; })()""")
for _ in range(40):
    time.sleep(1)
    if ev("!!(window.Konva&&Konva.stages[0])"): break
# select brush tool by clicking toolbar
print("brush:", ev("""(() => { const b=[...document.querySelectorAll('button')].find(x=>((x.getAttribute('aria-label')||x.title||'')==='画笔')); if(b)b.click(); return !!b; })()"""))
time.sleep(0.2)
# get stage rect
rect=ev("""(() => { const st0=Konva.stages[0];const ce0=st0.content;const r=(typeof ce0==='function'?ce0.call(st0):ce0).getBoundingClientRect(); return JSON.stringify({l:r.left,t:r.top,w:r.width,h:r.height}); })()""")
print("stage rect:", rect)
import json as J
R=J.loads(rect)
cx0=R['l']+R['w']-40   # near right edge inside
cy=R['t']+R['h']/2
def mouse(t,x,y,btn="left"):
    call("Input.dispatchMouseEvent",type=t,x=x,y=y,button=btn,clickCount=1,buttons=1 if t!="mouseReleased" else 0)
# CONTROL: pure inside stroke
ix=R['l']+300; iy=R['t']+200
mouse("mousePressed",ix,iy)
for k in range(6):
    mouse("mouseMoved",ix+20+k*20,iy); time.sleep(0.12)
mouse("mouseReleased",ix+140,iy)
time.sleep(0.6)
print("after control lines:", ev("Konva.stages[0].find('Line').length"))
# REAL stroke crossing boundary
mouse("mousePressed",cx0,cy)
pts=[(cx0+20,cy),(R['l']+R['w']+10,cy),(R['l']+R['w']+60,cy),(R['l']+R['w']+10,cy),(R['l']+R['w']-20,cy)]
for x,y in pts:
    mouse("mouseMoved",x,y); time.sleep(0.15)
time.sleep(0.2)
mouse("mouseReleased",R['l']+R['w']-20,cy)
time.sleep(1)
# inspect committed line(s): count strokes, get max x (doc coords), and whether points extend beyond doc width
res=ev("""(() => {
 const st=Konva.stages[0];
 const all=[];
 st.find('Line').forEach(n=>{ all.push({isStroke:!!n.attrs.isStroke, composite:n.attrs.globalCompositeOperation, npts:n.attrs.points?n.attrs.points.length:0}); });
 // committed stroke lines: look at all layers' shapes is not in DOM; instead lines without isStroke but with composite? print first/last x of every line
 const detail=[];
 st.find('Line').forEach(n=>{ const pts=n.attrs.points||[]; let mx=-1e9,mn=1e9; for(let i=0;i<pts.length;i+=2){mx=Math.max(mx,pts[i]);mn=Math.min(mn,pts[i]);} detail.push({isStroke:!!n.attrs.isStroke, n:pts.length/2, mn:Math.round(mn), mx:Math.round(mx)}); });
 return JSON.stringify({all, detail});
})()""")
print("RESULT:", res)
print("DOCW:", ev("Math.round(Konva.stages[0].attrs.width/Konva.stages[0].scaleX())"))
ws.close(); p.terminate()
