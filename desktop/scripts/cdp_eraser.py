# E2E: eraser must punch real transparency holes in the active layer
import json, time, os, sys, subprocess
import websocket, urllib.request
PORT = 9361
UA = os.path.expandvars(r"%LOCALAPPDATA%\Temp\malachite-cdp-eraser")
chrome = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
if not os.path.exists(chrome): chrome = r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
proc = subprocess.Popen([chrome,"--headless=new","--window-size=1440,900",f"--remote-debugging-port={PORT}","--remote-allow-origins=*","--no-first-run","--no-default-browser-check","--no-sandbox",f"--user-data-dir={UA}","about:blank"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
try:
    tab=None
    for _ in range(40):
        try:
            tabs=[t for t in json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/list",timeout=2)) if t["type"]=="page"]
            if tabs: tab=tabs[0]; break
        except Exception: time.sleep(0.5)
    ws = websocket.create_connection(tab["webSocketDebuggerUrl"], timeout=90, suppress_origin=True)
    _i=[0]
    def send(m,**p):
        _i[0]+=1; ws.send(json.dumps({"id":_i[0],"method":m,"params":p}))
        while True:
            r=json.loads(ws.recv())
            if r.get("id")==_i[0]:
                if "error" in r: raise RuntimeError(f"{m}: {r['error']}")
                return r.get("result",{})
    def js(e):
        r=send("Runtime.evaluate",expression=e,returnByValue=True,awaitPromise=True)
        if r.get("exceptionDetails"): raise RuntimeError("JS: "+json.dumps(r["exceptionDetails"])[:400])
        return r["result"].get("value")
    send("Runtime.enable"); send("Page.enable")
    print("seed:", js("(() => { localStorage.clear(); const c=document.createElement('canvas'); c.width=800; c.height=600; const g=c.getContext('2d'); g.fillStyle='red'; g.fillRect(0,0,800,600); const d=c.toDataURL('image/png'); localStorage.setItem('malachite:dragprojects', JSON.stringify([{id:'dErase',title:'erasetest',img:d,thumb:d,w:800,h:600,docSize:{w:800,h:600},createdAt:1}])); return 'ok'; })()"))
    send("Page.navigate",url="http://localhost:3000/project?id=dErase")
    time.sleep(6)
    for _ in range(30):
        if js("(()=>{try{return !!(window.Konva&&Konva.stages[0]&&Konva.stages[0].find('Image').length)}catch(e){return false}})()"): break
        time.sleep(1)
    r = js("""(async () => {
      const btn=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='橡皮'||(x.getAttribute('title')||'').includes('橡皮'));
      if(!btn) return 'no eraser btn'; btn.click(); await new Promise(r=>setTimeout(r,300)); return 'tool-picked';
    })()""")
    print("tool:", r)
    rect = js("""(() => { const r=Konva.stages[0].content.getBoundingClientRect(); return JSON.stringify({x:r.x,y:r.y,w:r.width,h:r.height}); })()""")
    import math
    b=json.loads(rect); cx=b["x"]+b["w"]/2; cy=b["y"]+b["h"]/2
    def inp(t,x,y,btn="left"):
        send("Input.dispatchMouseEvent",type=t,x=round(x),y=round(y),button=btn if t!="mouseMoved" else "none",buttons=1 if t in ("mousePressed","mouseMoved") else 0,clickCount=1)
    inp("mouseMoved", cx-200, cy); inp("mousePressed", cx-200, cy)
    for x in range(-200,201,20): inp("mouseMoved", cx+x, cy)
    time.sleep(0.15); inp("mouseReleased", cx+200, cy)
    time.sleep(1.0)
    print("stroke: cdp-input done")
    r = js("""(async () => {
      const st=Konva.stages[0];
      const url = st.toDataURL({ pixelRatio: 1/st.scaleX() });
      const img = new Image(); await new Promise(r=>{img.onload=r;img.src=url;});
      const c=document.createElement('canvas'); c.width=img.naturalWidth; c.height=img.naturalHeight;
      const g=c.getContext('2d',{willReadFrequently:true}); g.drawImage(img,0,0);
      const d=JSON.parse(localStorage.getItem('malachite:project:dErase')||'{}');
      const line=(d.layers||[]).flatMap(l=>l.shapes).find(s=>s.kind==='line');
      const pts=line?line.points:[];
      const mx=Math.round(pts[Math.floor(pts.length/4)*2]), my=Math.round(pts[Math.floor(pts.length/4)*2+1]);
      const mid=g.getImageData(mx||400, my||300,1,1).data;
      const cor=g.getImageData(5,5,1,1).data;
      return JSON.stringify({size:img.naturalWidth+'x'+img.naturalHeight, stroke_mid_pt:[mx,my], mid_rgba:[...mid], corner_rgba:[...cor], npts:pts.length});
    })()""")
    print("pixels:", r)
    # also verify autosaved shape carries destination-out
    print("shapes:", js("""(() => { const d=JSON.parse(localStorage.getItem('malachite:project:dErase')||'{}'); return JSON.stringify((d.layers||[]).map(l=>l.shapes.map(s=>s.kind+(s.composite?':'+s.composite:'')))); })()""")
    )
finally:
    proc.terminate()
