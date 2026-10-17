import json, time, urllib.request, websocket

PORT = 9222
HTML = urllib.request.urlopen(urllib.request.Request(
    "https://www.runninghub.cn/ai-detail/2079471819890974721",
    headers={"User-Agent": "Mozilla/5.0"}), timeout=20).read().decode("utf-8", "ignore")

def tabs():
    return json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/list", timeout=10))

def cdp(ws, method, params=None, mid=1):
    msg = {"id": mid, "method": method}
    if params is not None:
        msg["params"] = params
    ws.send(json.dumps(msg))
    while True:
        r = json.loads(ws.recv())
        if r.get("id") == mid:
            return r

def js(ws, expr, mid):
    return cdp(ws, "Runtime.evaluate", {"expression": expr, "awaitPromise": True, "returnByValue": True}, mid)

# 找 page tab
tab = None
for t in tabs():
    if t["type"] == "page":
        tab = t
        break
ws = websocket.create_connection(tab["webSocketDebuggerUrl"])
cdp(ws, "Runtime.enable")
cdp(ws, "Page.enable")

# 导航到管理区
cdp(ws, "Page.navigate", {"url": "http://localhost:3000/api-config"})
time.sleep(4)

# 注入 mock rhProxy（fetchHtml 返回真实 RH 详情页 HTML）
inject = "window.rhProxy = { fetchHtml: async () => ({ ok: true, text: " + json.dumps(HTML) + " }) }; 'ok'"
r = js(ws, inject, 100)
print("注入 rhProxy:", r.get("result", {}).get("result", {}).get("value"))

# 点「新建 API」按钮
r = js(ws, """
(() => {
  const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('新建'));
  if (b) { b.click(); return 'clicked'; }
  return 'no new btn';
})()
""", 101)
print("点新建:", r.get("result", {}).get("result", {}).get("value"))
time.sleep(1)

# 填 webappId
r = js(ws, """
(() => {
  const inp = [...document.querySelectorAll('input')].find(x => (x.placeholder||'').includes('ai-detail'));
  if (!inp) return 'no webappId input';
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(inp, '2079471819890974721');
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  return 'webappId filled: ' + inp.value;
})()
""", 102)
print("填 webappId:", r.get("result", {}).get("result", {}).get("value"))
time.sleep(1)

# 点「拉取参数」按钮
r = js(ws, """
(() => {
  const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('拉取参数'));
  if (b) { b.click(); return 'clicked pull'; }
  return 'no pull btn';
})()
""", 103)
print("点拉取:", r.get("result", {}).get("result", {}).get("value"))
time.sleep(3)

# 检查参数列表（nodeId 输入框的值）
r = js(ws, """
(() => {
  const nodeIds = [...document.querySelectorAll('input')].filter(x => (x.placeholder||'').includes('nodeId')).map(x => x.value);
  const labels = [...document.querySelectorAll('input')].filter(x => (x.placeholder||'').includes('显示名')).map(x => x.value);
  const msg = [...document.querySelectorAll('p')].map(x => x.textContent).find(t => t.includes('拉取') || t.includes('个参数'));
  return JSON.stringify({ nodeIds, labels, msg });
})()
""", 104)
print("拉取结果:", r.get("result", {}).get("result", {}).get("value"))

ws.close()
print("=== DONE ===")
