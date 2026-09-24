/**
 * 锁屏 / 老板键 / 开机密码 控制器（主进程）。参考 fnos-desktop，落到 fntv 基座的 TS 结构。
 * - 开机密码：scrypt（modules/security/password），只存 {salt,hash}，明文不落盘。
 * - 锁定：全屏置顶锁屏窗（resource/lock），隐藏主窗；解锁需密码。
 * - 全局快捷键：Ctrl+Alt+L 锁定、Ctrl+Alt+H 老板键隐藏。
 * - 空闲自动锁：按 lockPolicy 决策（全屏播放时豁免）。
 */
import { BrowserWindow, powerMonitor, ipcMain, app } from 'electron';
import * as path from 'path';
import * as log from '../../modules/logger';
import { createPasswordRecord, verifyPassword } from '../../modules/security/password';
import { shouldAutoLock, minutesToThresholdSeconds } from './lockPolicy';
import {
    getStartupPassword, setStartupPassword, hasStartupPassword,
    getLockEnabled, getIdleLockMinutes,
} from '../../modules/fn_config/config';
import { getMainWindow } from './mainwin';

type LockMode = 'unlock' | 'setup' | 'change';

let lockWin: BrowserWindow | null = null;
let locked = false;
let idleTimer: NodeJS.Timeout | null = null;

function alive(w: BrowserWindow | null): w is BrowserWindow {
    return !!w && !w.isDestroyed();
}

function lockHtmlPath(): string {
    return path.join(__dirname, '../../../resource/lock/index.html');
}

function createLockWindow(mode: LockMode): BrowserWindow {
    if (alive(lockWin)) {
        lockWin.loadFile(lockHtmlPath(), { query: { mode } });
        return lockWin;
    }
    lockWin = new BrowserWindow({
        width: 1000, height: 700, show: false, frame: false, fullscreen: true,
        alwaysOnTop: true, resizable: false, minimizable: false, maximizable: false,
        backgroundColor: '#0b1016', title: 'FNOS 桌面 · 已锁定',
        webPreferences: {
            preload: path.join(__dirname, '../../preload/lock.js'),
            contextIsolation: true, nodeIntegration: false, sandbox: false,
        },
    });
    lockWin.setAlwaysOnTop(true, 'screen-saver');
    lockWin.setMenuBarVisibility(false);
    lockWin.loadFile(lockHtmlPath(), { query: { mode } });
    lockWin.once('ready-to-show', () => { if (alive(lockWin)) { lockWin.show(); lockWin.focus(); } });
    // 锁定态禁止关闭；设置/修改密码态允许关闭
    lockWin.on('close', (e) => { if (locked) e.preventDefault(); else lockWin = null; });
    // 屏蔽刷新 / DevTools / Esc / Ctrl+W 等逃逸
    lockWin.webContents.on('before-input-event', (_e, input) => {
        if (input.type !== 'keyDown') return;
        const k = input.key;
        if (k === 'F5' || k === 'F12' || k === 'Escape' || (input.control && (k === 'w' || k === 'r'))) _e.preventDefault();
    });
    return lockWin;
}

function hideAppWindows(): void {
    const mw = getMainWindow();
    if (alive(mw) && mw.isVisible()) mw.hide();
}

function showAppWindows(): void {
    const mw = getMainWindow();
    if (alive(mw)) {
        if (mw.isMinimized()) mw.restore();
        mw.show();
        mw.focus();
    }
}

/** 锁定：需已设开机密码。 */
export function lockApp(): void {
    if (!hasStartupPassword()) { log.info('[lock] 未设置开机密码，忽略锁定'); return; }
    locked = true;
    const w = createLockWindow('unlock');
    hideAppWindows();
    if (alive(w)) { if (!w.isVisible()) w.show(); w.focus(); }
    log.info('[lock] 已锁定');
}

function unlockApp(): void {
    locked = false;
    if (alive(lockWin)) lockWin.hide();
    showAppWindows();
    log.info('[lock] 已解锁');
}

/** 打开"设置/修改开机密码"窗口（非锁定态）。 */
export function openPasswordDialog(mode: 'setup' | 'change'): void {
    const w = createLockWindow(mode);
    if (alive(w)) { w.show(); w.focus(); }
}

/** 老板键：隐藏所有窗口到后台。 */
export function hideCompletely(): void {
    const mw = getMainWindow();
    if (alive(mw) && mw.isVisible()) mw.hide();
    if (alive(lockWin)) lockWin.hide();
    log.info('[lock] 已隐藏到后台（老板键）');
}

function startIdleAutoLock(): void {
    if (idleTimer) return;
    idleTimer = setInterval(() => {
        if (locked) return;
        const threshold = minutesToThresholdSeconds(getIdleLockMinutes());
        const anyFullscreen = BrowserWindow.getAllWindows().some(w => alive(w) && w !== lockWin && w.isFullScreen());
        const idle = powerMonitor.getSystemIdleTime();
        if (shouldAutoLock({ enabled: getLockEnabled() && hasStartupPassword(), idleSeconds: idle, thresholdSeconds: threshold, anyFullscreen })) {
            lockApp();
        }
    }, 15000);
}

/** 初始化锁屏：注册 IPC、全局快捷键、空闲自动锁。在 app ready 后调用一次。 */
export function initLock(): void {
    ipcMain.handle('lock:unlock', (_e, pw: string) => {
        const rec = getStartupPassword();
        if (!rec) { unlockApp(); return { ok: true }; }
        if (verifyPassword(String(pw || ''), rec)) { unlockApp(); return { ok: true }; }
        return { ok: false, error: '密码错误' };
    });
    ipcMain.handle('lock:set-password', (_e, arg: { oldPw: string; newPw: string }) => {
        const oldPw = String((arg && arg.oldPw) || '');
        const newPw = String((arg && arg.newPw) || '');
        if (hasStartupPassword() && !verifyPassword(oldPw, getStartupPassword() as any)) {
            return { ok: false, error: '当前密码错误' };
        }
        if (newPw.length < 4) return { ok: false, error: '密码至少 4 位' };
        setStartupPassword(createPasswordRecord(newPw));
        log.info('[lock] 开机密码已设置/更新');
        return { ok: true };
    });
    ipcMain.on('lock:hide', () => { hideCompletely(); });
    startIdleAutoLock();
    app.on('before-quit', () => {
        if (idleTimer) { clearInterval(idleTimer); idleTimer = null; }
    });
    log.info('[lock] 锁屏模块已初始化');
}
