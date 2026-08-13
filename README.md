# XPPT — Figma 转 PPT 插件

将 Figma 中选中的 Frame 一键转换为可编辑的 PowerPoint（`.pptx`）并下载。文字、形状、线条在 PPT 中保持可编辑，复杂的视觉效果（渐变、模糊、遮罩、特殊多边形等）自动导出为图片以保证视觉一致。

## 功能特性

- **Frame 一键转页**：选中的每个 Frame 自动成为一页幻灯片；无 Frame 时，选中的任意内容合并为一页
- **可编辑输出**：文字（含分段样式）、矩形/圆角矩形/圆形、椭圆、星形、三角形、线条均以原生形状输出，可在 PPT 中继续编辑
- **复杂效果图片化**：渐变填充、图层模糊、遮罩、非标准多边形、旋转容器等自动整块导出为图片，保证视觉还原
- **视觉保真**：支持透明度、投影、描边、虚线、圆角、文字对齐与行高、单行文字防误换行等
- **自适应图片导出**：超大内容自动降低导出倍率、不透明渐变背景自动改用 JPEG，控制生成体积与耗时
- **成本预估**：转换前对内容规模做预估，内容较大时提前提示，避免卡顿
- **可配置输出**：幻灯片尺寸（16:9 / 16:10 / 4:3 / 宽屏）、内容缩放比例（50%–100%）、图片导出精度（1x–4x）
- **智能命名**：默认文件名自动取自选中内容名称
- **进度反馈**：转换与生成过程均有进度弹窗，完成后自动触发浏览器下载

## 安装与使用

### 1. 安装依赖

```bash
npm install
```

### 2. 构建插件

```bash
npm run build
```

构建产物输出到 `dist/ui.html`。

### 3. 在 Figma 中加载

1. 打开 Figma 桌面应用，进入 **Plugins → Development → Import plugin from manifest…**
2. 选择本目录下的 [manifest.json](manifest.json)
3. 在画布中选中要转换的 Frame 或任意内容，运行 **XPPT** 插件
4. 点击「转换为 PPT」，插件将生成 `.pptx` 文件并触发浏览器下载

## 使用说明

| 操作 | 说明 |
| --- | --- |
| 选中 Frame | 每个 Frame 生成一页幻灯片 |
| 混选 Frame + 其他内容 | Frame 每页一页，其余内容合并为一页 |
| 只选其他内容 | 所有选中内容合并为一页 |
| 幻灯片尺寸 | 16:9（默认）、16:10、4:3、宽屏 16:9 |
| 缩放比例 | 控制内容在幻灯片中占用的比例（50%–100%） |
| 导出精度 | 影响图片类元素的清晰度（1x / 2x / 3x / 4x），精度越高文件越大 |

## 技术架构

```
src/
├── code.js          # 主线程：读取选中内容、加载字体、序列化节点树（含图片导出）、成本预估
├── converter.js     # 转换核心：将序列化节点树转换为可编辑 PPT（纯逻辑，可在浏览器与 Node 复用）
├── ui-main.js       # Custom UI 逻辑：选区展示、设置项、进度弹窗、生成并下载 PPTX
└── ui.html          # 插件界面（Custom UI）
build.js             # 构建脚本：用 esbuild 将 ui-main.js 打包内联进 ui.html
manifest.json        # Figma 插件清单
```

- 主线程（[code.js](src/code.js)）负责序列化：判断哪些节点可编辑、哪些需导出为图片，并做图片导出优化
- [converter.js](src/converter.js) 基于 `pptxgenjs` 将序列化数据转换为 PPT：背景、形状、文字、线条、图片与投影
- [build.js](build.js) 将 UI 逻辑打包内联为单文件 `dist/ui.html`，避免 Figma 沙箱加载外部脚本失败

## 开发命令

| 命令 | 说明 |
| --- | --- |
| `npm run build` | 构建插件（输出 `dist/ui.html`） |
| `npm test` | 运行测试（生成示例 PPT，`test/generate-sample.mjs`） |

## 技术栈

- [Figma Plugin API](https://www.figma.com/plugin-docs/)（Custom UI）
- [pptxgenjs](https://github.com/gitbrent/PptxGenJS) — PPT 生成
- [esbuild](https://esbuild.github.io/) — UI 打包
