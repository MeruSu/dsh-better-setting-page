# Better Setting Page · 全屏设置页

把 DeepSeek Harness 的设置面板变成**铺满整个窗口的页面**，并让左侧分类栏**收成
56px 的图标列**。

这个宿主的设置默认是 800px 宽的弹窗。三五行开关够用，再多就挤：一页「每类一张卡」
的设置在这个宽度里根本读不下去，而屏幕上剩下的大片空白是用户的。这个插件不增加
任何设置项，只是把设置页本该有的地方还给它。

对照版本：宿主 `0.2.2-rc.1`（解包 asar 里的 `@deepseek-ai/dsh-client-ui-settings-general`
0.2.2-rc.1）。下面[「它怎么做到的」](#它怎么做到的)写清了每一处锚点，宿主改版后你可以
照着判断还对不对得上。

## 安装

    dsh plugin --profile <profile> add dsh-better-setting-page

装完要重启那个 profile 的窗口：浏览器缓存着旧的 bundle。

## 你会得到什么

| | |
|---|---|
| 铺满窗口 | 面板占满整个窗口，圆角与投影去掉。桌面版把标题栏高度留成上边距，那一条仍然能拖动窗口。 |
| 可收起的分类栏 | 页头多一个箭头，一点就把分类栏收成 56px 宽的图标列。分类名留在无障碍树里，读屏和 `Tab` 仍然念得出来。 |
| 记在这个浏览器里 | 两个开关存在本机浏览器 profile 的 `localStorage`，键 `dsh.better-setting-page.settings`。 |
| 自己的一页设置 | **设置 → 设置页** 里有这两个开关和**恢复默认**。没有这一页，讨厌全屏的用户除了卸载插件没别的办法。 |

全屏**默认开**，分类栏**默认展开**。两个都能切，切完重启仍然记得。

关闭方式和以前完全一样：`Esc`、关闭按钮、点遮罩。遮罩还在、还能点，只是全屏时它被
面板盖住了，实际上你会用 `Esc` 或关闭按钮。

分类栏收起是纯 CSS：分类名只是视觉隐藏，没有从文档里删，所以 `Tab` 仍然逐个聚焦、读屏
仍然念得出来。没有「悬停临时展开」：只有那个箭头会切换状态，别的都不动。

## 它怎么做到的

全部状态是这个插件挂在 `<html>` 上的两个属性：

    <html data-bsp-fullscreen="on" data-bsp-nav="collapsed">

一份样式表读它们。没有 `MutationObserver`，不碰宿主 React 树的重渲染，不写宿主的
任何 store。宿主随时可以挂载、卸载、再挂载设置面板，状态早就在根元素上了。

写类似补丁之前，关于宿主 DOM 的三件事值得先知道。

**1. `[data-slot="…"]` 是渲染器的锚点，不是容器。** 渲染器的 `SlotOutlet` 把它输出成
`style: { display: "contents" }`，所以这个元素不产生盒子：它的子元素直接参与**祖父
层**的布局。而且它挂在 `.actions` / `.options` 里面，从来不是 `.header` 的直接子级。
所以：

    /* 对：用后代匹配找到页头所在的那一行 */
    div[data-shortcut-modal="settings"] > div:has([data-slot="settings.action"])
    /* 错：会静默匹配到 .actions */
    div[data-shortcut-modal="settings"] > div:has(> [data-slot="settings.action"])

**2. 遮罩上挂着「点外面关闭」。** `div.mask` 带 `onClick={onClose}`。给它
`display: none` 或 `pointer-events: none` 不是「顺手清干净浮层」，而是无声无息删掉
一个功能。这个插件只摘掉遮罩的**外观**（`background: transparent;
backdrop-filter: none`），盒子和命中区原样留着。

**3. 网格区域名是 CSS-Modules 的哈希。** 只覆盖 `grid-template-columns` 这个长写属性。
重写 `grid-template` 简写会连 `"title header" / "nav options"` 一起重置，布局直接塌。

样式表里没有 `!important`，也没有任何宿主类名：每条规则都锚在
`div[data-shortcut-modal="settings"]` 这个稳定的 data 属性上，特异性 (0,1,1) 本来就
高于宿主的模块类 (0,1,0)。

## 开关

| 字段 | 默认 | 含义 |
|---|---|---|
| `fullscreen` | `true` | 铺满窗口，而不是 800px。 |
| `navCollapsed` | `false` | 把分类栏收成图标列。 |

存储形状：

```json
{ "version": 1, "fullscreen": true, "navCollapsed": false, "unknown": {} }
```

这个版本不认识的键会放进 `unknown` 原样写回，降级或更高版本都不会丢数据。记录坏掉
时回落默认值，不抛错。

## 限制

- **这不是「窗口全屏」。** `html[data-fullscreen]` 是**窗口**的状态，不是这个插件的；
  硬写它连宿主菜单的锚定位置都会一起变。这里只让设置页填满已有的窗口。
- **拖拽带只在桌面版有，而且还没在桌面版验过。** 网页运行时没有标题栏
  （`--dsh-frame-top-clearance` 无值），于是补白算出来是 `max(0px, 0px)`：插件既不补
  上边距、也不加拖拽区 —— 也就是说，这条拖拽带存在的理由，恰好是这一版没法证明的
  东西。在真机桌面版跑过之前，那 40px 拖拽区请当作**未验证**。
- **窄窗口保持宿主布局。** 768px 以下宿主自己就把面板变成全屏 sheet；这时候再收成
  56px 会什么都不剩，因此收起规则放在 `@media (min-width: 768px)` 里。
- **设置按 origin 隔离。** 换个端口就是另一个 profile，两个开关会回到默认。

## 文件

    client.js           浏览器半边：样式表、分类栏开关、设置页
    index.js            host 半边：只为让 bundle 解析得到，不注入任何东西
    cordis.patch.yml    bundle patch
    test/settings-page.test.mjs   30 条断言，零依赖

## 测试

    node --check client.js
    node --check index.js
    node test/settings-page.test.mjs     # → PASS — 30 groups

测试用桩掉的 `window.__ModuleLoader__` 执行真的 `client.js`，然后对导出的字符串和
store 下断言，其中埋了两条**回归陷阱**：一条在页头选择器被「顺手简化」回直接子级时
失败，另一条在全屏规则不再挂在本插件自己的属性上时失败。页面是不是真的铺满窗口属于
机器验证，不是单测能证明的事。

那次机器验证在网页运行时跑过了（Harness `0.2.2-rc.1`，1600×950），四项里过了三项：
面板 rect 等于视口（`{0,0,1600,950}`）、左栏 `188px 1412px` → `56px 1544px` 且
`aria-expanded="false"`、刷新后选择仍在且 `Esc` 与关闭键仍能关。第四项 —— 桌面版
40px 标题带的拖拽区 —— **没有验过**，见[限制](#限制)。

## 许可

MIT
