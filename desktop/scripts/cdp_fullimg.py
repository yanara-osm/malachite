# E2E: drag a 2400x1600 image onto home page -> project opens at FULL size (no 1024 downscale)
import json, time, os, subprocess
import websocket
PORT = 9361
UA = os.path.expandvars(r"%LOCALAPPDATA%\Temp\malachite-cdp-fullimg")
chrome = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
if not os.path.exists(chrome): chrome = r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
proc = subprocess.Popen([chrome,"--headless=new","--window-size=1440,900",f"--remote-debugging-port={PORT}","--remote-allow-origins=*","--no-sandbox",f"--user-data-dir={UA}","about:blank"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
try:
    tab=None
    for _ in range(40):
        try:
            tabs=[t for t in json.load(__import__("urllib.request",fromlist=["x"]).urlopen(f"http://127.0.0.1:{PORT}/json/list",timeout=2)) if t["type"]=="page"]
            if tabs: tab=tabs[0]; break
        except Exception: time.sleep(0.5)
    ws = websocket.create_connection(tab["webSocketDebuggerUrl"], timeout=60, suppress_origin=True)
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
        if r.get("exceptionDetails"): raise RuntimeError("JS: "+json.dumps(r["exceptionDetails"])[:300])
        return r["result"].get("value")
    send("Runtime.enable"); send("Page.enable")
    import sys
    url = sys.argv[1] if len(sys.argv)>1 else "http://localhost:3000/"
    send("Page.navigate",url=url)
    time.sleep(6)
    # synthesize drop of a 2400x1600 PNG on the logo drop zone (home page)
    if len(sys.argv)<=1:
        r = js("""(async () => {
          const c=document.createElement('canvas'); c.width=2400; c.height=1600;
          const g=c.getContext('2d'); g.fillStyle='#123456'; g.fillRect(0,0,2400,1600);
          const blob = await new Promise(r=>c.toBlob(r,'image/png'));
          const file = new File([blob],'四K大图.png',{type:'image/png'});
          const dt = new DataTransfer(); dt.items.add(file);
          const target = document.querySelector('img[alt="孔雀翎"]')?.parentElement || document.body;
          for (const t of ['dragenter','dragover','drop'])
            target.dispatchEvent(new DragEvent(t,{bubbles:true,cancelable:true,dataTransfer:dt,clientX:400,clientY:300}));
          await new Promise(r=>setTimeout(r,2500));
          return location.href;
        })()""")
        print("after drop, location:", r)
    if len(sys.argv)>1:
        r = js("location.href")
    time.sleep(6)
    # canvas docSize + base image natural size must be 2400x1600
    r = js("""(async () => {
      for (let i=0;i<40;i++) { if (window.Konva && Konva.stages.length) break; await new Promise(r=>setTimeout(r,300)); }
      const st = Konva.stages[0];
      const imgs = st.find('Image');
      const big = imgs.map(n=>({nw:n.width(), nh:n.height(), src:(n.getAttr('image')? n.getAttr('image').naturalWidth||n.getAttr('image').width : -1), loaded: !!n.getAttr('image')}));
      return JSON.stringify(big);
    })()""")
    print("image nodes:", r)
    docs = js("""(() => { const st=Konva.stages[0]; return JSON.stringify({w: st.findOne(n=>n.getClassName()==='Layer') ? undefined : undefined}); })()""")
    autosave = js("""(() => { const keys=Object.keys(localStorage).filter(k=>k.startsWith('malachite:project:')); return JSON.stringify(keys.map(k=>{const d=JSON.parse(localStorage.getItem(k)); return {key:k, doc:d.docSize, srcTypes:(d.layers||[]).flatMap(l=>l.shapes.map(s=>s.src?s.src.slice(0,8):null))};})); })()""")
    print("autosave:", autosave)
finally:
    proc.terminate()
