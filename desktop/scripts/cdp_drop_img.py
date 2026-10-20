# E2E: drag an image file onto the canvas viewport -> expect new image layer on top.
import json, time, base64, urllib.request, subprocess, os, sys, tempfile
import websocket

PORT = 9348
UA = os.path.expandvars(r"%LOCALAPPDATA%\Temp\malachite-cdp-drop5")
chrome = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
if not os.path.exists(chrome):
    chrome = r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
proc = subprocess.Popen([chrome, "--headless=new", f"--remote-debugging-port={PORT}",
    "--remote-allow-origins=*", "--no-sandbox", f"--user-data-dir={UA}"],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    tab = None
    for _ in range(30):
        try:
            tabs = [t for t in json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/list")) if t["type"]=="page"]
            if tabs: tab = tabs[0]; break
        except Exception: time.sleep(0.5)
    ws = websocket.create_connection(tab["webSocketDebuggerUrl"], timeout=60)
    _id=[0]
    def send(m, **p):
        _id[0]+=1
        ws.send(json.dumps({"id":_id[0],"method":m,"params":p}))
        while True:
            msg=json.loads(ws.recv())
            if msg.get("id")==_id[0]:
                if "error" in msg: raise RuntimeError(msg["error"])
                return msg.get("result",{})
    def js(e):
        r=send("Runtime.evaluate", expression=e, returnByValue=True, awaitPromise=True)
        if r.get("exceptionDetails"): return "JSERR:"+json.dumps(r["exceptionDetails"].get("exception",{}).get("description",""))[:300]
        return r.get("result",{}).get("value")
    def click(x,y):
        for t in ("mousePressed","mouseReleased"):
            send("Input.dispatchMouseEvent", type=t, x=float(x), y=float(y), button="left", clickCount=1, buttons=1 if t=="mousePressed" else 0)
    def btn(label):
        v=js("(() => { const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()=== %s); if(!b)return null; const r=b.getBoundingClientRect(); return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2}); })()" % json.dumps(label))
        return json.loads(v) if v else None

    send("Page.enable")
    send("Emulation.setDeviceMetricsOverride", width=1600, height=1000, deviceScaleFactor=1, mobile=False)
    send("Page.navigate", url="http://localhost:3000/")
    time.sleep(5)
    p=btn("＋ 新建画布"); click(p["x"],p["y"]); time.sleep(2)
    for l in ("创建","确定","开始"):
        p=btn(l)
        if p: click(p["x"],p["y"]); break
    time.sleep(3)

    # layers before
    before = js("Konva.stages[0] ? Konva.stages[0].find('Image').length : 'NO_STAGE'")
    print("0. Image nodes on stage before drop:", before)

    # 1) does a native dragover even reach the viewport div? counter test
    js("""window.__c={enter:0,over:0,drop:0};
      const vp=document.querySelector('.konvajs-content').closest('div.relative')||document.querySelector('.konvajs-content').parentElement;
      window.__vp=vp;
      vp.addEventListener('dragenter',()=>window.__c.enter++);
      vp.addEventListener('dragover',e=>window.__c.over++);
      vp.addEventListener('drop',e=>window.__c.drop++);
      'ok'""")

    # 2) synthesize a real File and dispatch dragenter/dragover/drop with it
    r = js("""(async () => {
      const c=document.createElement('canvas'); c.width=400; c.height=300;
      const g=c.getContext('2d'); g.fillStyle='#e33'; g.fillRect(0,0,400,300); g.fillStyle='#fff'; g.fillRect(50,50,300,200);
      const blob = await new Promise(r=>c.toBlob(r,'image/png'));
      const file = new File([blob],'拖入测试.png',{type:'image/png'});
      const dt = new DataTransfer(); dt.items.add(file);
      const rect = window.__vp.getBoundingClientRect();
      const x = rect.x+rect.width/2, y = rect.y+rect.height/2;
      for (const type of ['dragenter','dragover','drop']) {
        const ev = new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:dt,clientX:x,clientY:y});
        const notCancelled = window.__vp.dispatchEvent(ev);
        if (type==='drop') window.__dropDefaultPrevented = !notCancelled;
      }
      return JSON.stringify({counters:window.__c, dropDefaultPrevented:window.__dropDefaultPrevented});
    })()""")
    print("1. synthetic drop:", r)
    time.sleep(2)
    after = js("""(() => { const imgs=Konva.stages[0].find('Image');
      const layers = imgs.map(n=>({x:Math.round(n.x()),y:Math.round(n.y()),w:Math.round(n.width()),h:Math.round(n.height())}));
      return JSON.stringify({count:imgs.length, layers}); })()""")
    print("2. Image nodes after drop (expect +1, ~400x300 scaled):", after)
    lay = js("""(() => { const id=new URLSearchParams(location.search).get('id');
      const st=JSON.parse(localStorage.getItem('malachite:project:'+id)||'null');
      if(!st) return 'NO_SAVE';
      return JSON.stringify(st.layers.map(l=>({name:l.name, kinds:l.shapes.map(s=>s.kind)}))); })()""")
    print("3. saved layers:", lay)
finally:
    proc.terminate()
