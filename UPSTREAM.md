# 上游改动清单

基线：`michalsnik/aos`，分支 `next`，版本 `3.0.0-beta.6`，259 个提交全部保留。

本文件记录三件事：**改了哪些上游文件**、**新增了哪些文件**、**在上游发现的问题**。所有改动都是增量式的，不改变任何既有默认行为。

---

## 1. 修改的上游文件

### 1.1 `src/js/aos.js`

唯一被修改的 JavaScript 文件。改动全部是新增：

| 改动 | 位置 | 说明 |
|---|---|---|
| 样式导入方式 | 第 7 行 | `import styles from './../sass/aos.scss'` → `import './../sass/aos.scss'` |
| 新增 import | 顶部 | `createScrubEngine`、`collectScrubNodes`、`readScrubAttributes` |
| 新增私有变量 | `let scrubEngine = null` | 懒创建，未启用时零成本 |
| 新增默认选项 | `options` 对象 | `scrub: false`、`scrubMode: 'raf'`、`respectReducedMotion: true` |
| 新增函数 | `getEngine()` / `scrubFromAttributes()` / `scrub()` / `destroy()` | 引擎生命周期与注册入口 |
| 新增调用 | `initializeScroll()` 末尾 | `if (options.scrub) scrubFromAttributes();` |
| 扩展导出 | 文件末尾 | 原 `{ init, refresh, refreshHard }` 增加 `scrub`、`scrubFromAttributes`、`getEngine`、`destroy` |

**为什么改样式导入方式**：Vite 6 起 CSS 模块不再提供 default 导出，`import styles from` 会在构建时报 `"default" is not exported`。上游 `rollup-plugin-postcss` 配置了 `extract: 'dist/aos.css'`，side-effect import 同样能触发提取，因此这个改动对上游自身的 rollup 构建是安全的。`styles` 变量在上游代码里从未被使用。

**为什么所有新行为都是 opt-in**：`scrub` 默认 `false`，`data-aos-scrub` 元素在未开启时完全不参与。`tests/e2e/upstream.spec.js` 用 9 个用例守住这条线。

### 1.2 `src/sass/aos.scss`

```diff
 @import 'core';
 @import 'easing';
 @import 'animations';
+@import 'scrub';
```

---

## 2. 新增的文件

### 2.1 引擎（`src/js/scrub/`）

| 文件 | 职责 | 关键设计 |
|---|---|---|
| `easing.js` | cubic-bezier 数值求解 | Newton-Raphson 6 次迭代 + 24 次二分兜底；`AOS_PRESETS` 保持上游原值，`TRUE_PRESETS` 提供修正曲线；`sampleTable()` 把曲线预采成 256 项查找表 |
| `keyframes.js` | 轨道模型与求值 | 关键帧按 `p` 排序、去重、clamp；段内缓动取「到达该帧」的 `ease`（与 CSS 语义对齐）；`composeStyles()` 只输出有轨道的 CSS 表面 |
| `progress.js` | 进度映射 | `element`（元素进出视口）与 `page`（整页）两种模式；`measureElementBounds()` 只在 measure 时读一次几何 |
| `engine.js` | 调度与写入 | 单 rAF 循环；读-算-写三段分离；写入前 diff，相同则跳过并计入 `skips`；支持外部 `scrollSource`（工作室的局部滚动容器）；内置遥测 |
| `schema.js` | 文档模型 | 归一化、校验、往返序列化；`MOTION_PRESETS` 六个动效配方 |
| `attributes.js` | 声明式解析 | `data-aos-track="prop:from>to;..."` 语法；未知属性被忽略而不是产生坏 transform |
| `index.js` | 公共出口 | 供 `aos.js` 与工作室共用 |

### 2.2 样式（`src/sass/_scrub.scss`）

`[data-aos-scrub]` 的 compositor 提示、`.aos-pin*` 三件套、`prefers-reduced-motion` 降级。

### 2.3 工作台（`studio/`）

完整的 Vite 应用，见 README §6。核心模块：

- `src/core/store.js` —— 工程状态 + 快照式撤销/重做 + 事务（一次拖拽 = 一条历史）
- `src/core/exporters.js` —— CSS / JS / JSON / HTML 四个导出目标
- `src/ui/stage.js` —— 滚动舞台、设计稿等比缩放、引擎注册
- `src/ui/timeline.js` —— 以滚动进度为横轴的时间轴，关键帧拖拽 / 插入 / 删除 / 区间把手
- `src/ui/inspector.js` —— 属性面板
- `src/ui/layers.js` —— 图层列表与预设网格
- `src/ui/exportDialog.js` —— 导出对话框

---

## 3. 在上游发现的问题（未静默修改）

### 3.1 `linear` 不是线性

`src/sass/_easing.scss` 第 2 行：

```scss
linear: cubic-bezier(.250, .250, .750, .750),
```

这是一条近似 smoothstep 的曲线，不是 `y = x`。用它做 `data-aos-easing="linear"` 的元素会得到轻微 S 形缓动，而不是匀速。

**处理方式**：`TRUE_PRESETS.linear = [0,0,1,1]`，`AOS_PRESETS.linear` 保留原值。CSS 导出走 `TRUE_PRESETS`，`data-aos-easing` 仍走上游 SCSS。

### 3.2 六条缓动曲线互相重复

| 上游名称 | 上游取值 | 与谁重复 |
|---|---|---|
| `ease-in-cubic` | `.55,.085,.68,.53` | 与 `ease-in-quad` 相同 |
| `ease-out-cubic` | `.25,.46,.45,.94` | 与 `ease-out-quad` 相同 |
| `ease-in-out-cubic` | `.455,.03,.515,.955` | 与 `ease-in-out-quad` 相同 |
| `ease-in-quart` | `.55,.085,.68,.53` | 与 `ease-in-quad` 相同 |
| `ease-out-quart` | `.25,.46,.45,.94` | 与 `ease-out-quad` 相同 |
| `ease-in-out-quart` | `.455,.03,.515,.955` | 与 `ease-in-out-quad` 相同 |

看起来是复制粘贴遗留：cubic 与 quart 两档直接沿用了 quad 的数值。

**处理方式**：`TRUE_PRESETS` 给出标准 cubic / quart 曲线，`AOS_PRESETS` 保留原值。`tests/unit/easing.test.js` 有两个用例显式断言「上游这两组相同、修正表里不同」，防止有人顺手把上游「修好」从而改变既有页面的观感。

### 3.3 工具链已不可安装（记录，未修）

`package.json` 锁定 `cypress@2`、`node-sass@4`、`rollup@0.58`、`babel-core@6`。在 Node 22 上 `npm install` 会失败（node-sass 无对应预编译二进制）。

本仓库的处理方式：**不修改上游 `package.json`**，工作台用独立的 `studio/package.json`；上游 cypress 用例的等价断言移植到 `studio/tests/e2e/upstream.spec.js`。

---

## 4. 行为契约（e2e 守门）

`studio/tests/e2e/upstream.spec.js` 的 9 个用例：

1. `data-aos` 元素获得 `aos-init`，进入视口后获得 `aos-animate`
2. `<body>` 上写入 `data-aos-easing` / `data-aos-duration`
3. 二值路径**不写**内联 `transform`（证明没有偷偷接管）
4. `refresh()` / `refreshHard()` 仍可调用
5. `data-aos-scrub` 的连续进度在 0% / 50% / 100% 三点的精确值
6. 映射区间在窗口外保持端点值
7. `AOS.scrub()` 选择器配置生效
8. `AOS.scrub()` 对多匹配元素逐个注册
9. `prefers-reduced-motion: reduce` 下直接跳到终态关键帧

任何一条失败，都意味着这次改动破坏了上游兼容性。
