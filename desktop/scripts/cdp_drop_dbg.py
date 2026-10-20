# Same synthetic drop, but capture console errors + instrument the handler path.
import json, time, os, subprocess
import websocket
PORT = 9344
UA = os.path.expandvars(r"%LOCALAPPDATA%\Temp\malachite-cdp-drop4")
chrome = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
if not os.path.exists(chrome): chrome = r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
proc = subprocess.Popen([chrome,"--headless=new",f"--remote-debugging-port={PORT}","--remote-allow-origins=*","--no-sandbox",f"--user-data-dir={UA}","about:blank"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
try:
    import urllib.request as U
    tab=None
    for _ in range(40):
        try:
            tabs=[t for t in json.load(U.urlopen(f"http://127.0.0.1:{PORT}/json/list",timeout=2)) if t["type"]=="page"]
            if tabs: tab=tabs[0]; break
        except Exception: time.sleep(0.5)
    if tab is None:
        tab=json.loads(U.urlopen(U.Request(f"http://127.0.0.1:{PORT}/json/new?about%3Ablank",method="PUT"),timeout=5).read())
    ws=websocket.create_connection(tab["webSocketDebuggerUrl"],timeout=60)
    _id=[0]; logs=[]
    def send(m,**p):
        _id[0]+=1
        ws.send(json.dumps({"id":_id[0],"method":m,"params":p}))
        while True:
            msg=json.loads(ws.recv())
            if msg.get("method")=="Runtime.consoleAPICalled":
                logs.append(" ".join(str(a.get("value","")) for a in msg["params"]["args"]))
            if msg.get("method")=="Runtime.exceptionThrown":
                logs.append("EXC:"+json.dumps(msg["params"]["exceptionDetails"].get("exception",{}).get("description",""))[:500])
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
        v=js("(() => { const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()=== %s); if(!b)return null; const r=b.getBoundingClientRect(); return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2}); })()" % json.dumps(label))
        return json.loads(v) if v else None
    send("Page.enable"); send("Runtime.enable")
    send("Emulation.setDeviceMetricsOverride",width=1600,height=1000,deviceScaleFactor=1,mobile=False)
    send("Page.navigate",url="http://localhost:3000/")
    time.sleep(5)
    p=btn("＋ 新建画布"); click(p["x"],p["y"]); time.sleep(2)
    for l in ("创建","确定","开始"):
        p=btn(l)
        if p: click(p["x"],p["y"]); break
    time.sleep(3)
    # check: does stage ref exist? React state aside, test the exact calls the handler makes
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
      let grp='';
      try { grp = JSON.stringify(st.findOne('Layer').children.map(ch=>ch.getClassName())); } catch(e){ grp='ERR:'+e.message; }
      return JSON.stringify({images:st.find('Image').length, stage:st ? {x:st.x(),y:st.y(),scale:st.scaleX(),w:st.width(),h:st.height()} : null, children:grp});
    })()""")
    print("after drop:", r)
    print("console/exceptions:", json.dumps(logs[-10:], ensure_ascii=False, indent=1))
finally:
    proc.terminate()
