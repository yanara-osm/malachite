import numpy as np
import onnxruntime as ort
from PIL import Image, ImageDraw, ImageFont

# 自然纹理背景 + 小文字（模拟海报），测 MobileSAM 对自然图小目标的真实表现
def make_poster():
    # 用卡车图做自然背景
    bg = Image.open(r"C:\Users\Administrator\AppData\Local\Temp\sam_test.jpg").convert("RGB").resize((800, 400), Image.BILINEAR)
    d = ImageDraw.Draw(bg)
    try:
        f = ImageFont.truetype("arial.ttf", 60)
    except:
        f = ImageFont.load_default()
    # 左上角加一行白字
    d.text((40, 30), "OSM FILM", fill="white", font=f)
    return bg

img = make_poster()
img.save(r"C:\Users\Administrator\AppData\Local\Temp\sam_poster.png")
w, h = img.size
scale = 1024 / max(w, h)
nw, nh = int(round(w * scale)), int(round(h * scale))
arr = np.array(img.resize((nw, nh), Image.BILINEAR), dtype=np.float32)
padded = np.zeros((1024, 1024, 3), dtype=np.float32)
padded[:nh, :nw] = arr

enc = ort.InferenceSession("public/models/mobilesam.encoder.onnx", providers=["CPUExecutionProvider"])
dec = ort.InferenceSession("public/models/mobilesam.decoder.onnx", providers=["CPUExecutionProvider"])
emb = enc.run(None, {"input_image": padded.astype(np.float32)})[0]

def test_point(docx, docy, label, tag):
    px, py = docx * scale, docy * scale
    feeds = {
        "image_embeddings": emb,
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
    print(f"{tag}: label={label} 前景={100*pos/m.size:.1f}% iou={iou[0][0]:.3f} bbox={bbox}")

print("图:", (w, h), "resize:", (nw, nh))
print("=== 点文字上 (70,55) ===")
test_point(70, 55, 1, "文字-前景")
print("=== 点卡车中心 (400,250) ===")
test_point(400, 250, 1, "卡车-前景")
