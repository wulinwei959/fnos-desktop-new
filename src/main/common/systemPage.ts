/**
 * system-page 模式：在「影视 /v」与「原生飞牛 OS 桌面 /」之间切换主窗口。
 * 移植自 Fntv-Plus 的思路，但用主进程 + 托盘驱动（不耦合 fnOS 前端 DOM，最稳）。
 *
 * 同端口场景（fnOS 默认在 :5666 同时提供影视与桌面）：进入 = origin + '/'，返回 = origin + '/v'。
 * 若桌面在别的端口/地址，可在设置里配 systemPageUrl 覆盖"进入"目标；"返回"用最近记录的影视 origin。
 */
import { BrowserWindow } from 'electron';
import * as log from '../../modules/logger';
import { getSystemPageUrl } from '../../modules/fn_config/config';

/** 影视登录/授权流程允许停留的路径（也视为"影视态"，不误判为桌面）。 */
const ALLOWED_VIDEO_PATHS = ['/v/login', '/v/welcome', '/v/oauth', '/v/signin', '/v/auth'];

function parseUrl(u: string): URL | null {
    try {
        return new URL(u);
    } catch {
        return null;
    }
}

/** 当前是否处于影视页（/v 首页、/v/* 子路由，或登录/授权豁免路径）。 */
export function isOnVideoPage(win: BrowserWindow | null): boolean {
    if (!win || win.isDestroyed()) return false;
    const url = parseUrl(win.webContents.getURL());
    if (!url) return false;
    const p = url.pathname;
    if (p === '/v' || p.startsWith('/v/')) return true;
    return ALLOWED_VIDEO_PATHS.some(a => p === a || p.startsWith(a + '/'));
}

/** 最近一次记录的影视 origin，供"返回影视"用（桌面页可能配成别的端口）。 */
let _lastVideoOrigin = '';

/** 进入原生飞牛 OS 桌面。 */
export function enterSystemPage(win: BrowserWindow | null): void {
    if (!win || win.isDestroyed()) return;
    const cur = parseUrl(win.webContents.getURL());
    if (cur) _lastVideoOrigin = cur.origin;
    const custom = getSystemPageUrl();
    const target = custom || (cur ? cur.origin + '/' : '');
    if (!target) {
        log.warn('[system-page] 无法确定桌面地址（可能尚未登录）');
        return;
    }
    log.info(`[system-page] 进入飞牛原生桌面: ${target}`);
    win.loadURL(target).catch(e => log.error('[system-page] 加载桌面失败:', e));
}

/** 返回影视 /v。 */
export function exitSystemPage(win: BrowserWindow | null): void {
    if (!win || win.isDestroyed()) return;
    const cur = parseUrl(win.webContents.getURL());
    const origin = _lastVideoOrigin || (cur ? cur.origin : '');
    if (!origin) {
        log.warn('[system-page] 无法确定影视地址');
        return;
    }
    const target = origin + '/v';
    log.info(`[system-page] 返回影视: ${target}`);
    win.loadURL(target).catch(e => log.error('[system-page] 返回影视失败:', e));
}

/** 依当前页面给出托盘菜单应显示的动作标签。 */
export function systemPageToggleLabel(win: BrowserWindow | null): string {
    return isOnVideoPage(win) ? '进入飞牛桌面' : '返回影视';
}

/** 执行一次"桌面/影视"切换（供托盘点击调用）。 */
export function toggleSystemPage(win: BrowserWindow | null): void {
    if (isOnVideoPage(win)) enterSystemPage(win);
    else exitSystemPage(win);
}
