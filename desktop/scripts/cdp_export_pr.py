# Does stage.toDataURL at current zoom leak scale into export size?
import json, time, os, subprocess
import websocket
PORT = 9355
UA = os.path.expandvars(r"%LOCALAPPDATA%\Temp\malachite-cdp-exp3")
chrome = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
if not os.path.exists(chrome): chrome = r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
BASE = "http://localhost:8899"
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
    p=btn("＋ 新建画布"); click(p["x"],p["y"]); time.sleep(1.5)
    # choose 1024x1024 preset if exists, else 创建
    v=js("""(() => { const els=[...document.querySelectorAll('button')].filter(b=>/1024/.test(b.textContent)); if(els.length){const r=els[0].getBoundingClientRect();return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2,t:els[0].textContent});} return null; })()""")
    if v:
        p=json.loads(v); print("preset:", p["t"]); click(p["x"],p["y"]); time.sleep(0.5)
    for l in ("创建","确定"):
        p=btn(l)
        if p: click(p["x"],p["y"]); break
    time.sleep(3)
    print("docSize in URL page:", js("document.title"))
    r=js("""(async () => {
      const st=Konva.stages[0];
      const zoom=st.scaleX();
      const d=st.toDataURL({pixelRatio:1/st.scaleX(),mimeType:'image/png'});
      const img=new Image(); await new Promise(r=>{img.onload=r;img.src=d;});
      // content bounds: measure alpha>0
      const c=document.createElement('canvas'); c.width=img.width;c.height=img.height;
      const g=c.getContext('2d'); g.drawImage(img,0,0);
      const dat=g.getImageData(0,0,c.width,c.height).data;
      let minX=1e9,minY=1e9,maxX=-1,maxY=-1;
      for(let y=0;y<c.height;y+=4)for(let x=0;x<c.width;x+=4){ if(dat[(y*c.width+x)*4+3]>10){if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;} }
      return JSON.stringify({zoom:+zoom.toFixed(3), exported:{w:img.width,h:img.height}, nonBlankBounds:{minX,minY,maxX,maxY}});
    })()""")
    print("export probe:", r)
finally:
    proc.terminate()
