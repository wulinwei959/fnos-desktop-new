import { BrowserWindow, BrowserWindowConstructorOptions } from 'electron';
import * as path from 'path';
import { currentPartition } from './partition';
import * as log from '../../modules/logger';

const isMac = process.platform === 'darwin';

const mainwinConfig: BrowserWindowConstructorOptions = {
    width: 1400,
    height: 800,
    minWidth: 800,
    minHeight: 800,
    autoHideMenuBar: true,
    show: false,
    icon: path.join(__dirname, '../../../build/icon.ico'),
    // macOS 使用系统交通灯按钮，但让现有页面继续延伸到标题栏区域。
    // Windows/Linux 保持原有的无边框窗口和自定义窗口按钮。
    frame: isMac,
    ...(isMac && {
        titleBarStyle: 'hiddenInset' as const,
        trafficLightPosition: { x: 14, y: 14 },
    }),
    // transparent: true,
    webPreferences: {
        webgl: true,
        partition: currentPartition(),
        preload: path.join(__dirname, '../../preload/index.js'),
        nodeIntegration: false,
        contextIsolation: true,
        // preload 仍需加载项目内模块；后续完成单文件打包后可再启用 sandbox。
        sandbox: false,
        spellcheck: false,  // 禁用拼写检查，避免输入法干扰
    }
};

let mainwin: BrowserWindow | null = null;

/**
 * 获取主窗口实例
 * @returns {BrowserWindow}
 */
export function getMainWindow(): BrowserWindow {
    if (!mainwin) {
        mainwin = new BrowserWindow(mainwinConfig);
        // 导航 URL 日志：桌面优先策略下，排查落地/重定向（如 / 是否被重定向到 /v）很有用
        mainwin.webContents.on('did-navigate', (_e, url) => log.info('[导航] did-navigate →', url));
        mainwin.webContents.on('did-navigate-in-page', (_e, url) => log.info('[导航] in-page →', url));
        // 桌面里通过 window.open 打开的应用窗口（如"飞牛影视"）不会自动继承主窗口的 preload，
        // 必须显式补齐 webPreferences，否则播放按钮注入 / IPC 桥接全部失效。
        // 注意：这里不指定 partition，子窗口继续共享打开者的会话（登录态不丢）。
        mainwin.webContents.setWindowOpenHandler(() => ({
            action: 'allow',
            overrideBrowserWindowOptions: {
                autoHideMenuBar: true,
                frame: isMac,
                minWidth: 800,
                minHeight: 600,
                icon: mainwinConfig.icon,
                webPreferences: {
                    webgl: true,
                    preload: path.join(__dirname, '../../preload/index.js'),
                    nodeIntegration: false,
                    contextIsolation: true,
                    sandbox: false,
                    spellcheck: false,
                },
            },
        }));
    }
    return mainwin;
}
