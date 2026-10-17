#!/usr/bin/env python
"""智能抠像：输入 PNG → 输出透明背景 PNG（rembg U2-Net，本地单模型）
用法: python matting.py <input.png> <output.png>
"""
import sys
from rembg import remove, new_session

def main():
    if len(sys.argv) < 3:
        print("Usage: python matting.py <input.png> <output.png>", file=sys.stderr)
        sys.exit(1)
    inp, outp = sys.argv[1], sys.argv[2]
    with open(inp, "rb") as f:
        data = f.read()
    session = new_session("u2net")
    out = remove(data, session=session)
    with open(outp, "wb") as f:
        f.write(out)
    print(f"OK {len(out)} bytes -> {outp}")

if __name__ == "__main__":
    main()
