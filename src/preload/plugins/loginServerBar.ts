// preload/plugins/loginServerBar.ts
import { ipcRenderer } from 'electron';
import { registerHook, HookType } from '../core/hooks';

/**
 * 主窗口直接使用飞牛原生登录页（/login）。在原生登录表单顶部注入一行
 * "服务器地址"输入框：改地址回车后发 switch-server，由主进程记住地址
 * 并加载新服务器的原生登录页，实现不依赖自定义登录卡片的服务器切换。
 */

const LOGIN_ROUTE = /^\/(v\/)?login$/;
const BAR_ID = 'tb-server-switcher';

function buildRow(currentOrigin: string): HTMLElement {
    const row = document.createElement('div');
    row.id = BAR_ID;
    row.style.cssText = 'margin:0 0 20px;';

    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentOrigin;
    input.spellcheck = false;
    // 与原生"用户名/密码"输入框同款：白底、同圆角/高度/字号，保证视觉统一
    input.style.cssText = 'width:100%;padding:15px 18px;font-size:15px;border-radius:12px;'
        + 'border:none;background:#ffffff;color:#1f2329;outline:none;box-sizing:border-box;'
        + 'font-family:inherit;';
    input.placeholder = '服务器地址（修改后回车切换）';
    input.addEventListener('focus', () => { input.select(); });
    input.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key !== 'Enter') return;
        const raw = (input as HTMLInputElement).value.trim().replace(/\/+$/, '');
        if (!raw) return;
        let u: URL;
        try {
            u = new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`);
        } catch {
            return;
        }
        ipcRenderer.send('switch-server', { domain: u.host, useHttps: u.protocol === 'https:' });
    });

    row.appendChild(input);
    return row;
}

function mount(): void {
    if (!location.protocol.startsWith('http')) return;
    if (!LOGIN_ROUTE.test(location.pathname)) return;
    if (document.getElementById(BAR_ID)) return;
    const user = document.querySelector<HTMLInputElement>('input[name="username"]');
    if (!user) return;
    let container: HTMLElement | null = user.parentElement;
    while (container && !container.querySelector('input[name="password"], input[type="password"]')) {
        container = container.parentElement;
    }
    if (!container) return;
    container.insertAdjacentElement('afterbegin', buildRow(location.origin));
}

registerHook(HookType.OnReady, mount);
registerHook(HookType.OnDomChange, mount);
