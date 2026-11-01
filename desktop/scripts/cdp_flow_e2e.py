# E2E flow: 2 brush strokes + eraser over stroke1-left; sample by stage-rect fractions
import json, time, os
import websocket, urllib.request, subprocess
PORT = 9362
UA = os.path.expandvars(r"%LOCALAPPDATA%\Temp\malachite-cdp-flow2")
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
    send("Page.navigate",url="http://localhost:3000/projects"); time.sleep(4)
    print("seed:", js("(() => { localStorage.clear(); const c=document.createElement('canvas'); c.width=800; c.height=600; const g=c.getContext('2d'); g.fillStyle='blue'; g.fillRect(0,0,800,600); const d=c.toDataURL('image/png'); localStorage.setItem('malachite:dragprojects', JSON.stringify([{id:'dFlow',title:'flowtest',img:d,thumb:d,w:800,h:600,docSize:{w:800,h:600},createdAt:1}])); return 'ok'; })()"))
    send("Page.navigate",url="http://localhost:3000/project?id=dFlow")
    time.sleep(6)
    for _ in range(30):
        if js("(()=>{try{return !!(window.Konva&&Konva.stages[0]&&Konva.stages[0].find('Image').length)}catch(e){return false}})()"): break
        time.sleep(1)
    rect = js("(() => { const r=Konva.stages[0].content.getBoundingClientRect(); return JSON.stringify({x:r.x,y:r.y,w:r.width,h:r.height}); })()")
    b=json.loads(rect)
    def at(fx,fy): return (b["x"]+b["w"]*fx, b["y"]+b["h"]*fy)
    def inp(t,x,y,btn="left"):
        send("Input.dispatchMouseEvent",type=t,x=round(x),y=round(y),button=btn if t!="mouseMoved" else "none",buttons=1 if t in ("mousePressed","mouseMoved") else 0,clickCount=1)
    def drag(fx0,fy0,fx1,fy1):
        x0,y0=at(fx0,fy0); x1,y1=at(fx1,fy1)
        inp("mouseMoved", x0,y0); inp("mousePressed", x0,y0)
        for k in range(1,21): inp("mouseMoved", x0+(x1-x0)*k/20, y0+(y1-y0)*k/20)
        time.sleep(0.1); inp("mouseReleased", x1,y1); time.sleep(0.7)
    def pick(name):
        r=js("""(async()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='%s'||(x.getAttribute('title')||'').includes('%s'));if(!b)return 'no btn';b.click();return 'picked';})()""" % (name,name))
        print("tool",name,":",r); time.sleep(0.3)
    pick("画笔")
    drag(0.15,0.30, 0.85,0.30)   # stroke1 across at 30% height
    drag(0.15,0.70, 0.85,0.70)   # stroke2 at 70%
    pick("橡皮")
    drag(0.15,0.30, 0.40,0.30)   # erase left part of stroke1
    r = js("""(async () => {
      const st=Konva.stages[0];
      const url = st.toDataURL({ pixelRatio: 1/st.scaleX() });
      const img = new Image(); await new Promise(r=>{img.onload=r;img.src=url;});
      const c=document.createElement('canvas'); c.width=img.naturalWidth; c.height=img.naturalHeight;
      const g=c.getContext('2d',{willReadFrequently:true}); g.drawImage(img,0,0);
      const px=(fx,fy)=>[...g.getImageData(Math.round(fx*(img.naturalWidth-1)),Math.round(fy*(img.naturalHeight-1)),1,1).data];
      const d=JSON.parse(localStorage.getItem('malachite:project:dFlow')||'{}');
      const shapes=(d.layers||[]).map(l=>({layer:l.id,n:l.shapes.length,acts:l.shapes.map(s=>s.kind+(s.composite?':'+s.composite:''))}));
      return JSON.stringify({doc:img.naturalWidth+'x'+img.naturalHeight,
        s1_erased:px(0.25,0.30), s1_kept:px(0.65,0.30), s2:px(0.5,0.70), blank:px(0.5,0.05),
        layers:shapes}, null, 1);
    })()""")
    print("RESULT:", r)
    # panel: strokes must collapse into ONE "笔迹" row, not per-stroke 线条 rows
    panel = js("""(() => { const rows=[...document.querySelectorAll('aside div')].filter(d=>/笔迹|线条|图片|形状|文字/.test(d.textContent||'')&&d.children.length&&d.className.includes&&String(d.className).includes('text-[11px]')); return JSON.stringify([...new Set(rows.map(d=>d.textContent.trim().slice(0,20)))]); })()""")
    print("PANEL:", panel)
    # reopen the project fresh to confirm persistence of strokes
    send("Page.navigate",url="http://localhost:3000/projects"); time.sleep(3)
    send("Page.navigate",url="http://localhost:3000/project?id=dFlow"); time.sleep(6)
    r2 = js("""(() => { const d=JSON.parse(localStorage.getItem('malachite:project:dFlow')||'{}');
      const lines=(d.layers||[]).flatMap(l=>l.shapes).filter(s=>s.kind==='line');
      return JSON.stringify({lines:lines.map(l=>l.composite+' w'+l.strokeWidth+' pts'+(l.points.length/2))}); })()""")
    print("RELOAD:", r2)
finally:
    proc.terminate()
