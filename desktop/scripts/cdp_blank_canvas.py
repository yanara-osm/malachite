# E2E: create blank canvas via homepage dialog with a non-default ratio (21:9 preset 2560x1080)
# then verify workbench docSize ratio AND L1 is a white rect (not image)
import json, time, os, subprocess, urllib.request
import websocket
PORT=9391; CHROME=r"C:\Program Files\Google\Chrome\Application\chrome.exe"
UA=os.path.expandvars(r"%LOCALAPPDATA%\Temp\malachite-blank2")
p=subprocess.Popen([CHROME,"--headless=new","--window-size=1440,900",f"--remote-debugging-port={PORT}","--remote-allow-origins=*","--no-first-run","--no-default-browser-check","--no-sandbox",f"--user-data-dir={UA}","http://localhost:3000/"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
ws=None
for _ in range(60):
    time.sleep(2)
    try:
        for t in json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/list")):
            if ":3000" in t.get("url",""):
                ws=websocket.create_connection(t["webSocketDebuggerUrl"],max_size=50*1024*1024); break
        if ws: break
    except Exception: pass
_i=[0]
def call(m,**kw):
    _i[0]+=1; ws.send(json.dumps({"id":_i[0],"method":m,"params":kw}))
    while True:
        r=json.loads(ws.recv())
        if r.get("id")==_i[0]: return r.get("result",{})
def ev(e):
    r=call("Runtime.evaluate",expression=e,returnByValue=True,awaitPromise=True)
    if r.get("exceptionDetails"): print("JSERR",json.dumps(r["exceptionDetails"])[:400])
    return r["result"].get("value")
time.sleep(6)
# open dialog, click the 21:9 preset, then 创建
print("dialog:", ev("""(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes('新建画布')); b.click(); return 'ok'; })()"""))
time.sleep(0.4)
print("pick21:", ev("""(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes('超宽 21:9')); b.click(); return 'ok'; })()"""))
time.sleep(0.2)
print("vals:", ev("""(() => { const ins=[...document.querySelectorAll('input')].filter(i=>i.value&&/^\d+$/.test(i.value)&&+i.value>=100); return JSON.stringify(ins.map(i=>i.value)); })()"""))
print("create:", ev("""(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='创建'); b.click(); return 'ok'; })()"""))
time.sleep=time.sleep; time.sleep(6)
print("url:", ev("location.href"))
for _ in range(30):
    if ev("!!(window.Konva&&Konva.stages[0])"): break
    time.sleep(1)
state=ev("""(() => {
 const st=Konva.stages[0];
 // read autosave key to find the project id
 const keys=Object.keys(localStorage).filter(k=>k.includes('projectstate')||k.includes('ProjectState'));
 return JSON.stringify({url:location.href, layers:st.find('Layer').length, images:st.find('Image').length, rects:st.find('Rect').length, stateKeys:keys.slice(0,5)});
})()""")
print("STATE:", state)
# Now inspect actual L1 shape + docSize from autosave
proj=ev("""(() => {
 const m=location.href.match(/id=([^&]+)/); return m?m[1]:null;
})()""")
print("proj id:", proj)
detail=ev("""(() => {
 // the white rect dims from Konva
 const st=Konva.stages[0];
 const rects=st.find('Rect').map(r=>({w:r.attrs.width,h:r.attrs.height,fill:r.attrs.fill}));
 const imgs=st.find('Image').map(im=>({w:im.attrs.width,h:im.attrs.height}));
 // pull saved docSize from localStorage
 let ds=null;
 for(const k of Object.keys(localStorage)){ if(k.toLowerCase().includes('state')){ try{ const v=JSON.parse(localStorage[k]); if(v.docSize){ds=v.docSize;} }catch(e){} } }
 return JSON.stringify({rects,imgs,docSize:ds});
})()""")
print("DETAIL:", detail)
ws.close(); p.terminate()
