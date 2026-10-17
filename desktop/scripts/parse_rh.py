import urllib.request, re, json

URL = "https://www.runninghub.cn/ai-detail/2079471819890974721"
req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"})
html = urllib.request.urlopen(req, timeout=20).read().decode("utf-8", "ignore")

m = re.search(r"\[\d+,\d+,\d+,\d+\][^{]*\{\"nodeId\":", html)
seg = html[m.start():m.start() + 6000]

schema_starts = [mm.start() for mm in re.finditer(r'\{\"nodeId\":\d+', seg)]
nodes = []
for i, ss in enumerate(schema_starts):
    brace_end = seg.index("}", ss) + 1
    data_end = schema_starts[i + 1] if i + 1 < len(schema_starts) else (seg.index("<p>") if "<p>" in seg else len(seg))
    vals = re.findall(r'"((?:[^"\\]|\\.)*)"', seg[brace_end:data_end])
    nodes.append(vals)


def parse_fielddata(fd):
    """fd 形如 ["FLOAT", {...}] 或 [[...], {image_upload}]，返回 (类型, 约束dict)"""
    try:
        unescaped = fd.replace('\\"', '"').replace("\\\\", "\\")
        obj = json.loads(unescaped)
        if isinstance(obj, list) and obj and isinstance(obj[0], str):
            return obj[0], (obj[1] if len(obj) > 1 and isinstance(obj[1], dict) else {})
        if isinstance(obj, list) and obj and isinstance(obj[0], list):
            return "IMAGE", (obj[1] if len(obj) > 1 and isinstance(obj[1], dict) else {})
    except Exception:
        pass
    return None, {}


results = []
prev_fieldName = None
for vals in nodes:
    if not vals:
        continue
    nodeId, nodeName = vals[0], vals[1]
    third = vals[2] if len(vals) > 2 else None
    if third and re.match(r"^[a-z_][a-z0-9_]*$", third):
        fieldName = third
        rest = vals[3:]
    else:
        fieldName = prev_fieldName or "value"
        rest = vals[2:]

    fieldData = next((v for v in rest if v.startswith("[")), None)
    description = next((v for v in rest if re.match(r"^[^\x00-\x7f]", v)), None)

    fd_type, constraints = (None, {})
    if fieldData:
        fd_type, constraints = parse_fielddata(fieldData)
    fieldType = next((v for v in rest if re.match(r"^(IMAGE|FLOAT|INT|STRING|BOOLEAN|LIST)$", v)), None) or fd_type

    default = constraints.get("default")
    dmin = constraints.get("min")
    dmax = constraints.get("max")

    results.append({
        "nodeId": nodeId, "nodeName": nodeName, "fieldName": fieldName,
        "fieldType": fieldType, "description": description, "default": default,
        "min": dmin, "max": dmax,
    })
    prev_fieldName = fieldName

print(json.dumps(results, ensure_ascii=False, indent=2))
