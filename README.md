# MDLite — 轻、快、离线的 Markdown 阅读器

参考 [MDLook](https://github.com/drhenriquetea/MDLook) 的功能与交互思路的**轻量重制版**：
无 Electron、无网络依赖、单文件可执行、跨 Windows / macOS，双击 `.md` 秒级打开。

```
技术栈：Tauri 2 + 系统 WebView（Windows: WebView2 / macOS: WKWebView）
体积：  约 10 MB（对比 MDLook 42 MB）    启动：百毫秒级
渲染：  marked + DOMPurify + highlight.js + KaTeX + Mermaid（全部本地内嵌）
```

## 功能

| 类别 | 能力 |
| --- | --- |
| 阅读 | GitHub 风格排版、代码高亮（30+ 语言）、KaTeX 公式（`$…$` / `$$…$$`）、Mermaid 图表、任务列表、表格 |
| 导航 | 大纲侧栏（点击跳转、滚动跟随高亮）、可折叠章节（点击标题折叠，显示内容块数）、相对链接文档间跳转（`Alt+←` 返回）、最近打开 |
| 编辑 | 阅读 / 编辑双模式（`Ctrl+E`），左侧源码右侧实时预览，格式工具栏，`Ctrl+S` 保存（支持 GBK 中文编码读取） |
| 视图 | 亮 / 暗 / 跟随系统三态主题、字号调节、标准 / 宽版列宽、禅模式（`F8`）、自动滚动讲稿模式（`Ctrl+Shift+T`） |
| 文件 | 拖拽打开、文件关联、单实例（重复打开唤起已有窗口）、磁盘文件变更自动重载、相对路径图片显示 |
| 导出 | 一键导出单文件 HTML（内嵌公式字体与主题样式，可直接分享） |

## 构建

依赖：[Rust](https://rustup.rs)（Windows 需 MSVC 工具链）、WebView2 运行时（Win10/11 一般自带）。
前端为纯静态资源（`ui/`），构建时内嵌进可执行文件，**不需要 Node**。

```bash
cd src-tauri
cargo build --release
# 产物：target/release/mdlite.exe
```

> 网络提示：若你的 cargo 镜像不可用，本仓库 `src-tauri/.cargo/config.toml` 已配置 rsproxy.cn 镜像（仅对本项目生效，不修改全局配置）。

### macOS

```bash
cd src-tauri
cargo build --release
# 打包成可双击、可文件关联的 .app（含图标与文档类型声明）
bash ../scripts/make-mac-app.sh
# 产物：target/release/bundle/MDLite.app
```

## 把 MDLite 设为 `.md` 的默认打开方式

**Windows**（写入 HKCU，无需管理员）：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\register-fileassoc.ps1
# 之后在任意 .md 文件上：右键 → 打开方式 → 选择 MDLite → 始终
```

**macOS**：运行 `make-mac-app.sh` 生成 `MDLite.app` 后，在任意 `.md` 文件上
`右键 → 显示简介 → 打开方式 → MDLite → 全部更改`。

## 快捷键

| 按键 | 功能 | 按键 | 功能 |
| --- | --- | --- | --- |
| `Ctrl+O` | 打开文件 | `Ctrl+E` | 阅读 / 编辑切换 |
| `Ctrl+S` | 保存 | `Ctrl+B` | 大纲（编辑模式中为加粗） |
| `Ctrl+F` | 查找 | `F8` | 禅模式 |
| `Ctrl+Shift+T` | 自动滚动 | `F1` | 帮助 |
| `Alt+←` | 返回上一文档 | `Esc` | 关闭浮层 |

## 与 MDLook 的差异

保留：文件关联、双栏实时预览、KaTeX、Mermaid、代码高亮、暗色模式、禅模式、大纲、章节折叠、导出 HTML、单实例、自动重载。
有意省略（为保持轻量）：系统托盘常驻、开机自启、注册表级关联安装器、字体缩放记忆之外的高级排版选项。启动从「托盘常驻秒开」改为「冷启动百毫秒级」。

## 目录结构

```
├── ui/                    前端（纯静态，无构建步骤）
│   ├── index.html / style.css / app.js
│   └── vendor/            marked / DOMPurify / highlight.js / KaTeX / Mermaid（本地化）
├── src-tauri/             Tauri 2 工程
│   ├── src/main.rs        文件读写、对话框、链接解析、变更监听、单实例
│   ├── tauri.conf.json
│   └── icons/
├── scripts/               文件关联（Windows）与 macOS .app 打包脚本
├── samples/demo.md        功能演示文档
```

## 安全说明

- 渲染内容经 DOMPurify 消毒，Mermaid 以 strict 模式运行，文档中的脚本不会执行
- 文档内相对链接只允许解析到本地存在的文件；外链仅允许 http/https 且交由系统浏览器打开
