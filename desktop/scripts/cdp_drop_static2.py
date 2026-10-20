# Repro on the PACKAGED static export (same as the exe serves): blank canvas -> drop image.
import json, time, os, subprocess
import websocket
PORT = 9352
UA = os.path.expandvars(r"%LOCALAPPDATA%\Temp\malachite-cdp-static2")
chrome = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
if not os.path.exists(chrome): chrome = r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
BASE = "http://localhost:8899"
proc = subprocess.Popen([chrome,"--headless=new",f"--remote-debugging-port={PORT}","--remote-allow-origins=*","--no-sandbox",f"--user-data-dir={UA}","about:blank"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
logs=[]
try:
    import urllib.request as U
    tab=None
    for _ in range(40):
        try:
            tabs=[t for t in json.load(U.urlopen(f"http://127.0.0.1:{PORT}/json/list",timeout=2)) if t["type"]=="page"]
            if tabs: tab=tabs[0]; break
        except Exception: time.sleep(0.5)
    ws=websocket.create_connection(tab["webSocketDebuggerUrl"],timeout=60)
    _id=[0]
    def send(m,**p):
        _id[0]+=1
        ws.send(json.dumps({"id":_id[0],"method":m,"params":p}))
        while True:
            msg=json.loads(ws.recv())
            if msg.get("method")=="Runtime.exceptionThrown":
                logs.append("EXC:"+json.dumps(msg["params"]["exceptionDetails"].get("exception",{}).get("description",""))[:300])
            if msg.get("id")==_id[0]:
                if "error" in msg: raise RuntimeError(msg["error"])
                return msg.get("result",{})
    def js(e):
        r=send("Runtime.evaluate",expression=e,returnByValue=True,awaitPromise=True)
        if r.get("exceptionDetails"): return "JSERR:"+str(r["exceptionDetails"].get("exception",{}).get("description",""))[:200]
        return r.get("result",{}).get("value")
    def click(x,y):
        for t in ("mousePressed","mouseReleased"):
            send("Input.dispatchMouseEvent",type=t,x=float(x),y=float(y),button="left",clickCount=1,buttons=1 if t=="mousePressed" else 0)
    def btn(label):
        v=js("(() => { const b=[...document.querySelectorAll('button,a')].find(b=>b.textContent.trim()=== %s); if(!b)return null; const r=b.getBoundingClientRect(); return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2}); })()" % json.dumps(label))
        return json.loads(v) if v else None
    send("Page.enable"); send("Runtime.enable")
    send("Emulation.setDeviceMetricsOverride",width=1600,height=1000,deviceScaleFactor=1,mobile=False)
    send("Page.navigate",url=BASE+"/")
    time.sleep(4)
    p=btn("＋ 新建画布")
    print("new-canvas btn:", p is not None); click(p["x"],p["y"]); time.sleep(1.5)
    # dialog: find 创建 button
    for l in ("创建","确定","开始"):
        p=btn(l)
        if p:
            print("dialog btn:", l); click(p["x"],p["y"]); break
    time.sleep(3)
    print("url now:", js("location.href"))
    print("stage exists:", js("!!(window.Konva && Konva.stages.length)"))
    print("layers before:", js("""Konva.stages.length ? Konva.stages[0].getChildren().map(c=>c.getChildren().map(k=>k.getClassName())) : 'NO_STAGE'"""))
    r=js("""(async () => {
      const c=document.createElement('canvas'); c.width=400; c.height=300;
      const g=c.getContext('2d'); g.fillStyle='#e33'; g.fillRect(0,0,400,300);
      const blob=await new Promise(r=>c.toBlob(r,'image/png'));
      const file=new File([blob],'拖入测试.png',{type:'image/png'});
      const dt=new DataTransfer(); dt.items.add(file);
      const vp=document.querySelector('.konvajs-content').parentElement;
      const rect=vp.getBoundingClientRect();
      const x=rect.x+rect.width/2, y=rect.y+rect.height/2;
      for (const type of ['dragenter','dragover','drop']) vp.dispatchEvent(new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:dt,clientX:x,clientY:y}));
      await new Promise(r=>setTimeout(r,1500));
      const st=Konva.stages[0];
      return JSON.stringify({images: st.find('Image').length});
    })()""")
    print("after drop:", r)
    # which layer holds the image? order in canvas + panel
    print("layer stack (canvas order, last=top):", js("Konva.stages[0].getChildren().map((c,i)=>i+':'+c.getChildren().map(k=>k.getClassName()+(k.getClassName()==='Image'?'@'+Math.round(k.x())+','+Math.round(k.y())+' '+k.width()+'x'+k.height():'')).join('+'))"))
    print("panel order (top first):", js("""(() => { const rows=[...document.querySelectorAll('*')].filter(e=>e.childElementCount===0 && /拖入测试/.test(e.textContent)); return rows.length; })()"""))
    print("save:", js("""(() => { const id=new URLSearchParams(location.search).get('id'); const st=JSON.parse(localStorage.getItem('malachite:project:'+id)||'null'); return st?JSON.stringify(st.layers.map(l=>({n:l.name,k:l.shapes.map(s=>s.kind)}))):'NO_SAVE'; })()"""))
    shot=send("Page.captureScreenshot", format="png")
    import base64
    open('desktop/scripts/shot_drop.png','wb').write(base64.b64decode(shot['data']))
    print("exceptions:", json.dumps(logs[-5:], ensure_ascii=False))
finally:
    proc.terminate()
