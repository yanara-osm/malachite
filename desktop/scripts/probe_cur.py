import json, time, os, subprocess, urllib.request
import websocket
PORT = 9365
UA = os.path.expandvars(r"%LOCALAPPDATA%\Temp\malachite-cdp-cursor4")
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
        if r.get("exceptionDetails"): return "ERR:"+json.dumps(r["exceptionDetails"].get("exception",{}).get("description",""))[:200]
        return r["result"].get("value")
    send("Runtime.enable"); send("Page.enable")
    send("Page.navigate",url="http://localhost:3000/projects"); time.sleep(4)
    js("(() => { const c=document.createElement('canvas'); c.width=800; c.height=600; const g=c.getContext('2d'); g.fillStyle='#7ec8ff'; g.fillRect(0,0,800,600); const d=c.toDataURL('image/png'); localStorage.setItem('malachite:dragprojects', JSON.stringify([{id:'dCur',title:'cur',img:d,thumb:d,w:800,h:600,docSize:{w:800,h:600},createdAt:1}])); return 'ok'; })()")
    send("Page.navigate",url="http://localhost:3000/project?id=dCur")
    time.sleep(6)
    for _ in range(30):
        if js("(()=>{try{return !!(window.Konva&&Konva.stages[0]&&Konva.stages[0].find('Image').length)}catch(e){return false}})()"): break
        time.sleep(1)
    print("tool:", js("""(async () => { const b=[...document.querySelectorAll('button')].find(x=>(x.getAttribute('title')||'').includes('画笔')||(x.textContent||'').trim()==='画笔'); if(!b) return 'no brush btn'; b.click(); await new Promise(r=>setTimeout(r,300)); return 'picked'; })()"""))
    rect = json.loads(js("(() => { const r=Konva.stages[0].content.getBoundingClientRect(); return JSON.stringify({x:r.x,y:r.y,w:r.width,h:r.height}); })()"))
    cx, cy = rect["x"]+rect["w"]/2, rect["y"]+rect["h"]/2
    send("Input.dispatchMouseEvent",type="mouseMoved",x=round(cx),y=round(cy),button="none",buttons=0)
    time.sleep(0.6)
    print("CURSOR:", js("""(() => {
      const st=Konva.stages[0];
      const zoom=st.scaleX();
      let cg=null;
      const gs=st.find('Group').toArray ? st.find('Group').toArray() : Array.from(st.find('Group'));
      for (const g of gs){ const ch=g.getChildren(); if(ch.length===6 && g.find('Circle').length===2 && g.find('Line').length===4){ cg=g; break; } }
      if(!cg) return 'NO cursor group';
      const cs=cg.find('Circle').toArray ? cg.find('Circle').toArray()[0] : Array.from(cg.find('Circle'))[0];
      const ls=cg.find('Line').toArray ? cg.find('Line').toArray()[0] : Array.from(cg.find('Line'))[0];
      const crossHalf=Math.abs(ls.points()[2]-ls.points()[0]);
      return JSON.stringify({ringR:cs.radius(), crossScreenPx:Math.round(crossHalf*2*zoom), cssCursor:getComputedStyle(st.container()).cursor});
    })()"""))
finally:
    proc.terminate()
