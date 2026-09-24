// preload/plugins/titlebar.ts
import { ipcRenderer } from 'electron';
import { registerHook } from '../core/hooks';
import { HookType } from '../core/hooks';
import logger from '../core/logger';

/**
 * 注入自定义标题栏（无边框窗口的拖动区 + 窗口控制按钮）。
 * 子窗口（桌面 window.open 打开的飞牛影视/相册等）对齐 fnOS 桌面内置应用
 * 窗口（如"文件管理"）的标题栏规范：44px 高、左侧应用图标 + 标题（14px）、
 * 图标颜色跟随页面明暗主题；主窗口保持原有 32px 透明样式。
 */

const BAR_STYLE = `
#custom-titlebar{--tb-fg:#888;--tb-hover:rgba(0,0,0,.08);--tb-close-hover:rgba(232,17,35,.9)}
#custom-titlebar[data-theme=light]{--tb-fg:rgb(11,11,12);--tb-hover:rgba(0,0,0,.08)}
#custom-titlebar[data-theme=dark]{--tb-fg:rgba(255,255,255,.85);--tb-hover:rgba(255,255,255,.14)}
#custom-titlebar .tb-btn{background:transparent;border:none;width:46px;height:100%;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--tb-fg);transition:background .15s ease}
#custom-titlebar .tb-btn:hover{background:var(--tb-hover);color:#fff}
#custom-titlebar .tb-btn.close:hover{background:var(--tb-close-hover);color:#fff}
#custom-titlebar .tb-left{display:flex;align-items:center;gap:8px;padding-left:12px;min-width:0;max-width:60%}
#custom-titlebar .tb-icon{width:16px;height:16px;flex:none}
#custom-titlebar .tb-title{font-size:14px;font-weight:400;color:var(--tb-fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;user-select:none}
`;

function currentFavicon(): string | null {
    const link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
    return link?.href || null;
}

function detectDark(): boolean {
    const cls = document.documentElement.classList;
    if (cls.contains('dark')) return true;
    if (cls.contains('light')) return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

const WINDOW_RADIUS = 16; // 对齐 fnOS 桌面内置窗口（如"文件管理"）的 16px 圆角

async function getWindowRole(): Promise<{ role: 'main' | 'child'; maximized: boolean }> {
    try {
        const info = await ipcRenderer.invoke('get-window-role');
        if (info && typeof info === 'object') {
            return { role: info.role === 'child' ? 'child' : 'main', maximized: Boolean(info.maximized) };
        }
        return { role: info === 'child' ? 'child' : 'main', maximized: false };
    } catch {
        return { role: 'main', maximized: false }; // 主进程不支持角色查询时保持旧行为
    }
}

/** 子窗口圆角：透明窗口 + 根元素 clip-path 裁剪（可连同 fixed 定位内容一起裁掉） */
function applyWindowRadius(maximized: boolean): void {
    const de = document.documentElement;
    de.style.setProperty('background', 'transparent', 'important');
    de.style.clipPath = maximized ? 'none' : `inset(0 round ${WINDOW_RADIUS}px)`;
}

function injectTitleBarDom(role: 'main' | 'child', maximized: boolean): void {
    logger.info('Injecting custom title bar...', role);
    if (document.getElementById('custom-titlebar')) return;

    const isMac = process.platform === 'darwin';
    const child = role === 'child';
    const height = child ? 44 : 32;

    const style = document.createElement('style');
    style.id = 'custom-titlebar-style';
    style.textContent = BAR_STYLE;
    document.head.appendChild(style);

    const bar = document.createElement('div');
    bar.id = 'custom-titlebar';
    bar.style.cssText = `
        height:${height}px;
        width:100vw;
        background:rgba(255,255,255,0)!important;
        backdrop-filter: blur(12px)!important;
        -webkit-app-region:drag;
        position:fixed;
        top:0;
        left:0;
        z-index:99999;
        display:flex;
        justify-content:space-between;
        align-items:center;
        transition: background 0.3s ease;
    `;

    const buttons = `
        <div id="titlebar-btns" style="-webkit-app-region:no-drag; display:flex; height:100%;">
            <button id="min-btn" class="tb-btn" title="最小化">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                    <path d="M2 8H14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
            </button>
            <button id="max-btn" class="tb-btn" title="最大化">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                    <rect x="3" y="3" width="10" height="10" rx="1.5" stroke="currentColor" stroke-width="1.5"/>
                </svg>
            </button>
            <button id="close-btn" class="tb-btn close" title="关闭">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                    <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
            </button>
        </div>
    `;

    // macOS 的窗口按钮由系统绘制，只保留透明拖动区域。
    bar.innerHTML = isMac
        ? ''
        : child
            ? `<div class="tb-left"><img class="tb-icon" alt=""><span class="tb-title"></span></div>${buttons}`
            : `<div style="flex:1;height:100%;"></div>${buttons}`;

    // 添加body顶部内边距；防止出现双重滚动条
    document.body.style.paddingTop = '10px';
    document.documentElement.style.overflowY = 'hidden';
    document.body.appendChild(bar);

    if (isMac) return;

    // 窗口控制功能
    const bind = (id: string, channel: string): void => {
        document.getElementById(id)?.addEventListener('click', () => {
            ipcRenderer.send(channel);
        });
    };
    bind('min-btn', 'window-minimize');
    bind('max-btn', 'window-maximize');
    bind('close-btn', 'window-close');

    // 播放器页（/v/video/…）自带顶部标题行（返回键+片名），注入标题栏会与之重叠成双标题：
    // 该路由下隐藏标题栏，退出播放后自动恢复。
    const PLAYER_ROUTE = /^\/v\/video(\/|$)/;
    const syncVisibility = (): void => {
        bar.style.display = PLAYER_ROUTE.test(location.pathname) ? 'none' : 'flex';
    };
    syncVisibility();
    setInterval(syncVisibility, 800);

    if (!child) return;

    // —— 子窗口：16px 圆角（对齐文件管理窗口），最大化时切回直角 ——
    let isMaximized = maximized;
    applyWindowRadius(isMaximized);
    ipcRenderer.on('window-maximized-changed', (_event, value: unknown) => {
        isMaximized = Boolean(value);
        applyWindowRadius(isMaximized);
    });

    // —— 子窗口：标题/图标/主题色实时跟随页面 ——
    const titleEl = bar.querySelector('.tb-title') as HTMLElement;
    const iconEl = bar.querySelector('.tb-icon') as HTMLImageElement;

    const syncTitle = (): void => {
        titleEl.textContent = document.title || '';
    };
    const syncIcon = (): void => {
        const href = currentFavicon();
        if (href && iconEl.getAttribute('src') !== href) iconEl.setAttribute('src', href);
    };
    const syncTheme = (): void => {
        bar.setAttribute('data-theme', detectDark() ? 'dark' : 'light');
    };
    syncTitle();
    syncIcon();
    syncTheme();

    new MutationObserver(() => { syncTitle(); syncIcon(); })
        .observe(document.head, { childList: true, subtree: true, attributes: true });
    new MutationObserver(() => {
        syncTheme();
        // 页面脚本若整体重写 <html> style 会丢掉我们的圆角，发现缺失就补回
        if (!isMaximized && !/round/.test(document.documentElement.style.clipPath || '')) {
            applyWindowRadius(false);
        }
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
}

function injectTitleBar(): void {
    if (document.getElementById('custom-titlebar')) return;
    void getWindowRole().then(({ role, maximized }) => {
        const run = (): void => injectTitleBarDom(role, maximized);
        if (document.body) run();
        else document.addEventListener('DOMContentLoaded', run);
    });
}

// 注册到 hook
registerHook(HookType.OnReady, injectTitleBar);

export {};
