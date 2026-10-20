# E2E: project with images -> rect-select a region -> click 裁成新文件 -> assert downloaded file = selection bbox size & content
import json, time, os, base64, subprocess
import websocket
from PIL import Image
import io
import urllib.request

PORT = 9337
UA = os.path.expandvars(r"%LOCALAPPDATA%\Temp\malachite-cdp-marquee")
chrome = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
if not os.path.exists(chrome): chrome = r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
proc = subprocess.Popen([chrome,"--headless=new","--window-size=1440,900",f"--remote-debugging-port={PORT}","--remote-allow-origins=*","--no-sandbox",f"--user-data-dir={UA}","about:blank"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
try:
    page = None
    for _ in range(40):
        try:
            pages = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/list", timeout=2).read())
            page = next(p for p in pages if p["type"] == "page")
            break
        except Exception:
            time.sleep(0.5)
    ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=30, suppress_origin=True)
    _i = [0]
    def send(method, **params):
        _i[0] += 1
        ws.send(json.dumps({"id": _i[0], "method": method, "params": params}))
        while True:
            msg = json.loads(ws.recv())
            if msg.get("id") == _i[0]:
                if "error" in msg: raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result", {})
    def js(expr):
        r = send("Runtime.evaluate", expression=expr, returnByValue=True, awaitPromise=True)
        exc = r.get("exceptionDetails")
        if exc: raise RuntimeError("JS: " + json.dumps(exc)[:400])
        return r["result"].get("value")
    send("Runtime.enable"); send("Page.enable")
    msgs = []
    def onmsg(m):
        if m.get("method") == "Runtime.consoleAPICalled" and m["params"]["type"] in ("error","warning"):
            msgs.append(" ".join(str(a.get("value", a.get("description","")))[:120] for a in m["params"]["args"]))
        if m.get("method") == "Runtime.exceptionThrown":
            msgs.append("EXC " + str(m["params"]["exceptionDetails"].get("exception",{}).get("description",""))[:200])
    _orig_send = send
    def send2(method, **params):
        _i[0] += 1
        ws.send(json.dumps({"id": _i[0], "method": method, "params": params}))
        while True:
            msg = json.loads(ws.recv())
            onmsg(msg)
            if msg.get("id") == _i[0]:
                if "error" in msg: raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result", {})
    send = send2
    send("Page.navigate", url="http://localhost:3000/project?id=cdp-marquee")
    time.sleep(7)
    # fresh state: clear then drop 2 images (bg navy 600x400 at doc 0,0; red 150x100 at 100,80)
    js("localStorage.clear(); 'ok'")
    send("Page.navigate", url="http://localhost:3000/project?id=cdp-marquee")
    time.sleep(6)
    r = js("""(async () => {
      const mk = async (color, w, h, name) => {
        const c = document.createElement('canvas'); c.width=w; c.height=h;
        g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0,0,w,h);
        const b = await new Promise(r=>c.toBlob(r,'image/png'));
        return new File([b], name, {type: 'image/png'});
      };
      const vp = document.querySelector('.konvajs-content').closest('div.relative')||document.querySelector('.konvajs-content').parentElement;
      window.__droplog=[]; window.addEventListener('drop',e=>window.__droplog.push('win:'+e.target.tagName+'.'+(e.target.className||'').toString().slice(0,40)+' files='+e.dataTransfer.files.length),true);
      const drop = async (f, cx, cy) => {
        const dt = new DataTransfer(); dt.items.add(f);
        for (const type of ['dragenter','dragover','drop'])
          vp.dispatchEvent(new DragEvent(type,{bubbles:true,cancelable:true,composed:true,dataTransfer:dt,clientX:cx,clientY:cy}));
        await new Promise(r => setTimeout(r, 900));
      };
      const probe = () => { for (const type of ['dragenter']) vp.dispatchEvent(new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:new DataTransfer(),clientX:100,clientY:100})); };
      window.__probe = () => { probe(); return new Promise(r=>setTimeout(()=>{ const ov = [...document.querySelectorAll('div')].some(d=>d.className.includes('border-dashed')); for (const t of ['dragleave','drop']) vp.dispatchEvent(new DragEvent(t,{bubbles:true,cancelable:true,dataTransfer:new DataTransfer(),clientX:100,clientY:100})); r(ov ? 'react-drop-handler-ALIVE' : 'react-handler-NOT-firing'); },200)); };
      const vc = document.querySelector('.konvajs-content').closest('div.relative').getBoundingClientRect();
      const cx = vc.x + vc.width/2, cy = vc.y + vc.height/2;
      await drop(await mk('#0a1428', 600, 400, 'bg.png'), cx, cy);
      window.__n1 = Konva.stages[0].find('Image').length;
      await drop(await mk('#ff0000', 300, 200, 'face.png'), cx, cy);
      await new Promise(r => setTimeout(r, 800));
      const st = Konva.stages[0];
      const imgs = st.find('Image');
      if (imgs.length >= 3) {
        imgs[imgs.length-2].position({x: 600, y: 300}); imgs[imgs.length-2].scale({x: 1, y: 1});   // navy 600x400 → covers sel region
        imgs[imgs.length-1].position({x: 700, y: 400}); imgs[imgs.length-1].scale({x: 0.5, y: 0.5}); // red 150x100 inside
        st.batchDraw();
      }
      return 'imgs=' + imgs.length + ' after1=' + window.__n1 + ' vpcls=' + (document.querySelector('.konvajs-content').closest('div.relative')? 'has-relative':'NO-relative, parent=' + document.querySelector('.konvajs-content').parentElement.className).slice(0,120);
    })()""")
    print("seed:", r)
    print("probe:", js("window.__probe()"))
    print("droplog:", js("JSON.stringify(window.__droplog)"))
    js("window.__dl=null; window.__grab=0; const oc=URL.createObjectURL; URL.createObjectURL=function(b){ if(window.__grab) window.__dl=b; return oc.call(URL,b); };")
    # switch to rect selection tool
    r = js("""(() => { const b=[...document.querySelectorAll('button')].find(b=>/矩形选区/.test(b.title||'')); if(b){b.click(); return 'rect tool';} return 'no rect btn'; })()""")
    print("tool:", r)
    t = js("""(() => { const st=Konva.stages[0]; const r=st.container().getBoundingClientRect(); return {scale: st.scaleX(), x: st.x(), y: st.y(), l: r.left, t: r.top}; })()""")
    sc, ox, oy = t["scale"], t["x"], t["y"]
    def d2c(dx, dy): return t["l"] + ox + dx*sc, t["t"] + oy + dy*sc
    # marquee doc (80,60)-(280,220) → expect crop 200x160, contains red block (100..250,80..180)
    x1,y1 = d2c(600,300); x2,y2 = d2c(1000,600)
    send("Input.dispatchMouseEvent", type="mouseMoved", x=int(x1), y=int(y1), buttons=1)
    send("Input.dispatchMouseEvent", type="mousePressed", x=int(x1), y=int(y1), button="left", clickCount=1, buttons=1)
    for f in (0.3,0.6,1.0):
        send("Input.dispatchMouseEvent", type="mouseMoved", x=int(x1+(x2-x1)*f), y=int(y1+(y2-y1)*f), button="left", buttons=1)
        time.sleep(0.05)
    send("Input.dispatchMouseEvent", type="mouseReleased", x=int(x2), y=int(y2), button="left", clickCount=1, buttons=0)
    time.sleep(0.8)
    print("selbar:", js("""(() => { const s=[...document.querySelectorAll('span')].map(e=>e.textContent).find(t=>/选区 \\d+×\\d+/.test(t||'')); return s||'no sel'; })()"""))
    r = js("""(() => { const b=[...document.querySelectorAll('button')].find(b=>/裁成新文件/.test(b.textContent)); if(b){window.__grab=1; b.click(); return 'clicked';} return 'no crop-file btn'; })()""")
    print("crop:", r)
    time.sleep(2)
    meta = js("""(async () => { if(!window.__dl) return null; const buf = await window.__dl.arrayBuffer(); const u=new Uint8Array(buf); let s=''; for(let i=0;i<u.length;i+=8192) s+=String.fromCharCode.apply(null,u.subarray(i,i+8192)); return JSON.stringify({size:u.length,b64:btoa(s)}); })()""")
    if not meta:
        print("FAIL: no download captured")
    else:
        m = json.loads(meta)
        im = Image.open(io.BytesIO(base64.b64decode(m["b64"])));
        im.save(r"D:\projects\malachite\desktop\scripts\shot_crop.png")
        print("crop file:", im.size, "bytes:", m["size"])
        # 期望 200x160；选区内(相对 20..170, 20..120)是红块，四角是深蓝底
        print("red@ (120,120):", im.getpixel((120,120)), "navy@ (20,20):", im.getpixel((20,20)))
        
    # project untouched: layer count still 2 (+none)
    print("layers now:", js("""(() => { const raw=localStorage.getItem('malachite:project:cdp-marquee'); if(!raw) return 'no autosave yet'; try{ const d=JSON.parse(raw); return (d.layers||d).length + ' layers'; }catch(e){ return 'parse? '+raw.slice(0,60); } })()"""))
finally:
    print('CONSOLE:', msgs[:6]); proc.terminate()
