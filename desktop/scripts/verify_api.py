import json, time, urllib.request, websocket

PORT = 9222

def tabs(): return json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/list", timeout=10))
def cdp(ws, m, p=None, mid=1):
    ws.send(json.dumps({"id": mid, "method": m, "params": p or {}}))
    while True:
        r = json.loads(ws.recv())
        if r.get("id") == mid: return r
def js(ws, e):
    r = cdp(ws, "Runtime.evaluate", {"expression": e, "returnByValue": True})
    return r.get("result", {}).get("result", {}).get("value")

tabs = tabs()
tab = next(t for t in tabs if t.get("type") == "page")
ws = websocket.create_connection(tab["webSocketDebuggerUrl"], timeout=60)

# 1. 管理区页面
cdp(ws, "Page.navigate", {"url": "http://localhost:3000/api-config"})
time.sleep(3)
print("管理区标题:", js(ws, "document.body.innerText.includes('AI API 管理')"))
print("API Key 输入框:", js(ws, "!!document.querySelector('input[type=password]')"))
print("新建按钮:", js(ws, "[...document.querySelectorAll('button')].some(b => b.textContent.includes('新建 API'))"))

# 2. 配置一个测试 API：填命名 + 参数
js(ws, "[...document.querySelectorAll('button')].find(b => b.textContent.includes('新建 API')).click()")
time.sleep(1)
# 填命名
js(ws, """
(() => {
  const inputs = [...document.querySelectorAll('input')];
  const name = inputs.find(i => i.placeholder === '如 OSM简单洗图');
  if (name) { const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; s.call(name, '测试API'); name.dispatchEvent(new Event('input',{bubbles:true})); }
  // 填 webappId
  const wid = inputs.find(i => i.placeholder === '从 ai-detail 链接末尾取');
  if (wid) { const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; s.call(wid, '2079471819890974721'); wid.dispatchEvent(new Event('input',{bubbles:true})); }
  return 'ok';
})()
""")
time.sleep(1)
# 填第一个参数（显示名 + nodeId + fieldName）
js(ws, """
(() => {
  const set = (i, v) => { const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; s.call(i, v); i.dispatchEvent(new Event('input',{bubbles:true})); };
  const inputs = [...document.querySelectorAll('input')];
  const label = inputs.find(i => i.placeholder === '如 原始图');
  if (label) set(label, '原始图');
  const nodeId = inputs.find(i => i.placeholder === '如 6');
  if (nodeId) set(nodeId, '6');
  const fieldName = inputs.find(i => i.placeholder === '如 text');
  if (fieldName) set(fieldName, 'image');
  return 'ok';
})()
""")
time.sleep(1)
# 把第一个参数类型改成 image
js(ws, """
(() => {
  const sel = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => o.textContent === '文本'));
  if (sel) { const s = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set; s.call(sel, 'image'); sel.dispatchEvent(new Event('change',{bubbles:true})); }
  return 'ok';
})()
""")
time.sleep(1)
# 保存
js(ws, "[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '保存').click()")
time.sleep(1)
print("保存后 localStorage apidefs:", js(ws, "JSON.parse(localStorage.getItem('malachite:apidefs') || '[]').map(d => ({name: d.name, params: d.params.map(p => ({label: p.label, type: p.type, nodeId: p.nodeId}))}))"))

# 3. 编辑面板智能体区
cdp(ws, "Page.navigate", {"url": "http://localhost:3000/project?id=ink"})
time.sleep(4)
print("智能体下拉存在:", js(ws, "!!document.querySelector('select')"))
print("下拉选项含测试API:", js(ws, "[...document.querySelectorAll('option')].some(o => o.textContent === '测试API')"))
print("图片来源三选一存在:", js(ws, "document.body.innerText.includes('整图') && document.body.innerText.includes('活动图层') && document.body.innerText.includes('当前选区')"))

ws.close()
print("=== DONE ===")
