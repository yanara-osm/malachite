#!/usr/bin/env python
"""智能抠像：输入 PNG 路径 → 输出透明背景 PNG（rembg U2-Net）
用法: python matting.py <input.png> <output.png>
"""
import sys, os
from rembg import remove, new_session

def main():
    if len(sys.argv) < 3:
        print("Usage: python matting.py <input.png> <output.png>", file=sys.stderr)
        sys.exit(1)
    inp, outp = sys.argv[1], sys.argv[2]
    if not os.path.exists(inp):
        print(f"Error: {inp} not found", file=sys.stderr)
        sys.exit(1)
    # 加载 session（首次会自动下载模型，已缓存则秒级）
    session = new_session("u2net")
    with open(inp, "rb") as f:
        input_bytes = f.read()
    output_bytes = remove(input_bytes, session=session)
    with open(outp, "wb") as f:
        f.write(output_bytes)
    print(f"OK {len(output_bytes)} bytes -> {outp}")

if __name__ == "__main__":
    main()
