# 第 92 轮交接 · 我的页布局

> 用户口径：名片放到用户名右侧；头像与「用户名 + 名片」左右居中；邮箱放到右侧助记词上面；
> 邮箱、助记词、自动登录、设 PIN + 退出整体下移一些，以左侧牛马 logo 为锚点上下居中。

## 1. 结构（`renderer/app.js` nav==='wo'）

```
.woDing.woDingR68（flex，align-items:center）
├─ .woBrandR68：牛马 logo + 品牌名（左侧锚点）
├─ .woR68Body（flex，align-items:center）
│  ├─ .woR68Profile（align-items:center，text-align:center）
│  │  ├─ #pAvAnNiu 头像
│  │  └─ .woMingHang：用户名 + #pMingPianBtn 名片按钮（同一行，居中）
│  └─ .woR68Account（padding-top:14px）
│     ├─ .woYouJianHang：邮箱输入 + 保存提示
│     └─ #warmyAuthMyCard：助记词 / 自动登录 / 改 PIN + 退出（auth-gate 填充）
```

- 名片按钮从原来的邮箱行移到用户名行，位于 `#pMingDisplay` 之后。
- 邮箱从资料列移到账号列顶部，位于助记词行之前。
- 账号列 `padding-top:14px`，整体略微下移；`.woDing.woDingR68` 与 `.woR68Body` 都 `align-items:center`，以左侧 logo 为锚点上下居中。

## 2. CSS（`renderer/auth-gate.css`）

- `.woDing.woDingR68 { align-items:center; }`
- `.woR68Body { align-items:center; }`
- `.woR68Profile { flex: 0 1 40%; align-items:center; text-align:center; }`
- `.woR68Profile .woMingHang { justify-content:center; }`
- `.woR68Account { flex: 0 1 46%; min-width:210px; padding-top:14px; display:flex; flex-direction:column; gap:12px; }`
- `.woR68Account .woYouJianHang #pYouJian { flex:1 1 180px; }`
- 窄屏 ≤700px：资料列与账号列各占 100%，账号列 `padding-top:0`。

## 3. 真机量盒（`verify-r92-live` 20/0）

在临时 profile、1280×800 下：

- 名字矩形 `x=710..770`，名片矩形 `x=780..817` → 名片在右侧、同一行。
- 头像中心 x=763，用户名行中心 x=763 → 水平居中（差 0px）。
- 邮箱在 `.woR68Account` 内，位于 `#warmyAuthMyCard` 上方。
- 账号列 `padding-top=14px`。
- 左侧品牌中心 y=155，右侧 body 中心 y=155 → 上下居中（差 0px）。

## 4. 兼容性

- 旧事件绑定全部按 id 保留：`#pAvAnNiu` / `#pMingDisplay` / `#pMing` / `#pMingPianBtn` / `#pYouJian` / `#pYouJianXiaoXi`，不需要改逻辑。
- 账号卡仍由 `auth-gate.js` 的 `decorateMyPage` 填充；邮箱移到账号列不改变 auth-gate 的挂载逻辑。
- `verify-r67-firstrun` 80/0（含我的页静态布局断言已按新结构更新）、`verify-r82-r103` 18/0、`verify-r78-auth-tour` 47/0。

## 5. 最坏情况

- 窄屏下两列回退为上下布局，仍可读；邮箱与账号卡不会重叠。
- 旁路登录（测试）时账号卡为空，`#warmyAuthMyCard:empty` 不占位；真实账号下才显示助记词/PIN/退出。
