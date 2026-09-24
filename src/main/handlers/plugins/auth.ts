import { IpcMainEvent, session } from 'electron';
import { randomUUID } from 'crypto';
import * as path from 'path';
import * as http from 'http';
import * as https from 'https';
import { getMainWindow } from '../../common/mainwin';
import { resolveHomeUrl } from '../../common/systemPage';
import * as fn from '../../../modules/fn_api/api';
import { restoreCookies } from '../../../modules/fn_config/cookie';
import * as fnConfig from '../../../modules/fn_config/config';
import { registerHandler } from '../core/ipcHandler';
import * as log from '../../../modules/logger';
import { showCertificateTrustDialog, addTrustedHost, isTrusted } from '../../../modules/cert_trust';
import { isFnId, handleFnIdLogin } from './fnid_login';
import { setNativeLoginActive } from './login';
import { currentPartition } from '../../common/partition';
import {
    closeFn2faSession,
    fnLoginStart,
    fnLoginTotp,
    type Fn2faLoginResult,
    type Fn2faSession,
} from '../../common/fnWsLogin';
import {
    AccessCodeVerificationError,
    establishAccessCodeSession,
} from '../../common/accessCodeSession';

/**
 * 用户认证插件
 * 处理登录、配置管理、历史记录等功能
 */

interface LoginData {
    domain: string;
    username: string;
    password: string;
    accessCode?: string;
    useHttps?: boolean;
}

interface HistoryItem {
    domain: string;
    account: string;
}

let fnIdLoginInProgress = false;

// 获取配置处理
function handleGetConfig(event: IpcMainEvent): void {
    try {
        const config = fnConfig.readConfig() || {};
        const history = fnConfig.getHistory() || [];
        // 登录页只需要表单回填字段，禁止把长期 token 暴露给渲染进程。
        event.reply('config-data', {
            config: {
                account: config.account,
                domain: config.domain,
                accessCode: config.accessCode,
                useHttps: config.useHttps,
            },
            history,
        });
    } catch (error) {
        log.error('读取配置失败:', error);
        event.reply('config-data', { config: {}, history: [] });
    }
}

// 清除历史记录处理
function handleClearHistory(event: IpcMainEvent): void {
    try {
        fnConfig.clearHistory();
        event.reply('history-cleared');
    } catch (error) {
        log.error('清除历史记录失败:', error);
    }
}

// 删除单个历史记录处理
function handleDeleteHistoryItem(event: IpcMainEvent, { domain, account }: HistoryItem): void {
    try {
        const success = fnConfig.deleteHistoryItem({ domain, account });
        if (success) {
            event.reply('history-item-deleted');
        }
    } catch (error) {
        log.error('删除历史记录项失败:', error);
    }
}

// 用户登录处理
async function handleLogin(
    event: IpcMainEvent,
    loginData: LoginData,
    certificateRetryAttempted: boolean = false,
): Promise<void> {
    log.info('收到登录请求:', {
        useHttps: loginData?.useHttps,
    });

    if (!loginData || !loginData.domain || !loginData.username || !loginData.password) {
        log.error('登录失败: 缺少必要的登录信息');
        event.reply('login-error', {
            title: '登录失败',
            message: '请提供完整的登录信息。'
        });
        return;
    }

    // FN ID 登录分支
    if (isFnId(loginData.domain)) {
        if (fnIdLoginInProgress) {
            event.reply('login-error', {
                title: 'FN ID 登录进行中',
                message: '请先在已打开的 FN Connect 窗口中完成或取消登录。'
            });
            return;
        }

        log.info('检测到 FN ID 格式，使用 FN Connect OAuth 登录');
        fnIdLoginInProgress = true;
        try {
            await handleFnIdLogin(event, loginData);
        } finally {
            fnIdLoginInProgress = false;
        }
        return;
    }

    // 构建服务器地址
    let server = loginData.useHttps ? `https://${loginData.domain}` : `http://${loginData.domain}`;
    const accessCode = loginData.accessCode?.trim() || '';

    try {
        const accessSession = await establishAccessCodeSession(server, accessCode);
        server = accessSession.baseUrl;
        const fnapi = new fn.ApiService(server);
        const response = await fnapi.login(loginData.username, loginData.password);

        if (!response || !response.success) {
            // 检查是否为证书错误
            if (response && response.certificateError) {
                log.info('检测到证书验证错误，询问用户是否信任');

                // 显示证书信任对话框
                const mainWindow = getMainWindow();
                const shouldTrust = await showCertificateTrustDialog(
                    server,
                    response.message || '未知证书错误',
                    mainWindow
                );

                if (shouldTrust) {
                    if (certificateRetryAttempted) {
                        event.reply('login-error', {
                            title: '证书验证失败',
                            message: '信任证书后仍无法建立安全连接，请检查服务器证书配置。',
                        });
                        return;
                    }
                    // 用户选择信任，添加到信任列表并重试登录
                    addTrustedHost(server);
                    log.info('用户信任证书，重试登录');

                    // 递归调用重试登录
                    return handleLogin(event, loginData, true);
                } else {
                    // 用户不信任，返回错误
                    event.reply('login-error', {
                        title: '登录取消',
                        message: '用户取消信任证书，无法继续登录。'
                    });
                    return;
                }
            }

            const msg = response ? response.message : '未知错误';
            log.error('登录失败:', msg);
            event.reply('login-error', {
                title: '登录失败',
                message: msg || '登录时发生未知错误，请稍后重试。'
            });
            return;
        }

        // 登录成功，处理返回的 token 和可能的重定向 URL
        server = response.moveUrl || server;
        const token = response.data.token;
        if (!token) {
            log.error('登录失败: 没有有效的登录信息，无法恢复 cookies');
            event.reply('login-error', {
                title: '登录失败',
                message: '没有有效的登录信息，无法恢复 cookies'
            });
            return;
        }
        log.info('登录成功，已获取 token');

        // 保存登录信息
        const { saveConfig, addHistory } = require('../../../modules/fn_config/config');

        // 保存配置（账号密码方式：显式清除"原生登录"标记）
        saveConfig({
            account: loginData.username,
            domain: server,
            token: response.data.token,
            accessCode,
            useHttps: server.startsWith('https://'),
            nativeLogin: false,
        });

        // 添加到登录历史
        addHistory({
            domain: loginData.domain,
            account: loginData.username,
            password: loginData.password,
            accessCode,
            useHttps: loginData.useHttps
        });

        // 跳转到主页
        const mainWindow = getMainWindow();
        if (mainWindow) {
            log.info('恢复登录状态，即将跳转到主页面（原生桌面）, domain:', server);
            const success = await restoreCookies(server, token, true);
            if (success) {
                mainWindow.loadURL(resolveHomeUrl(server));
            } else {
                event.reply('login-error', {
                    title: '登录失败',
                    message: '无法恢复登录状态，请重新登录。'
                });
            }
        }
    } catch (error) {
        if (error instanceof AccessCodeVerificationError) {
            log.warn('访问码验证失败:', error.reason);
            event.reply('login-error', {
                title: error.reason === 'rejected' ? '访问码错误' : '连接失败',
                message: error.reason === 'rejected'
                    ? '访问码错误，请检查后重试。'
                    : '无法连接到访问码验证服务，请检查地址、证书或网络连接。',
            });
            return;
        }
        log.error('登录请求失败:', error);
        const message = error instanceof Error ? error.message : '';
        const secureStorageFailure = /安全存储|密钥环/.test(message);
        event.reply('login-error', {
            title: secureStorageFailure ? '无法安全保存登录信息' : '连接失败',
            message: secureStorageFailure
                ? message
                : '无法连接到服务器，请检查域名是否正确或网络连接是否正常。'
        });
    }
}

// 原生登录（二次验证）：把整个登录流程交给飞牛管理端原生 /login 页（支持动态口令与"保持登录"）。
// 管理端登录成功会写入会话 cookie ost；若媒体 token（Trim-MC-token）也已就绪则一并回写 config，
// 否则以 nativeLogin 标记会话由管理端 cookie 维持（重启后管理端凭"保持登录"自动恢复）。
let nativeLoginTimer: NodeJS.Timeout | null = null;

function stopNativeLoginWatch(): void {
    if (nativeLoginTimer) {
        clearInterval(nativeLoginTimer);
        nativeLoginTimer = null;
    }
    setNativeLoginActive(false);
}

/**
 * 管理端登录写入的 ost/osrt 默认是会话 cookie，Electron 退出即清空。
 * 把它们续成 30 天持久 cookie，重启后管理端凭 osrt 自动换回会话（原生"保持登录"等效）。
 */
async function persistSessionCookies(ses: Electron.Session, server: string): Promise<void> {
    const expires = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
    const cookies = await ses.cookies.get({ url: server });
    for (const cookie of cookies) {
        if (cookie.expirationDate) continue;
        try {
            await ses.cookies.set({
                url: server,
                name: cookie.name,
                value: cookie.value,
                path: cookie.path || '/',
                secure: cookie.secure,
                httpOnly: cookie.httpOnly,
                sameSite: cookie.sameSite === 'no_restriction' ? 'no_restriction' : 'lax',
                expirationDate: expires,
            });
        } catch (error) {
            log.warn('[原生登录] 持久化 cookie 失败:', cookie.name, error);
        }
    }
}

async function handleNativeLogin(event: IpcMainEvent, data?: { domain?: string; useHttps?: boolean }): Promise<void> {
    const domain = data?.domain?.trim();
    const mainWindow = getMainWindow();
    if (!data || !domain || isFnId(domain) || !mainWindow) {
        event.reply('login-error', {
            title: '无法打开原生登录页',
            message: '请输入有效的 IP 地址或域名（FN ID 无需二次验证，请用账号密码方式登录）。',
        });
        return;
    }

    const server = data.useHttps ? `https://${domain}` : `http://${domain}`;
    const useHttps = !!data.useHttps;
    log.info('[原生登录] 跳转到管理端原生登录页（含二次验证）:', server);

    // 清掉旧 cookie，确保原生页展示登录表单而不是自动进入桌面
    const ses = session.fromPartition(currentPartition());
    await ses.clearStorageData({ storages: ['cookies'] });

    setNativeLoginActive(true);
    mainWindow.loadURL(`${server}/login`);

    if (nativeLoginTimer) clearInterval(nativeLoginTimer);
    const deadline = Date.now() + 10 * 60 * 1000;
    nativeLoginTimer = setInterval(async () => {
        try {
            if (Date.now() > deadline) {
                stopNativeLoginWatch();
                log.warn('[原生登录] 超时未完成，恢复自定义登录拦截');
                return;
            }
            const sessionCookies = await ses.cookies.get({ url: server, name: 'ost' });
            if (sessionCookies.length === 0) return;

            // 管理端登录完成。顺带尝试捕获媒体 token（影视应用 SSO 时写入），能拿到就一起回写
            let account = '';
            let token = '';
            const mediaCookies = await ses.cookies.get({ url: server, name: 'Trim-MC-token' });
            const mediaToken = mediaCookies[0]?.value;
            if (mediaToken) {
                const fnapi = new fn.ApiService(server, mediaToken);
                const info = await fnapi.getUserInfo(5000, 0);
                if (info && info.success) {
                    token = mediaToken;
                    account = info.data?.username || '';
                }
            }

            fnConfig.saveConfig({ account, domain: server, token, useHttps, nativeLogin: true });
            fnConfig.addHistory({ domain, account, password: '', useHttps });
            await persistSessionCookies(ses, server);
            stopNativeLoginWatch();
            log.info('[原生登录] 登录完成，进入桌面（媒体 token:', token ? '已回写' : '待影视应用 SSO', ')');
            mainWindow.loadURL(resolveHomeUrl(server));
        } catch (error) {
            log.error('[原生登录] 轮询登录状态失败:', error);
        }
    }, 1000);
}

// ===== 自建二次验证（2FA）登录 =====
// 会话有效期 5 分钟；登录成功后把管理端 token 写入 web 端约定的 cookie，
// 并标记 nativeLogin 直接进桌面（媒体 token 由影视应用 SSO/ensureMediaToken 兜底）。
const pending2fa = new Map<string, Fn2faSession>();
const PENDING_2FA_TTL_MS = 5 * 60 * 1000;

function prunePending2fa(): void {
    const now = Date.now();
    for (const [id, session0] of pending2fa) {
        if (now - session0.createdAt > PENDING_2FA_TTL_MS) {
            closeFn2faSession(session0);
            pending2fa.delete(id);
        }
    }
}

/**
 * 新版管理端登录态为"票据交换"：登录成功后需拿 ticket POST /app/ticket，
 * 由服务端 Set-Cookie 写入 httpOnly 会话（ost 等）；只写 legacy fnos-token 不被识别。
 * 走 node https（与 fn_api 请求层同策略：自签名主机由用户确认后放行），
 * 再把 Set-Cookie 原样写回 Electron 会话。失败仅告警（legacy cookie 兼容旧版前端）。
 */
function postJsonOnce(url: string, body: string, headers: Record<string, string>): Promise<{ status: number; location?: string; setCookies: string[] }> {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const transport = u.protocol === 'https:' ? https : http;
        const req = transport.request(
            {
                hostname: u.hostname,
                port: u.port || (u.protocol === 'https:' ? 443 : 80),
                path: u.pathname + u.search,
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...headers },
                ...(u.protocol === 'https:' ? { rejectUnauthorized: !isTrusted(url) } : {}),
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (c: Buffer) => chunks.push(c));
                res.on('end', () => resolve({
                    status: res.statusCode || 0,
                    location: res.headers.location,
                    setCookies: (res.headers['set-cookie'] as string[] | undefined) || [],
                }));
            },
        );
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

async function exchangeAdminTicket(ses: Electron.Session, server: string, ticket: string): Promise<boolean> {
    try {
        let url = `${server}/app/ticket`;
        let resp = await postJsonOnce(url, JSON.stringify({ ticket }), {});
        for (let hop = 0; hop < 2 && (resp.status === 301 || resp.status === 302) && resp.location; hop++) {
            url = new URL(resp.location, url).toString();
            resp = await postJsonOnce(url, JSON.stringify({ ticket }), {});
        }
        if (resp.status !== 200) {
            log.warn('[2FA] ticket 交换会话失败, HTTP', resp.status);
            return false;
        }
        for (const raw of resp.setCookies) {
            const [pair, ...attrs] = raw.split(';');
            const eq = pair.indexOf('=');
            if (eq <= 0) continue;
            const cookie: Electron.CookiesSetDetails = {
                url,
                name: pair.slice(0, eq).trim(),
                value: pair.slice(eq + 1).trim(),
                path: '/',
                httpOnly: attrs.some(a => a.trim().toLowerCase() === 'httponly'),
                secure: attrs.some(a => a.trim().toLowerCase() === 'secure'),
            };
            const sameSite = attrs.map(a => a.trim().toLowerCase()).find(a => a.startsWith('samesite='));
            if (sameSite?.includes('none')) cookie.sameSite = 'no_restriction';
            await ses.cookies.set(cookie);
        }
        log.info('[2FA] ticket 交换会话成功, cookie 数:', resp.setCookies.length);
        return true;
    } catch (error) {
        log.warn('[2FA] ticket 交换会话异常:', error);
        return false;
    }
}

async function applyAdminLogin(
    server: string,
    useHttps: boolean,
    username: string,
    stay: boolean,
    result: { token?: string; longToken?: string; secret?: string; ticket?: string },
): Promise<void> {
    const ses = session.fromPartition(currentPartition());
    const sameSite = useHttps ? 'no_restriction' : 'lax';
    if (result.token) {
        await ses.cookies.set({
            url: server, name: 'fnos-token', value: result.token,
            path: '/', secure: useHttps, httpOnly: false, sameSite,
        });
    }
    if (stay && result.longToken) {
        await ses.cookies.set({
            url: server, name: 'fnos-long-token', value: result.longToken,
            path: '/', secure: useHttps, httpOnly: false, sameSite,
            expirationDate: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
        });
    }

    if (result.ticket) {
        await exchangeAdminTicket(ses, server, result.ticket);
    }
    fnConfig.saveConfig({ account: username, domain: server, token: '', useHttps, nativeLogin: true });
    fnConfig.addHistory({ domain: server.replace(/^https?:\/\//, ''), account: username, password: '', useHttps });
    await persistSessionCookies(ses, server);

    const mainWindow = getMainWindow();
    if (mainWindow) {
        if (result.secret) {
            // 管理端 SPA 后续 WS 请求需要 HMAC 密钥（web 端存 localStorage fnos-Secret）
            mainWindow.webContents.once('did-finish-load', () => {
                mainWindow.webContents.executeJavaScript(
                    `try{localStorage.setItem('fnos-Secret', ${JSON.stringify(result.secret)})}catch(e){}`,
                ).catch(() => { /* 忽略注入失败 */ });
            });
        }
        mainWindow.loadURL(resolveHomeUrl(server));
    }
    log.info('[2FA] 登录完成并已应用会话, username:', username);
}

async function handleLogin2faStart(
    event: IpcMainEvent,
    data?: { domain?: string; useHttps?: boolean; username?: string; password?: string; stay?: boolean },
): Promise<void> {
    const domain = data?.domain?.trim();
    const username = data?.username?.trim();
    const password = data?.password;
    if (!data || !domain || !username || !password || isFnId(domain)) {
        event.reply('login-2fa-result', { kind: 'error', message: '请填写有效的服务器地址、用户名和密码' });
        return;
    }
    const useHttps = !!data.useHttps;
    const server = useHttps ? `https://${domain}` : `http://${domain}`;
    try {
        const started = await fnLoginStart(server, username, password, !!data.stay);
        if (started.kind === 'error') {
            event.reply('login-2fa-result', { kind: 'error', message: started.message });
            return;
        }
        if (started.kind === 'ok') {
            await applyAdminLogin(server, useHttps, username, !!data.stay, started.result);
            event.reply('login-2fa-result', { kind: 'ok' });
            return;
        }
        prunePending2fa();
        const sessionId = randomUUID();
        pending2fa.set(sessionId, started.session);
        event.reply('login-2fa-result', { kind: '2fa', sessionId });
    } catch (error) {
        log.error('[2FA] 登录发起失败:', error);
        event.reply('login-2fa-result', {
            kind: 'error',
            message: error instanceof Error ? error.message : '无法连接登录服务',
        });
    }
}

async function handleLogin2faVerify(
    event: IpcMainEvent,
    data?: { sessionId?: string; code?: string },
): Promise<void> {
    prunePending2fa();
    const sessionId = data?.sessionId;
    const code = data?.code?.trim();
    const session0 = sessionId ? pending2fa.get(sessionId) : undefined;
    if (!session0 || !code || !/^\d{6}$/.test(code)) {
        event.reply('login-2fa-result', { kind: 'error', message: '请输入 6 位数字验证码（若已超时请重新登录）' });
        return;
    }
    try {
        const result: Fn2faLoginResult = await fnLoginTotp(session0, code);
        if (result.kind !== 'ok') {
            event.reply('login-2fa-result', { kind: 'error', message: result.message });
            return;
        }
        pending2fa.delete(sessionId!);
        closeFn2faSession(session0);
        await applyAdminLogin(session0.server, session0.server.startsWith('https'), session0.username, session0.stay, result);
        event.reply('login-2fa-result', { kind: 'ok' });
    } catch (error) {
        log.error('[2FA] 动态码验证失败:', error);
        event.reply('login-2fa-result', {
            kind: 'error',
            message: error instanceof Error ? error.message : '动态码验证失败',
        });
    }
}

// 注册认证相关处理器
// 从原生登录页返回自定义登录页：停止轮询、恢复拦截、加载应用登录页
function handleExitNativeLogin(event: IpcMainEvent): void {
    const mainWindow = getMainWindow();
    if (event.sender !== mainWindow.webContents) return;
    stopNativeLoginWatch();
    log.info('[原生登录] 用户返回应用登录页');
    mainWindow.loadFile(path.join(__dirname, '../../../../resource/login/index.html'));
}

function init(): void {
    registerHandler('get-config', handleGetConfig);
    registerHandler('clear-history', handleClearHistory);
    registerHandler('delete-history-item', handleDeleteHistoryItem);
    registerHandler('login', handleLogin);
    registerHandler('native-login', handleNativeLogin);
    registerHandler('exit-native-login', handleExitNativeLogin);
    registerHandler('login-2fa-start', handleLogin2faStart);
    registerHandler('login-2fa-verify', handleLogin2faVerify);
}

export {
    init
};
