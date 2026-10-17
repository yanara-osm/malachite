from PIL import Image, ImageDraw, ImageFont

W, H = 480, 280
# RGBA 背景（便于贴透明 logo），最后转 RGB 存 BMP
img = Image.new("RGBA", (W, H), (10, 10, 10, 255))
draw = ImageDraw.Draw(img)

# 中文字体
FONT = "C:/Windows/Fonts/msyh.ttc"
try:
    f_cn = ImageFont.truetype(FONT, 34)
    f_en = ImageFont.truetype(FONT, 15)
    f_sub = ImageFont.truetype(FONT, 13)
except Exception:
    f_cn = ImageFont.load_default()
    f_en = ImageFont.load_default()
    f_sub = ImageFont.load_default()

# logo（孔雀），居中偏上
try:
    logo = Image.open(r"D:/projects/malachite/web/public/logo.png").convert("RGBA")
    logo = logo.resize((72, 72), Image.LANCZOS)
    img.paste(logo, ((W - 72) // 2, 28), logo)
except Exception as e:
    print("logo 失败:", e)

# 第一行：孔雀翎（中文主标题）
cn = "孔雀翎"
bb = draw.textbbox((0, 0), cn, font=f_cn)
draw.text(((W - (bb[2] - bb[0])) // 2, 112), cn, fill=(229, 231, 235), font=f_cn)

# 第二行：Malachite（英文，小字号 + 字母间距）
en = "M A L A C H I T E"
bb2 = draw.textbbox((0, 0), en, font=f_en)
draw.text(((W - (bb2[2] - bb2[0])) // 2, 152), en, fill=(94, 200, 182), font=f_en)

# 冷青 accent 线（静态，读作设计元素而非 loader）
lw = 64
draw.rectangle([(W - lw) // 2, 186, (W + lw) // 2, 188], fill=(94, 234, 212))

# 底部文案（静态，无动画）
sub = "正在启动，请稍候"
bb3 = draw.textbbox((0, 0), sub, font=f_sub)
draw.text(((W - (bb3[2] - bb3[0])) // 2, 206), sub, fill=(107, 114, 128), font=f_sub)

img.convert("RGB").save(r"D:/projects/malachite/desktop/build/splash.bmp", "BMP")
print("saved splash.bmp", W, "x", H)
