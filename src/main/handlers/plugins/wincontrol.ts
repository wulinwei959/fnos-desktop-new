import { BrowserWindow, IpcMainEvent } from 'electron';
import { getMainWindow } from '../../common/mainwin';
import { setHalfScreen, setFullScreen } from '../../common/winctrl';
import { registerHandler } from '../core/ipcHandler';

/**
 * 窗口控制插件
 * 处理窗口的最小化、最大化和关闭操作。
 * 必须按 IPC 消息来源窗口路由：桌面优先策略下，"飞牛影视"等应用是
 * window.open 打开的子窗口，若固定操作主窗口，点子窗口的关闭按钮
 * 会把主界面（桌面）一起关掉。
 */

// 解析消息来源窗口；异常场景（如已销毁）回退到主窗口
function resolveSenderWindow(event: IpcMainEvent): BrowserWindow | null {
    return BrowserWindow.fromWebContents(event.sender) ?? getMainWindow();
}

// 窗口最小化处理
function handleMinimize(event: IpcMainEvent): void {
    const win = resolveSenderWindow(event);
    if (win) win.minimize();
}

// 窗口最大化/还原处理
function handleMaximize(event: IpcMainEvent): void {
    const win = resolveSenderWindow(event);
    if (!win) return;
    win.isMaximized() ? setHalfScreen(win) : setFullScreen(win);
}

// 窗口关闭处理：只关闭发起请求的窗口本身
function handleClose(event: IpcMainEvent): void {
    const win = resolveSenderWindow(event);
    if (win) win.close();
}

// 窗口角色查询：preload 据此决定标题栏渲染规格（子窗口对齐 fnOS 内置窗口规范）
function handleGetWindowRole(event: IpcMainEvent): 'main' | 'child' {
    return event.sender === getMainWindow().webContents ? 'main' : 'child';
}

// 注册窗口控制处理器
function init(): void {
    registerHandler('window-minimize', handleMinimize);
    registerHandler('window-maximize', handleMaximize);
    registerHandler('window-close', handleClose);
    registerHandler('get-window-role', handleGetWindowRole, { useHandle: true });
}

export {
    init
};
