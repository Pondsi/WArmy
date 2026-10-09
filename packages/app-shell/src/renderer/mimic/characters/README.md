# 拟态 · 人物模型目录

把人物模型放进本目录（或其子目录）即可被自动识别，在「设置 → 拟态 → 人物模型」里选择使用。

## 支持的形式

1. **静态图**：`*.png` / `*.webp` / `*.gif`（单图或序列帧）
2. **精灵图**：`*.json` + 同名的 `*.png`（见下方格式）
3. **Live2D**：`*.model3.json`（需 `.moc3` 与贴图同目录）

## 精灵图格式（推荐，最省资源）

同名 JSON：

```json
{
  "name": "默认小牛",
  "frameWidth": 128,
  "frameHeight": 128,
  "animations": {
    "idle":   { "row": 0, "frames": 4, "fps": 6,  "loop": true },
    "talk":   { "row": 1, "frames": 6, "fps": 10, "loop": true },
    "happy":  { "row": 2, "frames": 4, "fps": 8,  "loop": false },
    "sleep":  { "row": 3, "frames": 2, "fps": 2,  "loop": true },
    "drag":   { "row": 4, "frames": 3, "fps": 10, "loop": true }
  }
}
```

- `row`：该动画在第几行（从 0 开始）
- `frames`：该行有多少帧
- `fps`：每秒播放多少帧
- `loop`：是否循环

## 内置模型

- `builtin-default.svg`：出厂内置（矢量，任何分辨率都清晰）

## 命名约定

文件名会成为界面里显示的名字。用中文或英文都行，避免空格与特殊符号。
