import json, time, urllib.request, websocket

def tabs():
    return json.load(urllib.request.urlopen("http://127.0.0.1:9222/json/list", timeout=10))

def cdp(ws, method, params=None, mid=1):
    msg = {"id": mid, "method": method}
    if params is not None:
        msg["params"] = params
    ws.send(json.dumps(msg))
    while True:
        r = json.loads(ws.recv())
        if r.get("id") == mid:
            return r

tab = None
for t in tabs():
    if t["type"] == "page":
        tab = t
        break
ws = websocket.create_connection(tab["webSocketDebuggerUrl"])

r = cdp(ws, "Runtime.evaluate", {"expression": """
(() => {
  const inputs = [...document.querySelectorAll('input')];
  const nodeIds = inputs.filter(x => (x.placeholder||'') === '如 6').map(x => x.value);
  const labels = inputs.filter(x => (x.placeholder||'') === '如 原始图').map(x => x.value);
  const fieldNames = inputs.filter(x => (x.placeholder||'') === '如 image').map(x => x.value);
  return JSON.stringify({ nodeIds, labels, fieldNames });
})()
""", "returnByValue": True}, 200)
print("参数详情:", r.get("result", {}).get("result", {}).get("value"))
ws.close()
print("=== DONE ===")
