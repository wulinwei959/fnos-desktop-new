// preload/plugins/loginServerBar.ts
import { ipcRenderer } from 'electron';
import { registerHook, HookType } from '../core/hooks';

/**
 * 主窗口直接使用飞牛原生登录页（/login）。在原生登录卡片"用户名"框上方注入
 * 一个"连接设置"面板，完整支持三种地址与两种协议：
 *   - IP / 域名：填地址（可带 http:// 前缀或用 HTTPS 开关）回车 → switch-server，
 *     主进程记住地址并重载新服务器的原生登录页；
 *   - FN ID：回车后展开账号/密码/访问码，走 FN Connect OAuth（'login' IPC）。
 * 样式对齐原生输入框（白底、同圆角字号），保证视觉统一。
 */

const LOGIN_ROUTE = /^\/(v\/)?login$/;
const BAR_ID = 'tb-server-switcher';

const INPUT_STYLE = 'width:100%;padding:15px 18px;font-size:15px;border-radius:12px;'
    + 'border:none;background:#ffffff;color:#1f2329;outline:none;box-sizing:border-box;'
    + 'font-family:inherit;';

function isFnId(value: string): boolean {
    return Boolean(value) && !value.includes('.') && value.length >= 6 && value.length <= 30;
}

function makeInput(placeholder: string): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'text';
    input.spellcheck = false;
    input.placeholder = placeholder;
    input.style.cssText = INPUT_STYLE;
    return input;
}

function buildPanel(currentOrigin: string): HTMLElement {
    const root = document.createElement('div');
    root.id = BAR_ID;
    root.style.cssText = 'margin:0 0 20px;font-family:inherit;';

    const addr = makeInput('服务器地址 / FN ID（回车确认）');
    addr.value = currentOrigin;
    addr.addEventListener('focus', () => addr.select());

    const httpsRow = document.createElement('label');
    httpsRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin:10px 2px 0;'
        + 'font-size:13px;opacity:.85;cursor:pointer;';
    const httpsBox = document.createElement('input');
    httpsBox.type = 'checkbox';
    httpsBox.checked = currentOrigin.startsWith('https:');
    httpsBox.style.cssText = 'width:15px;height:15px;accent-color:#1664ff;cursor:pointer;';
    httpsRow.appendChild(httpsBox);
    httpsRow.appendChild(document.createTextNode('HTTPS 安全访问'));

    const status = document.createElement('div');
    status.style.cssText = 'display:none;margin-top:8px;font-size:12.5px;color:#ff6b6b;word-break:break-all;';

    // FN ID 展开区：账号 + 密码 + 访问码 + FN Connect 登录按钮
    const fnidBox = document.createElement('div');
    fnidBox.style.cssText = 'display:none;flex-direction:column;gap:12px;margin-top:12px;';
    const user = makeInput('fnOS 用户名');
    const pass = makeInput('密码');
    pass.type = 'password';
    const code = makeInput('访问码（可选）');
    code.type = 'password';
    const goBtn = document.createElement('button');
    goBtn.textContent = '通过 FN Connect 登录';
    goBtn.style.cssText = 'width:100%;padding:14px 0;font-size:15px;font-weight:600;color:#fff;'
        + 'background:#1664ff;border:none;border-radius:12px;cursor:pointer;font-family:inherit;';

    const showFnid = (): void => {
        fnidBox.style.display = 'flex';
        user.focus();
    };
    const hideFnid = (): void => {
        fnidBox.style.display = 'none';
    };

    const submitAddr = (): void => {
        const raw = addr.value.trim().replace(/\/+$/, '');
        if (!raw) return;
        status.style.display = 'none';
        if (isFnId(raw.replace(/^https?:\/\//, ''))) {
            showFnid();
            return;
        }
        hideFnid();
        let u: URL;
        try {
            u = new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`);
        } catch {
            status.textContent = '地址格式不正确';
            status.style.display = 'block';
            return;
        }
        const useHttps = /^https?:\/\//i.test(raw) ? u.protocol === 'https:' : httpsBox.checked;
        ipcRenderer.send('switch-server', { domain: u.host, useHttps });
    };

    goBtn.addEventListener('click', () => {
        const fnid = addr.value.trim().replace(/^https?:\/\//, '');
        if (!fnid || !user.value.trim() || !pass.value) {
            status.textContent = '请填写 fnOS 账号和密码';
            status.style.display = 'block';
            return;
        }
        goBtn.disabled = true;
        goBtn.textContent = '正在连接 FN Connect…';
        ipcRenderer.send('login', {
            domain: fnid,
            username: user.value.trim(),
            password: pass.value,
            accessCode: code.value.trim(),
            useHttps: false,
        });
        setTimeout(() => {
            goBtn.disabled = false;
            goBtn.textContent = '通过 FN Connect 登录';
        }, 15000);
    });

    addr.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter') submitAddr();
    });

    fnidBox.appendChild(user);
    fnidBox.appendChild(pass);
    fnidBox.appendChild(code);
    fnidBox.appendChild(goBtn);
    root.appendChild(addr);
    root.appendChild(httpsRow);
    root.appendChild(fnidBox);
    root.appendChild(status);

    // FN Connect 失败时把主进程错误同步显示在面板内
    ipcRenderer.on('login-error', (_event, data: unknown) => {
        const msg = (data && typeof data === 'object' && 'message' in data) ? String((data as { message?: unknown }).message) : '';
        goBtn.disabled = false;
        goBtn.textContent = '通过 FN Connect 登录';
        if (msg) {
            status.textContent = msg;
            status.style.display = 'block';
        }
    });
    return root;
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
    container.insertAdjacentElement('afterbegin', buildPanel(location.origin));
}

registerHook(HookType.OnReady, mount);
registerHook(HookType.OnDomChange, mount);
