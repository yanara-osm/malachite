import numpy as np
import onnxruntime as ort
from PIL import Image

# SAM 预处理：长边 resize 到 1024，pad 到 1024x1024（零填充）。
# 注意：encoder ONNX 内部已 bake 归一化（Sub mean / Div std），此处喂原始 [0,255]，不要再归一化！
def preprocess(img_path):
    img = Image.open(img_path).convert("RGB")
    w, h = img.size
    scale = 1024 / max(w, h)
    nw, nh = int(round(w * scale)), int(round(h * scale))
    img = img.resize((nw, nh), Image.BILINEAR)
    arr = np.array(img, dtype=np.float32)
    # pad 到 1024x1024（零填充）
    padded = np.zeros((1024, 1024, 3), dtype=np.float32)
    padded[:nh, :nw] = arr
    return padded, (w, h), (nw, nh)

print("=== encoder 测试 ===")
padded, orig, resized = preprocess(r"C:\Users\Administrator\AppData\Local\Temp\sam_test.jpg")
print("padded shape:", padded.shape, "orig:", orig, "resized:", resized)

# encoder 输入 HWC [H,W,3]？ 看 akbartus main.js 是 HWC 输入（input_image [H,W,3]）
enc = ort.InferenceSession("public/models/mobilesam.encoder.onnx", providers=["CPUExecutionProvider"])
inp = enc.get_inputs()[0]
print("encoder input name:", inp.name, inp.shape)

# 试 HWC 输入
feeds = {inp.name: padded.astype(np.float32)}
out = enc.run(None, feeds)
emb = out[0]
print("embedding shape:", emb.shape, "dtype:", emb.dtype)
print("embedding min/max:", emb.min(), emb.max())

print("\n=== decoder 测试 ===")
dec = ort.InferenceSession("public/models/mobilesam.decoder.onnx", providers=["CPUExecutionProvider"])
for i in dec.get_inputs():
    print("dec input:", i.name, i.shape)
for o in dec.get_outputs():
    print("dec output:", o.name, o.shape)

# 点 prompt：图片中心点，label=1（前景）
cx, cy = 1024 // 2, 1024 // 2
point_coords = np.array([[[cx, cy]]], dtype=np.float32)  # [1,1,2]
point_labels = np.array([[1]], dtype=np.float32)          # [1,1]
mask_input = np.zeros((1, 1, 256, 256), dtype=np.float32)
has_mask = np.array([0], dtype=np.float32)                 # [1]
orig_size = np.array([resized[1], resized[0]], dtype=np.float32)  # [h, w]

feeds_dec = {
    "image_embeddings": emb,
    "point_coords": point_coords,
    "point_labels": point_labels,
    "mask_input": mask_input,
    "has_mask_input": has_mask,
    "orig_im_size": orig_size,
}
outd = dec.run(None, feeds_dec)
for name, o in zip([o.name for o in dec.get_outputs()], outd):
    print("  out", name, o.shape, "min/max", o.min(), o.max())
