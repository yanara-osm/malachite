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

tab = next(t for t in tabs() if t.get("type") == "page")
ws = websocket.create_connection(tab["webSocketDebuggerUrl"], timeout=60)

cdp(ws, "Page.navigate", {"url": "http://localhost:3000/api-config"})
time.sleep(3)

def set_input(placeholder, val):
    return js(ws, f"""
    (() => {{
      const i = [...document.querySelectorAll('input')].find(x => x.placeholder === '{placeholder}');
      if (!i) return 'no-input';
      const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
      s.call(i, '{val}');
      i.dispatchEvent(new Event('input', {{bubbles:true}}));
      return i.value;
    }})()
    """)

# 新建
js(ws, "[...document.querySelectorAll('button')].find(b => b.textContent.includes('新建 API')).click()")
time.sleep(1)
print("填命名:", set_input("如 OSM简单洗图", "测试API"))
print("填 webappId:", set_input("从 ai-detail 链接末尾取", "2079471819890974721"))
print("填参数显示名:", set_input("如 原始图", "原始图"))
print("填 nodeId:", set_input("如 6", "6"))
print("填 fieldName:", set_input("如 text", "image"))
time.sleep(0.5)

# 参数类型改成 image
js(ws, """
(() => {
  const sel = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => o.textContent === '文本'));
  if (sel) { const s = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set; s.call(sel, 'image'); sel.dispatchEvent(new Event('change',{bubbles:true})); return 'set-select'; }
  return 'no-select';
})()
""")
time.sleep(0.5)

# 保存：最后一个「保存」按钮（编辑表单在页面底部）
js(ws, "[...document.querySelectorAll('button')].filter(b => b.textContent.trim() === '保存').pop().click()")
time.sleep(1)

print("apidefs:", js(ws, "JSON.parse(localStorage.getItem('malachite:apidefs') || '[]').map(d => ({name: d.name, webappId: d.webappId, params: d.params.map(p => ({label: p.label, type: p.type, nodeId: p.nodeId, fieldName: p.fieldName}))}))"))

# 智能体区
cdp(ws, "Page.navigate", {"url": "http://localhost:3000/project?id=ink"})
time.sleep(4)
print("下拉含测试API:", js(ws, "[...document.querySelectorAll('option')].some(o => o.textContent === '测试API')"))
print("三选一存在:", js(ws, "document.body.innerText.includes('整图') && document.body.innerText.includes('活动图层') && document.body.innerText.includes('当前选区')"))

ws.close()
print("=== DONE ===")
