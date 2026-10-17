import numpy as np
import onnxruntime as ort
from PIL import Image, ImageDraw, ImageFont

# 生成测试图：白底 + 黑色大号文字（先测大目标，排除能力 vs bug）
def make_text_img():
    img = Image.new("RGB", (800, 400), "white")
    d = ImageDraw.Draw(img)
    try:
        f = ImageFont.truetype("arial.ttf", 140)
    except:
        f = ImageFont.load_default()
    d.text((80, 120), "OSM", fill="black", font=f)
    return img

img = make_text_img()
img.save(r"C:\Users\Administrator\AppData\Local\Temp\sam_text.png")
w, h = img.size
scale = 1024 / max(w, h)
nw, nh = int(round(w * scale)), int(round(h * scale))
img2 = img.resize((nw, nh), Image.BILINEAR)
arr = np.array(img2, dtype=np.float32)
padded = np.zeros((1024, 1024, 3), dtype=np.float32)
padded[:nh, :nw] = arr  # 原始 0-255，无归一化

enc = ort.InferenceSession("public/models/mobilesam.encoder.onnx", providers=["CPUExecutionProvider"])
dec = ort.InferenceSession("public/models/mobilesam.decoder.onnx", providers=["CPUExecutionProvider"])
emb = enc.run(None, {"input_image": padded.astype(np.float32)})[0]

def test_point(docx, docy, label, tag):
    # 文档坐标 → 1024 空间（原图坐标 × scale，图贴左上角无偏移）
    px = docx * scale
    py = docy * scale
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
    # 前景边界框
    ys, xs = np.where(m > 0)
    if len(xs):
        bbox = (xs.min(), ys.min(), xs.max(), ys.max())
    else:
        bbox = None
    print(f"{tag}: label={label} 前景={pos}/{m.size} ({100*pos/m.size:.1f}%) iou={iou[0][0]:.3f} bbox={bbox}")

# 文字中心（大文字 OSM 中心约在 (400, 200)）
print("图尺寸:", (w, h), "resize:", (nw, nh), "scale:", scale)
print("=== 点文字中心 (400,200) ===")
test_point(400, 200, 1, "文字中心-前景")
test_point(400, 200, 0, "文字中心-背景")
print("=== 点空白处 (50,50) ===")
test_point(50, 50, 1, "空白-前景")
