"""
生成"白底版"应用图标（**只给任务栏与系统托盘用**；其它位置继续用原来的透明底图标）。

为什么：现有图标是透明底 + 棕色牛马标记，放在深色任务栏/托盘上几乎看不清。
做法：把 app 图标的**墨迹裁出来**（去掉四周透明留白），按比例居中放在**白色圆角方块**上，
      导出各常用尺寸的 PNG + 一个多尺寸 ICO。

用法： $MIMO_PYTHON packages/app-shell/scripts/gen-taskbar-icons.py
"""
import os
from PIL import Image, ImageDraw

ICONS = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src', 'renderer', 'icons')
ICONS = os.path.abspath(ICONS)
SRC = os.path.join(ICONS, 'app-256.png')
SIZES = [16, 24, 32, 48, 64, 128, 256]

def white_bg(mark: Image.Image, size: int, coverage: float, radius_ratio: float = 0.22) -> Image.Image:
    """把墨迹居中放在白色圆角方块上。coverage = 墨迹占整边的比例。"""
    radius = max(2, int(round(size * radius_ratio)))
    bg = Image.new('RGBA', (size, size), (255, 255, 255, 0))
    d = ImageDraw.Draw(bg)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=(255, 255, 255, 255))
    target = max(1, int(round(size * coverage)))
    m = mark.copy()
    m.thumbnail((target, target), Image.LANCZOS)
    # 轻微留白：小尺寸多给一点，避免糊成一团
    bg.alpha_composite(m, ((size - m.width) // 2, (size - m.height) // 2))
    return bg

def main() -> None:
    src = Image.open(SRC).convert('RGBA')
    # 裁墨迹要按 **alpha 阈值**：这张图的透明边缘残留了极小的 alpha（抗锯齿），
    # 直接 getbbox() 会得到整块画布 ⇒ 标记被缩得很小。alpha>100 才算"有墨迹"。
    alpha = src.getchannel('A').point(lambda v: 255 if v > 100 else 0)
    bbox = alpha.getbbox()
    mark = src.crop(bbox) if bbox else src
    print('源图标', os.path.basename(SRC), '画布', src.size, '墨迹', mark.size)

    frames = []
    for size in SIZES:
        coverage = 0.80 if size <= 24 else 0.72
        im = white_bg(mark, size, coverage)
        out = os.path.join(ICONS, 'app-white-%d.png' % size)
        im.save(out)
        frames.append(im)
        print('  写出', os.path.basename(out))

    ico = os.path.join(ICONS, 'app-white.ico')
    frames[-1].save(ico, format='ICO', sizes=[(s, s) for s in SIZES], append_images=frames[:-1])
    print('写出', os.path.basename(ico), '尺寸', SIZES)

if __name__ == '__main__':
    main()
