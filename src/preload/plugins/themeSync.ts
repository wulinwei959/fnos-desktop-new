/**
 * 主题上报插件：监听页面 <html> 的 light/dark 类名变化，
 * 通过 IPC 上报给主进程（appTheme 插件只认主窗口的上报），
 * 用于让 window.open 打开的子窗口与主窗口主题颜色同步。
 */
import { ipcRenderer } from 'electron';

function currentTheme(): 'light' | 'dark' | null {
    const cls = document.documentElement.classList;
    if (cls.contains('dark')) return 'dark';
    if (cls.contains('light')) return 'light';
    return null;
}

let last: 'light' | 'dark' | null = null;
function report(): void {
    const theme = currentTheme();
    if (!theme || theme === last) return;
    last = theme;
    ipcRenderer.send('set-app-theme', theme);
}

function start(): void {
    report();
    new MutationObserver(report).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class'],
    });
}

if (document.documentElement) start();
else document.addEventListener('DOMContentLoaded', start);

export {};
