# fnos-desktop-new · 合并设计（MERGE-DESIGN）

> 目标：把三个参考项目的优势合并成**一个**客户端——"通用 fnOS 控制台外壳 + 视频引擎 + 全套增强"。
> 参考：`zhouchunwei513-cyber/fnos-desktop`（外壳）、`QiaoKes/fntv-electron`（基座）、`YDMY007/Fntv-Plus`（增强）。
> 本地参考源码：`D:/Qoder-Project/_refs/`（临时，可删；权威来源是上述 GitHub 仓库）。

---

## 1. 已定决策（2026-09-24）

| # | 决策 | 结论 |
|---|---|---|
| 1 | License | **整包 GPL-3.0（开源）**。基座 fntv-electron 与移植的 Fntv-Plus 均为 GPL-3；fnos-desktop 为 MIT（可并入）。合并程序按 GPL-3.0 发布。 |
| 2 | 基座 | **fntv-electron（更干净、有单测、易维护）为基** + **精选移植 Fntv-Plus 模块** + **嫁接 fnos-desktop 外壳能力**。 |
| 3 | 范围 | **全量做**：直播/EPG/录制 ✅、向 NAS 推 FPK 侧车 ✅、锁屏/老板键/下载续传/多服务器隔离 ✅。 |
| 4 | 平台/Electron | **仅 Windows 11**，采用**最新版 Electron**（脚手架时 pin 最新 stable；参考 fnos-desktop 已在 Electron 44）。**放弃 Win7/Win10 兼容**（删除 GPU-safety 旧 Chromium 开关那一堆补丁）。 |

> 推论：只出 Windows x64 包（NSIS 安装版），mac/linux 的 CI/构建脚本可先不搭（保留结构，标注不适用）。

---

## 2. 基座与谱系

- **基座 = fntv-electron**：TS（tsc 编译，无打包器）+ Go 本地代理 + node-mpv-2；`src/main`（主进程）/`src/preload`（注入）/`src/modules`（业务）/`src/public`；14 个 `node --test` 单测；凭据边界 Go 代理（`127.0.0.1:22345`，secret 走 stdin，24h 会话 + `allowedItems` 白名单 + 常量时间比密钥）。
- **GPL-3.0**：保留两个上游仓库的版权与致谢（fntv-electron © QiaoKes；Fntv-Plus 修改署名 YDMY007；fnos-desktop © MIT contributors）。`LICENSE` 用 GPL-3。
- 合并后：`fntv-electron` 的干净核心 + `Fntv-Plus` 的精选增强 + `fnos-desktop` 的外壳四件套。

---

## 3. 统一架构（目标目录）

在 fntv-electron 的目录树上扩展：

```
fnos-desktop-new/
├─ src/
│  ├─ main/                       # 主进程（基座 = fntv-electron）
│  │  ├─ main.ts                  # 入口（基座；新增：多服务器 currentPartition 管理、lock、downloads 生命周期）
│  │  ├─ common/                 # 基座 + 移植
│  │  │  ├─ mainwin.ts           # ← 移植 Fntv-Plus「system-page 模式」(fntv:enter/exit-system-page + 导航守卫 /app 豁免)
│  │  │  ├─ partition.ts         # ★新增：partitionForServer / currentPartition（源自 fnos-desktop，参数化 persist:nas-<hash>）
│  │  │  ├─ session.ts           # 从 persist:fntv 写死 → 用 currentPartition（interceptor/cookie 全走这里）
│  │  │  ├─ tray.ts / winctrl.ts # 基座；加「老板键 hideCompletely」「全局快捷键」(← fnos-desktop)
│  │  │  └─ proxyDaemon/Secret/Health/Session  # 基座保留
│  │  └─ handlers/
│  │     ├─ core/               # ipcHandler / interceptor / appHook（基座；interceptor 参数化分区）
│  │     └─ plugins/
│  │        │ # —— 基座保留：media / auth / login / fnid_login / tray / wincontrol / update / config / mpvConfig / clean / logger
│  │        ├─ lock.ts          # ★新增：开机密码(scrypt)、一键锁定、老板键、空闲自动锁、全局快捷键 (← fnos-desktop)
│  │        ├─ downloads.ts     # ★新增：通用文件下载 + 断点续传 DownloadManager (← fnos-desktop)
│  │        ├─ subapp.ts        # ★新增：独立窗口子应用 + FPK 侧车客户端 fntb:18080 (← fnos-desktop)
│  │        ├─ live.ts          # ★新增：hls.js 直播 + EPG(XMLTV 正则) + 回看 + 录制(TS 分片) (← fnos-desktop)
│  │        ├─ glassUI.ts      # ← Fntv-Plus（玻璃/云母，纯 CSS，可独立）
│  │        ├─ danmakuWeb.ts   # ← Fntv-Plus（B 站弹幕获取/匹配）
│  │        ├─ potplayerCtl.ts # ← Fntv-Plus（配合 modules/potplayer + proxy/potctl）
│  │        ├─ syncDouban.ts / syncTrakt.ts / syncBangumi.ts  # ← Fntv-Plus
│  │        ├─ smartSkip.ts     # ← Fntv-Plus（theintrodb/AniSkip）
│  │        └─ (watchHistory / personTmdb / fnosAuth / libraryIndex / settings 细粒度)  # ← Fntv-Plus 按需
│  ├─ preload/                   # 注入层（基座 + 移植）
│  │  ├─ index.ts                # 基座：file:// 白名单 + 远端 DOM hooks
│  │  ├─ core/                  # hooks / playback / playTarget / logger（基座）
│  │  ├─ plugins/
│  │  │  │ # —— 基座：playButton / playMaskButton / titlebar
│  │  │  ├─ titlebarSystem.ts   # ★新增：原生桌面 / 分支的标题栏注入 + 子应用探测 (← fnos-desktop titlebar-inject.js)
│  │  │  ├─ gamepad.ts          # ← Fntv-Plus
│  │  │  ├─ watchHistory.ts     # ← Fntv-Plus
│  │  │  └─ (embyWall 3D/detail 见 §5「延后」)
│  └─ modules/                   # 业务库（基座 + 移植 + 新增）
│     ├─ fn_api / fn_config / logger / cert_trust / updater / players / proxy   # 基座保留
│     ├─ danmaku/                # ← Fntv-Plus（biliDanmaku + subtitleMerge）
│     ├─ players/impl/potplayer.ts  # ← Fntv-Plus
│     ├─ proxy/potctl/、danmaku.go、headcache.go  # ← Fntv-Plus（Go）
│     ├─ fpk/                    # ★新增：fntb 侧车(:18080) API 客户端 (← fnos-desktop)
│     └─ password/               # ★新增：scrypt 哈希/校验（供 lock 用）(← fnos-desktop)
├─ fntb-fpk/                    # ★新增：可安装到 NAS 的自定义 FPK 包（Go server + 安装/升级回调 + manifest）
│                               #    移植自 fnos-desktop 的 zdy-fpk/（重命名，避免与 Fntv-Plus 刮削"fpk"混淆）
├─ third_party/                 # mpv / proxy(Go 源码) / potplayer(运行时)
├─ resource/                   # login 页、docs、wiki
├─ tests/                       # node --test（基座 14 个 + 新增 partition/lock/downloads 用例）
├─ scripts/ .github/workflows/  # Win x64 NSIS；CI（自托管 runner）；日志写仓库外
├─ tsconfig.json package.json
└─ LICENSE (GPL-3.0)
```

---

## 4. 关键改造（把三家拼起来的一刀）

1. **分区参数化（最 invasive）**
   - 现状：fntv-electron/Fntv-Plus 全程写死 `persist:fntv`（mainwin/interceptor/auth/fnid_login/winctrl 共 6+ 处）。
   - 目标：新增 `modules` 里的 `partition.ts`（照 fnos-desktop `partitionForServer(parsed)`：`persist:nas-<sanitized-origin-hash>`，FN ID 用 baseHref 区分），主进程维护 `currentPartition`；`interceptor.init(currentPartition)`、cookie 恢复、OAuth 临时分区全部改走 `currentPartition`。
   - 效果：**多台服务器/多账号并行登录态物理隔离**，切服务器不丢登录（fnos-desktop 的核心卖点，基座完全没有）。

2. **凭据/加密统一**
   - 沿用基座 `fn_config`：设置走 AES-256-CBC，敏感 token 走 Electron `safeStorage`（Win11 DPAPI/凭据管理器），保留 legacy 迁移。
   - 叠加 fnos-desktop 的 `scrypt+16B 随机盐+timingSafeEqual` 作为「开机启动密码」，锁屏窗口屏蔽 Alt+F4/Esc/F5/DevTools。

3. **Win11 / 最新 Electron**
   - 删除 fnos-desktop 的 Win7/GPU-safety/旧 Chromium flag 补丁块；`package.json` pin 最新 stable Electron（脚手架时定，≥ 参考的 44）。
   - 只出 NSIS Win x64；mac/linux 构建与签名脚本标注「暂不启用」。

4. **License = GPL-3.0**
   - `LICENSE` 换 GPL-3；`README` 写清版权归属（fntv-electron / Fntv-Plus / fnos-desktop 三处致谢 + 合并署名）。
   - Go 代理、potctl 一并纳入 GPL-3 范围。

5. **preload 注入范围扩展**
   - 基座 preload 只注入 `/v`（影视）。新增「系统页 `/` + 子应用」分支（titlebarSystem + 子应用探测），照 fnos-desktop `titlebar-inject.js`。

6. **命名去歧义**
   - Fntv-Plus 的 `extScraper` 里 "fpk"=**影视刮削**；fnos-desktop 的 FPK=**飞牛应用包 + fntb 侧车**。新代码里侧车统一叫 `fpk/fntb`（`fntb-fpk/` 包 + `modules/fpк→fpk`），刮削侧改名 `scraper`，避免撞名。

---

## 5. 移植清单（哪家 → 哪块，及取舍）

### A. 基座保留（fntv-electron，不动核心）
主/预加载/渲染分层 · 插件式 `init()/registerHook` 总线 · `SessionInterceptorManager` · 凭据边界 Go 代理 · 播放器抽象(MPV)+进度回传 · FN ID 无头 OAuth · `fn_api` · `cert_trust` · `logger`(脱敏) · 更新检查 · 14 个单测。

### B. 精选移植 Fntv-Plus（稳/自包含的先搬，脆的延后）

| 模块 | 源 | 取舍 | 理由 |
|---|---|---|---|
| system-page 模式 | mainwin | ✅ 搬 | 独立、小，直接给「通用外壳」打底 |
| glassUI（玻璃/云母） | preload/plugins + settings | ✅ 搬 | 纯 CSS、`data-*` 门控，自包含 |
| danmaku + proxy danmaku.go/headcache.go | modules/danmaku + Go | ✅ 搬 | 自包含，价值高 |
| potplayer + potctl | players/impl + proxy/potctl | ✅ 搬 | 自包含（Windows WM_USER 协议） |
| Douban/Trakt/Bangumi 同步 | handlers + fn_config | ✅ 搬 | 逻辑独立 |
| smartSkip（theintrodb/AniSkip） | handlers + skip | ✅ 搬 | 依赖已有 proxy |
| watchHistory / personTmdb / fnosAuth / libraryIndex / settings 细粒度 | handlers | ◑ 按需 | 价值中，随需要 |
| gamepad（手柄导航） | preload/plugins/gamepad | ◑ 按需 | 锦上添花 |
| **embyWall（3D 轮播 + Netflix 详情页）** | preload/plugins/embyWall | ⏸ 延后 | 重度耦合 fnOS React 类名，飞牛前端一升级易碎；P3 再评估 |
| **热补丁 patcher/patchOverlay/00_patchfix** | main + modules | ⏸ 延后/弃 | 依赖 `Module._resolveFilename` 猴补，基座本身脆；与「干净基座」相悖，P4 再说 |

### C. 嫁接 fnos-desktop（外壳四件套 + 直播）

| 能力 | 源（main.js 段） | 落点 | 说明 |
|---|---|---|---|
| 多服务器 `persist:nas-*` 隔离 | `partitionForServer`/`initSharedSession` | `common/partition.ts` + `session.ts` | §4.1 一刀 |
| SameSite cookie 自愈 | `relaxCookiePolicy` | `session.ts` | 免重新登录 |
| 锁屏/老板键/开机密码/自动锁/全局快捷键 | 各段 | `handlers/plugins/lock.ts` + `modules/password` | §4.2 |
| 通用下载断点续传 | `DownloadManager`/`installDownloadTracker` | `handlers/plugins/downloads.ts` | `.part`+rename、跨会话去重、取消不回写 NAS |
| 子应用独立窗口 + FPK 侧车 | `createAppWindow`/fntb:18080 + `zdy-fpk/` | `handlers/plugins/subapp.ts` + `modules/fpk` + `fntb-fpk/` | 往 NAS 推 FPK 包；独立窗口化 |
| 直播/EPG/回看/录制 | hls.js + XMLTV 正则 + TS 分片 | `handlers/plugins/live.ts` | 若入围（已定要做） |
| 秒开 wscript + loopback 握手 | `__startLaunchServer` 等 | P4 可选 | 最脆，最后做 |

---

## 6. 分阶段实施

- **P0 决策/脚手架**（本次之后）：定 Electron 精确版本；把 fntv-electron 拷入 `fnos-desktop-new` 作基座；`LICENSE`→GPL-3；去掉 mac/linux 构建；跑通 `node --test`。
- **P1 MVP（外壳打底）**：`partition.ts`/`session.ts` 参数化 + 多服务器登录 + 锁屏/老板键/开机密码 + 通用下载续传。交付「能连多台 NAS 且登录态隔离 + 有锁屏 + 能下文件」的最小可用版。
- **P2 子应用**：`subapp.ts` + `modules/fpk` + `fntb-fpk` 侧车（往 NAS 装包 + 独立窗口化应用）。
- **P3 直播 + Fntv-Plus 增强**：`live.ts`(EPG/录制)；搬 glassUI/danmaku/potplayer/同步/smartSkip；评估 embyWall。
- **P4 打磨/可选**：秒开握手、热补丁（谨慎）、凭据加密收口、i18n/无障碍。

每阶段遵循既有两段式流程：**本机 Docker/Win11 实机跑通验证 → 推自托管 CI(Gitea runner) 复跑并发布**；构建日志写仓库外；注释与提交用简体中文。

---

## 7. 风险与验证

- **分区参数化**是最易引入回归的一刀（基座 6+ 处写死 `persist:fntv`）。补 `tests/partition*.test.cjs` 覆盖「切服务器登录态不串」。
- **Fntv-Plus 增强**对 fnOS React 类名/选择器有耦合（glassUI 用 `[class*="card"]` 等）——飞牛前端升级可能静默失效；用 `settings` 提供「关闭全部增强」总开关兜底。
- **FPK 侧车**要往 NAS 装包，多一个部署面与失败态（NAS 端未装 fntb 时要有降级：只走原生 `/app` 导航）。
- **GPL-3**：整包开源是前提；若将来要闭源，需重新评估（本设计假设已接受 GPL-3）。
- **Win11 单平台**：简化构建，但失去 mac/linux 覆盖（视频家族原本跨平台）；确认这是可接受的范围收窄。

---

## 8. 待确认/待办
- [ ] P0：定 Electron 精确 stable 版本（脚手架时查最新）。
- [ ] P0：确认「精选移植」清单中 ◑/⏸ 项的最终取舍（embyWall、gamepad、热补丁 默认延后）。
- [ ] P1 之前：确认 `fntb-fpk` 侧车是否允许「NAS 端未装则降级」为可接受行为。
- [ ] 是否需要保留基座「自动检查更新」指向的更新源（换成新仓库的 release 源）。
