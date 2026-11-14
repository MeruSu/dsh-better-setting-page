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
| 可收起的分类栏 | 页头**最左**多一个箭头，一点就把分类栏收成 56px 宽的图标列。分类名留在无障碍树里，读屏和 `Tab` 仍然念得出来。 |
| 记在这个浏览器里 | 两个开关存在本机浏览器 profile 的 `localStorage`，键 `dsh.better-setting-page.settings`。 |
| 自己的一页设置 | **设置 → 设置页** 里有这两个开关、一份**屏蔽列表**和**恢复默认**。没有这一页，讨厌全屏的用户除了卸载插件没别的办法。 |

全屏**默认开**，分类栏**默认展开**。两个都能切，切完重启仍然记得。

页头按设置页该有的样子摆：**左上是展开/收起，右上才是退出**。右上那个关闭键现在画的是
**拐弯的返回箭头**，不再是叉号。它仍然是宿主自己的按钮——同一个节点、同一个点击处理、
同一个无障碍名字——所以怎么关没变，只是长什么样变了。

关闭方式和以前完全一样：`Esc`、关闭按钮、点遮罩。遮罩还在、还能点，只是全屏时它被
面板盖住了，实际上你会用 `Esc` 或关闭按钮。

分类栏收起是纯 CSS：分类名只是视觉隐藏，没有从文档里删，所以 `Tab` 仍然逐个聚焦、读屏
仍然念得出来。没有「悬停临时展开」：只有那个箭头会切换状态，别的都不动。

## 它怎么做到的

全部状态是这个插件挂在 `<html>` 上的两个属性：

    <html data-bsp-fullscreen="on" data-bsp-nav="collapsed">

一份样式表读它们。不在宿主的 React 树上重渲染；唯一的 `MutationObserver` 盯的是
`document.body` 上「面板被 portal 进来」这件事，它给分类栏的行打一个 data 属性，不改
宿主自己的结构。宿主的 store 只在 `openSection` 那一处被调用（那本来就是打开一页的
正规办法）。宿主随时可以挂载、卸载、再挂载设置面板：两个开关的状态早就在根元素上了，
行上的标记每次挂载都会重新打一遍。

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
| `hidden` | `[]` | 从分类栏里移走的页面 id，见[屏蔽设置页](#屏蔽设置页)。 |

存储形状：

```json
{ "version": 1, "fullscreen": true, "navCollapsed": false, "hidden": [], "unknown": {} }
```

这个版本不认识的键会放进 `unknown` 原样写回，降级或更高版本都不会丢数据。记录坏掉
时回落默认值，不抛错。

## 屏蔽设置页

每装一个带设置页的插件，左边的分类栏就多一行；有些行你一辈子都不会点。这一页可以把
它们从分类栏里移走，不用卸载任何东西 —— 而且移走之后，仍然从这一页进得去。

列表是从槽位注册表读的（`ctx.slots.entries("settings.section")`），不是从 DOM 抓的。
冷启动时分类栏还没挂载，靠 DOM 抓会拿到空列表，然后把你的选择覆盖成空。

- **所有页面都列出来，包括已经屏蔽的。** 已屏蔽的那一行在这一页里仍然能点、点了正常
  进入。这就是这个功能的意义：如果屏蔽之后只能从「屏蔽它的那一页」才进得去，那还是
  进得去；真正不能接受的是屏蔽变成单向门。
- **这一页不能屏蔽自己。** 它没有勾选框；就算别处硬写进去，它自己的 id 也不会留在
  `hidden` 里。
- **你正待在被屏蔽的那一页上时，那一行会回来。** 规则是
  `nav [data-bsp-hidden="1"]:not([aria-current="true"])`，所以从列表点进去之后，分类栏
  仍然告诉你「你在哪」。
- **跳转是核对过的，不是发出去就不管。** 点击先走宿主自己的 store（`openSection`），
  然后轮询 `aria-current` 约 320ms；store 那一步没落地就直接点那一行。store 只改
  `activeId`，并不保证渲染。

`hidden` 存的是页面 id：字符串、去空白、去重复、不收空串、不收这一页自己的 id，最多
64 条。

## 限制

- **这不是「窗口全屏」。** `html[data-fullscreen]` 是**窗口**的状态，不是这个插件的；
  硬写它连宿主菜单的锚定位置都会一起变。这里只让设置页填满已有的窗口。
- **拖拽带只在桌面版有，而且还没在桌面版验过。** 网页运行时没有标题栏
  （`--dsh-frame-top-clearance` 无值），于是补白算出来是 `max(0px, 0px)`：插件既不补
  上边距、也不加拖拽区 —— 也就是说，这条拖拽带存在的理由，恰好是这一版没法证明的
  东西。在真机桌面版跑过之前，那 40px 拖拽区请当作**未验证**。
- **窄窗口保持宿主布局。** 768px 以下宿主自己就把面板变成全屏 sheet；这时候再收成
  56px 会什么都不剩，因此收起规则放在 `@media (min-width: 768px)` 里。
- **设置按 origin 隔离。** 换个端口就是另一个 profile，两个开关和屏蔽列表都会回到默认。
- **屏蔽只是改分类栏，不是卸载。** 被屏蔽的页面仍然存在、仍然注册、仍然在跑，只是那一行
  不见了。它对应的插件并没有被停用，所以别拿这个当「关掉一个你信不过的插件」。

## 文件

    client.js           浏览器半边：样式表、分类栏开关、设置页
    index.js            host 半边：只为让 bundle 解析得到，不注入任何东西
    cordis.patch.yml    bundle patch
    test/settings-page.test.mjs   53 条断言，零依赖

## 测试

    node --check client.js
    node --check index.js
    node test/settings-page.test.mjs     # → PASS — 53 groups

测试用桩掉的 `window.__ModuleLoader__` 执行真的 `client.js`，然后对导出的字符串和
store 下断言，其中埋了四条**回归陷阱**：一条在页头选择器被「顺手简化」回直接子级时
失败，一条在全屏规则不再挂在本插件自己的属性上时失败，一条在隐藏规则不再只圈我们自己
标记过的行时失败，还有一条在安装时不再应用已存的屏蔽列表时失败（少了它，屏蔽要等你手动
改一次设置才生效）。页面是不是真的铺满窗口属于机器验证，不是单测能证明的事。

条数是下限不是奖章：每条变异都实测过会把套件变红才复原 —— 隐藏规则去掉
`[data-bsp-hidden]`（红 3 条）、`openSection` 去掉自身豁免（红 1 条）、`installNavSync`
去掉 `applyHiddenRows` 调用（红 1 条）、`sanitizeHidden` 保留这一页自己的 id（红 2 条）。

单测用的是假 document，证明不了选择器、`querySelectorAll` 和 `MutationObserver` 在真
DOM 上成立。所以真的 `client.js` 另外在 Chrome 里跑了一遍：对着从宿主面板抄下来的
DOM、用一个假 ctx 让分类槽返回八条，并且**先 `apply()` 再不挂面板**（真的冷启动顺序，
面板是用户打开设置时才被 portal 进来的）。实测结果：

| 步骤 | 结果 |
|---|---|
| 面板不存在时 `apply()` | 没东西可标，不抛错 |
| 面板被 portal 进来 | observer 标满 8 行，并把已存的屏蔽列表重新应用 |
| 屏蔽 `models` + `plugins` | 这两行 `display: none`，其余六行不动 |
| 写入 `hidden: ['models', 'better-setting-page']` | 存下来是 `["models"]` —— 自己的 id 被丢掉 |
| `openSection('models')` | store 收到 `openSection:models`，那行变成 `aria-current` 并**重新出现**（`display: flex`） |
| 面板拆掉再挂上 | observer 重新标记、重新隐藏，不需要再写一次设置 |

那次机器验证在网页运行时跑过了（Harness `0.2.2-rc.1`，1600×950），四项里过了三项：
面板 rect 等于视口（`{0,0,1600,950}`）、左栏 `188px 1412px` → `56px 1544px` 且
`aria-expanded="false"`、刷新后选择仍在且 `Esc` 与关闭键仍能关。第四项 —— 桌面版
40px 标题带的拖拽区 —— **没有验过**，见[限制](#限制)。

页头布局在 0.1.2 重新量过（网页运行时 1264×805）：左栏展开时开关在 x `66`、宿主那个
「打开配置文件」在 x `1108`、关闭键在 x `1210`，也就是「收起在左、宿主按钮靠右、退出在最右」，
整组靠 `margin-right: auto` 顶到右边缘。开关的位置不依赖注册顺序：`order: -1` 是把活 DOM 里两个
子节点对调后再量的（仍然 x `66` 对 x `1108`）。内容居中也是量过的：`[data-slot="settings.section"]`
里的页面宽 880px、`margin-inline: auto`，在 1208px 宽的列里落在 x `220`，两侧各留 124px（宿主自己的
页面比如「通用设置」也是同样限宽居中）。

## 许可

MIT
