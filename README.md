# fnos-desktop-new

FNOS 飞牛桌面客户端（**通用 NAS 控制台 + 影视播放**）。基于三个开源参考项目合并而来，取各家优势：

- **基座**：[QiaoKes/fntv-electron](https://github.com/QiaoKes/fntv-electron)（GPL-3.0）——干净的 TS + Go 模块化架构、凭据边界代理、MPV 播放 + 进度回传、FN ID 无头 OAuth。
- **增强**：[YDMY007/Fntv-Plus](https://github.com/YDMY007/Fntv-Plus)（GPL-3.0）——精选移植 system-page 原生桌面模式、玻璃/云母 UI、B 站弹幕、PotPlayer、豆瓣/Bangumi/Trakt 同步、智能跳过等。
- **外壳**：[zhouchunwei513-cyber/fnos-desktop](https://github.com/zhouchunwei513-cyber/fnos-desktop)（MIT）——多服务器分区隔离、锁屏/老板键/开机密码、通用下载断点续传、子应用/FPK 侧车、直播/EPG/录制。

完整的合并设计与移植取舍见 [MERGE-DESIGN.md](./MERGE-DESIGN.md)。

## 目标平台

仅 **Windows 11 (x64)**。Electron 44.4.5（最新 stable）。

## 技术栈

- Electron 44 + TypeScript（tsc 编译，无打包器）
- 本地 Go 代理（流媒体凭据边界，`src/modules/proxy/`）
- node-mpv-2（MPV 硬解播放）
- electron-builder（Win x64 NSIS 安装版）

## 常用命令

```bash
npm install               # 安装依赖
npm start                 # 构建 Go 代理 + 编译 TS + 启动 Electron（需 Go 工具链）
npm test                  # tsc 编译 + 运行单测（node --test）
npm run build:win         # 出 Win x64 NSIS 安装包
```

## 目录结构

```
src/main       主进程（入口 main.ts + common + handlers/core + handlers/plugins）
src/preload    预加载（注入飞牛 Web 的钩子 / 工具 / 功能插件）
src/modules    可复用业务模块（fn_api / fn_config / players / proxy / danmaku / logger / ...）
src/public     注入用的静态资源 / 常量
tests          node --test 单测（.cjs，依赖编译产物 dest/）
third_party    第三方资源（Go 代理源码、MPV 配置；二进制由构建生成，不入库）
build          electron-builder 打包资源（图标等）
```

## 许可证

[GPL-3.0](./LICENSE)。上游版权与协议归属见 [NOTICE.md](./NOTICE.md)。

> 本项目为第三方社区作品，与飞牛 fnOS / 飞牛影视官方无隶属关系。
