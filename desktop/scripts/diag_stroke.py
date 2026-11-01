import json, time, os, subprocess, urllib.request
import websocket
PORT=9387; CHROME=r"C:\Program Files\Google\Chrome\Application\chrome.exe"
UA=os.path.expandvars(r"%LOCALAPPDATA%\Temp\malachite-diag16")
p=subprocess.Popen([CHROME,"--headless=new","--window-size=1440,900",f"--remote-debugging-port={PORT}","--remote-allow-origins=*","--no-first-run","--no-default-browser-check","--no-sandbox",f"--user-data-dir={UA}","http://localhost:3000/"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
for _ in range(60):
    time.sleep(2)
    try:
        for t in json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/list")):
            if t.get("url","").endswith(":3000/"):
                ws=websocket.create_connection(t["webSocketDebuggerUrl"],max_size=50*1024*1024); break
        if "ws" in dir(): break
    except Exception: pass
_i=[0]
def call(m,**kw):
    _i[0]+=1; ws.send(json.dumps({"id":_i[0],"method":m,"params":kw}))
    while True:
        r=json.loads(ws.recv())
        if r.get("id")==_i[0]: return r.get("result",{})
def ev(e):
    r=call("Runtime.evaluate",expression=e,returnByValue=True)
    if r.get("exceptionDetails"):
        print("JSERR:", json.dumps(r["exceptionDetails"])[:500])
    return r["result"].get("value")
time.sleep(8)
ev("""(() => { localStorage.clear(); const c=document.createElement('canvas'); c.width=800; c.height=600; const g=c.getContext('2d'); g.clearRect(0,0,800,600); const d=c.toDataURL('image/png'); localStorage.setItem('malachite:dragprojects', JSON.stringify([{id:'dDg',title:'d',img:d,thumb:d,w:800,h:600,docSize:{w:800,h:600},createdAt:1}])); return 1; })()""")
ev("location.href='http://localhost:3000/project?id=dDg'")
time.sleep(6)
# pick brush via button click
print("pick:", ev("""(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='画笔'); if(!b) return 'no'; b.click(); return 'ok'; })()"""))
time.sleep(0.5)
print("sliders:", ev("""JSON.stringify([...document.querySelectorAll('label')].map(l=>l.firstChild.textContent.trim()).filter(t=>['大小','羽化','不透明度'].includes(t)))"""))
print("set:", ev("""(() => { for(const [lab,val] of [['大小','40'],['羽化','30']]){ const l=[...document.querySelectorAll('label')].find(x=>x.firstChild.textContent.trim()===lab); const i=l.querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,val); i.dispatchEvent(new Event('input',{bubbles:true})); } return 'ok'; })()"""))
st=ev("""(() => { const s=Konva.stages[0]; return JSON.stringify({w:s.width(),h:s.height(),scale:s.scaleX(),pos:s.position()}); })()""")
print("stage:", st)
# simulate a stroke via Konva pointer events directly on the stage using mouse
call("Input.dispatchMouseEvent",type="mouseMoved",x=400,y=300,buttons=0); time.sleep(0.2)
call("Input.dispatchMouseEvent",type="mousePressed",x=400,y=300,button="left",buttons=1,clickCount=1); time.sleep(0.1)
for i in range(15):
    call("Input.dispatchMouseEvent",type="mouseMoved",x=400+i*12,y=300,buttons=1); time.sleep(0.03)
call("Input.dispatchMouseEvent",type="mouseReleased",x=580,y=300,button="left",buttons=0); time.sleep(0.6)
print("layers shape counts:", ev("""JSON.stringify(Konva.stages[0].find('Layer').map((l,i)=>({i,n:l.children.length, lines:l.find('Line').length})))"""))
# scan canvas pixels
print("pixels:", ev("""JSON.stringify(Konva.stages[0].find('Layer').map((l,i)=>{const c=l.getCanvas()._canvas; const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data; let nz=0; for(let j=3;j<d.length;j+=4) if(d[j]>4)nz++; return {i,nz};}))"""))
# alpha profile: find the non-empty layer canvas, scan alpha around the stroke (y varying at x of center)
print("PROFILE:", ev("""(() => { const c=window.__cs ? null : null; const lays=Konva.stages[0].find('Layer'); let cc=null; for(const l of lays2){const cv=l.getCanvas()._canvas;const d=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;let nz=0;for(let j=3;j<d.length;j+=4)if(d[j]>4){nz++;if(nz>50){cc=cv;break;}}if(cc)break;}
 window.__cc=cc; const ctx=cc.getContext('2d');
 // locate peak alpha row by scanning a vertical line x=~300 (canvas coords; stage scale .972 and no offset -> screen x 400 => canvas ~411)
 function col(x){ const out=[]; const im=ctx.getImageData(x,0,1,cc.height).data; for(let y=0;y<cc.height;y++) out.push(im[y*4+3]); return out; }
 // find best x with many nonzeros
 let best={x:0,n:0}; for(let x=100;x<cc.width-50;x+=20){ const a=col(x); const n=a.filter(v=>v>10).length; if(n>best.n) best={x,n}; }
 const a=col(best.x); let pk=0,pky=0; a.forEach((v,y)=>{if(v>pk){pk=v;pky=y;}});
 return JSON.stringify({w:cc.width,h:cc.height,bestx:best.x,n:best.n,peak:pk,peaky:pky, around:a.slice(pky-35,pky+35)}); })()"""))
# --- soft eraser: draw solid rect block, erase with feathered eraser, expect partial-alpha band
print("ERASER:", ev("""(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.getAttribute('title')||'').includes('橡皮')); if(!b) return 'no'; b.click(); return 'ok'; })()"""))
time.sleep(0.3)
print("set eraser:", ev("""(() => { for(const [lab,val] of [['大小','30'],['羽化','25']]){ const l=[...document.querySelectorAll('label')].find(x=>x.firstChild.textContent.trim()===lab); const i=l.querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,val); i.dispatchEvent(new Event('input',{bubbles:true})); } return 'ok'; })()"""))
time.sleep(0.2)
# vertical erase stroke crossing the horizontal brush stroke at screen (400,300)
call("Input.dispatchMouseEvent",type="mouseMoved",x=400,y=270,buttons=0); time.sleep(0.1)
call("Input.dispatchMouseEvent",type="mousePressed",x=400,y=270,button="left",buttons=1,clickCount=1); time.sleep(0.1)
for i in range(13):
    call("Input.dispatchMouseEvent",type="mouseMoved",x=400,y=270+i*5,buttons=1); time.sleep(0.03)
call("Input.dispatchMouseEvent",type="mouseReleased",x=400,y=330,button="left",buttons=0); time.sleep(0.7)
print("ERASE PROFILE:", ev("""(() => {
 const st=Konva.stages[0];
 const L=st.find('Layer');
 // find densest layer
 let best=null,bn=0;
 for(const l of L){const cv=l.getCanvas()._canvas;const d=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;let nz=0;for(let j=3;j<d.length;j+=4)if(d[j]>4)nz++;if(nz>bn){bn=nz;best=cv;}}
 const cv=best, ctx=cv.getContext('2d'), im=ctx.getImageData(0,0,cv.width,cv.height).data;
 // bounding box of nonzero
 let x0=cv.width,y0=cv.height,x1=0,y1=0;
 for(let y=0;y<cv.height;y++) for(let x=0;x<cv.width;x++){ if(im[(y*cv.width+x)*4+3]>4){if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;} }
 const cx=Math.round((x0+x1)/2), cy=Math.round((y0+y1)/2);
 // horizontal alpha profile through center
 const hp=[]; for(let x=x0;x<=x1;x++) hp.push(im[(cy*cv.width+x)*4+3]);
 return JSON.stringify({bn,bbox:[x0,y0,x1,y1],cx,cy, hp}); })()"""))
ws.close(); p.terminate()
