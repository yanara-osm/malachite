import numpy as np
import onnxruntime as ort
from PIL import Image

img = Image.open(r"C:\Users\Administrator\AppData\Local\Temp\sam_test.jpg").convert("RGB")
w, h = img.size
scale = 1024 / max(w, h)
nw, nh = int(round(w * scale)), int(round(h * scale))
img = img.resize((nw, nh), Image.BILINEAR)
arr = np.array(img, dtype=np.float32)

def make_padded(raw):
    p = np.zeros((1024, 1024, 3), dtype=np.float32)
    p[:nh, :nw] = raw
    return p

mean = np.array([123.675, 116.28, 103.53], dtype=np.float32)
std = np.array([58.395, 57.12, 57.375], dtype=np.float32)

# 两种输入：A=归一化(旧/错)，B=原始[0,255](对)
A = (make_padded(arr) - mean) / std
B = make_padded(arr)

enc = ort.InferenceSession("public/models/mobilesam.encoder.onnx", providers=["CPUExecutionProvider"])
dec = ort.InferenceSession("public/models/mobilesam.decoder.onnx", providers=["CPUExecutionProvider"])

# 中心点（卡车车身）
cx, cy = 512, 341

def run(x, label, tag):
    emb = enc.run(None, {"input_image": x.astype(np.float32)})[0]
    feeds = {
        "image_embeddings": emb,
        "point_coords": np.array([[[cx, cy]]], dtype=np.float32),
        "point_labels": np.array([[label]], dtype=np.float32),
        "mask_input": np.zeros((1, 1, 256, 256), dtype=np.float32),
        "has_mask_input": np.array([0], dtype=np.float32),
        "orig_im_size": np.array([nh, nw], dtype=np.float32),
    }
    masks, iou, low = dec.run(None, feeds)
    m = masks[0][0]
    pos = (m > 0).sum()
    print(f"{tag}: label={label} 前景像素={pos}/{m.size} ({100*pos/m.size:.1f}%)  iou={iou[0][0]:.3f}  mask范围[{m.min():.1f},{m.max():.1f}]")

print("=== 对照：A=归一化输入(旧) vs B=原始255输入(对) ===")
run(A, 1, "A-归一化")
run(A, 0, "A-归一化")
run(B, 1, "B-原始255")
run(B, 0, "B-原始255")
