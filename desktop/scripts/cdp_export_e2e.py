# E2E: new 1024x1024 canvas -> drop red image -> click 导出PNG -> assert exported file is docSize 1:1 with full content
import json, time, os, subprocess
import websocket
PORT = 9357
UA = os.path.expandvars(r"%LOCALAPPDATA%\Temp\malachite-cdp-e2e2")
chrome = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
if not os.path.exists(chrome): chrome = r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
BASE = "http://localhost:3000"
proc = subprocess.Popen([chrome,"--headless=new",f"--remote-debugging-port={PORT}","--remote-allow-origins=*","--no-sandbox",f"--user-data-dir={UA}","about:blank"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
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
    def elpos(sel_expr):
        v=js(sel_expr)
        return json.loads(v) if v else None
    def btn(label):
        return elpos("(() => { const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim().includes(%s)); if(!b)return null; const r=b.getBoundingClientRect(); return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2}); })()" % json.dumps(label))
    send("Page.enable"); send("Runtime.enable")
    send("Emulation.setDeviceMetricsOverride",width=1600,height=1000,deviceScaleFactor=1,mobile=False)
    send("Page.navigate",url=BASE+"/")
    time.sleep(4)
    # intercept downloads: capture blob url instead of clicking through
    js("window.__dl=null; window.__blobs=new Map(); const ooc=URL.createObjectURL; URL.createObjectURL=function(b){const u=ooc.call(URL,b); if(b instanceof Blob) window.__blobs.set(u,b); return u;}; const oc=HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click=function(){ if(this.download){window.__dl={href:this.href,name:this.download}; return;} return oc.call(this); }; 'ok'")
    p=btn("＋ 新建画布"); click(p["x"],p["y"]); time.sleep(1.5)
    p=elpos("""(() => { const els=[...document.querySelectorAll('button')].filter(b=>/1024/.test(b.textContent)); if(els.length){const r=els[0].getBoundingClientRect();return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2});} return null; })()""")
    if p: click(p["x"],p["y"]); time.sleep(0.5)
    p=btn("创建")
    if p: click(p["x"],p["y"])
    time.sleep(3)
    # drop image at center
    r=js("""(async () => {
      const c=document.createElement('canvas'); c.width=400; c.height=300;
      const g=c.getContext('2d'); g.fillStyle='#e33'; g.fillRect(0,0,400,300);
      const dt=new DataTransfer(); dt.items.add(new File([await new Promise(r=>c.toBlob(r,'image/png'))],'t.png',{type:'image/png'}));
      const vp=document.querySelector('.konvajs-content').parentElement;
      const rect=vp.getBoundingClientRect();
      for (const type of ['dragenter','dragover','drop']) vp.dispatchEvent(new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:dt,clientX:rect.x+rect.width/2,clientY:rect.y+rect.height/2}));
      await new Promise(r=>setTimeout(r,1200));
      return JSON.stringify({images:Konva.stages[0].find('Image').length, zoom:+Konva.stages[0].scaleX().toFixed(3)});
    })()""")
    print("1. drop:", r)
    # click 导出 -> menu -> PNG
    p=btn("导出"); click(p["x"],p["y"]); time.sleep(0.8)
    p=elpos("""(() => { const b=[...document.querySelectorAll('button')].find(b=>/PNG/i.test(b.textContent)&&b.getBoundingClientRect().width<300); if(!b)return null; const r=b.getBoundingClientRect(); return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2,t:b.textContent.trim()}); })()""")
    print("2. png menu item:", p)
    if p: click(p["x"],p["y"])
    time.sleep(2.5)
    r=js("""(async () => {
      if(!window.__dl) return 'NO_DOWNLOAD';
      const blob=window.__blobs.get(window.__dl.href);
      const img=await new Promise(r=>{const i=new Image(); i.onload=()=>r(i); i.src=URL.createObjectURL(blob);});
      const c=document.createElement('canvas'); c.width=img.naturalWidth;c.height=img.naturalHeight;
      const g=c.getContext('2d'); g.drawImage(img,0,0);
      const dat=g.getImageData(0,0,c.width,c.height).data;
      // red pixel check at expected center region
      let red=0; for(let i=0;i<dat.length;i+=4000){ if(dat[i]>180&&dat[i+1]<80&&dat[i+2]<80) red++; }
      return JSON.stringify({name:window.__dl.name, bytes:blob.size, w:img.naturalWidth, h:img.naturalHeight, redSamples:red});
    })()""")
    print("3. exported file (expect 1024x1024 with red content):", r)
finally:
    proc.terminate()
