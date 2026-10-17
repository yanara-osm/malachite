import numpy as np
import onnxruntime as ort
from PIL import Image

enc = ort.InferenceSession("public/models/mobilesam.encoder.onnx", providers=["CPUExecutionProvider"])
dec = ort.InferenceSession("public/models/mobilesam.decoder.onnx", providers=["CPUExecutionProvider"])

def embed(img):
    w, h = img.size
    scale = 1024 / max(w, h)
    nw, nh = int(round(w * scale)), int(round(h * scale))
    arr = np.array(img.resize((nw, nh), Image.BILINEAR), dtype=np.float32)
    padded = np.zeros((1024, 1024, 3), dtype=np.float32)
    padded[:nh, :nw] = arr
    e = enc.run(None, {"input_image": padded.astype(np.float32)})[0]
    return e, (w, h), (nw, nh), scale

def point(e, scale, nh, nw, docx, docy, label, tag):
    px, py = docx * scale, docy * scale
    feeds = {
        "image_embeddings": e,
        "point_coords": np.array([[[px, py]]], dtype=np.float32),
        "point_labels": np.array([[label]], dtype=np.float32),
        "mask_input": np.zeros((1, 1, 256, 256), dtype=np.float32),
        "has_mask_input": np.array([0], dtype=np.float32),
        "orig_im_size": np.array([nh, nw], dtype=np.float32),
    }
    masks, iou, low = dec.run(None, feeds)
    m = masks[0][0]
    pos = (m > 0).sum()
    ys, xs = np.where(m > 0)
    bbox = (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())) if len(xs) else None
    print(f"{tag}: 前景={100*pos/m.size:.1f}% iou={iou[0][0]:.3f} bbox={bbox}")
    return m

# dog.jpg 800x534，狗在图中部
img = Image.open(r"C:\Users\Administrator\AppData\Local\Temp\sam_dog.jpg").convert("RGB")
e, (w, h), (nw, nh), scale = embed(img)
print(f"dog.jpg {w}x{h} resize {nw}x{nh}")
print("点狗身体中心 (400,300):")
point(e, scale, nh, nw, 400, 300, 1, "  dog-前景")
point(e, scale, nh, nw, 400, 300, 0, "  dog-背景")
print("点狗鼻子 (430,230):")
point(e, scale, nh, nw, 430, 230, 1, "  nose-前景")
