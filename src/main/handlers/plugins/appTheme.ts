import { nativeTheme, IpcMainEvent } from 'electron';
import { getMainWindow } from '../../common/mainwin';
import { registerHandler } from '../core/ipcHandler';
import * as log from '../../../modules/logger';

/**
 * 应用主题同步插件
 * 桌面优先策略下，"飞牛影视 / 相册"等应用是 window.open 打开的子窗口，
 * 它们按 prefers-color-scheme 自行决定明暗，可能与主界面不一致。
 * 由主窗口（preload 侧）上报页面实际主题，这里写回 nativeTheme.themeSource，
 * 让所有子窗口与主窗口主题颜色保持同步。
 */

function handleSetAppTheme(event: IpcMainEvent, theme: unknown): void {
    if (theme !== 'light' && theme !== 'dark') return;
    // 只接受来自主窗口的主题上报，子窗口跟随主窗口、不得反向覆盖
    if (event.sender !== getMainWindow().webContents) return;
    if (nativeTheme.themeSource === theme) return;
    nativeTheme.themeSource = theme;
    log.info('[主题] 应用主题源已同步为:', theme);
}

function init(): void {
    registerHandler('set-app-theme', handleSetAppTheme);
}

export { init };
