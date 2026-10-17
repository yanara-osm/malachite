from PIL import Image, ImageDraw, ImageFont

W, H = 480, 260
# RGBA 背景（便于贴透明 logo），最后转 RGB 存 BMP
img = Image.new("RGBA", (W, H), (10, 10, 10, 255))
draw = ImageDraw.Draw(img)

# 中文字体
FONT = "C:/Windows/Fonts/msyh.ttc"
try:
    f_brand = ImageFont.truetype(FONT, 30)
    f_sub = ImageFont.truetype(FONT, 15)
except Exception:
    f_brand = ImageFont.load_default()
    f_sub = ImageFont.load_default()

# logo（孔雀），居中偏上
try:
    logo = Image.open(r"D:/projects/malachite/web/public/logo.png").convert("RGBA")
    logo = logo.resize((76, 76), Image.LANCZOS)
    img.paste(logo, ((W - 76) // 2, 36), logo)
except Exception as e:
    print("logo 失败:", e)

# 品牌名
brand = "孔雀翎 · Malachite"
bb = draw.textbbox((0, 0), brand, font=f_brand)
tw = bb[2] - bb[0]
draw.text(((W - tw) // 2, 126), brand, fill=(229, 231, 235), font=f_brand)

# 冷青 accent 线（静态，读作设计元素而非 loader）
lw = 64
draw.rectangle([(W - lw) // 2, 170, (W + lw) // 2, 172], fill=(94, 234, 212))

# 底部文案（静态，无动画）
sub = "正在启动，请稍候"
bb2 = draw.textbbox((0, 0), sub, font=f_sub)
sw = bb2[2] - bb2[0]
draw.text(((W - sw) // 2, 188), sub, fill=(107, 114, 128), font=f_sub)

img.convert("RGB").save(r"D:/projects/malachite/desktop/build/splash.bmp", "BMP")
print("saved splash.bmp", W, "x", H)
