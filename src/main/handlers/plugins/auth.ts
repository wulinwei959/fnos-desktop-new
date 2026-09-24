import { IpcMainEvent, session } from 'electron';
import * as path from 'path';
import { getMainWindow } from '../../common/mainwin';
import { resolveHomeUrl } from '../../common/systemPage';
import * as fn from '../../../modules/fn_api/api';
import { restoreCookies } from '../../../modules/fn_config/cookie';
import * as fnConfig from '../../../modules/fn_config/config';
import { registerHandler } from '../core/ipcHandler';
import * as log from '../../../modules/logger';
import { showCertificateTrustDialog, addTrustedHost } from '../../../modules/cert_trust';
import { isFnId, handleFnIdLogin } from './fnid_login';
import { currentPartition } from '../../common/partition';
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

// ===== 原生登录（默认登录面）=====
// 登录一律在飞牛管理端原生 /login 页完成（支持账号密码/动态码/保持登录）。
// 壳内职责只有两件：把窗口开到正确的原生登录页；检测到登录完成后持久化会话 cookie。

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
            message: '请输入有效的 IP 地址或域名（FN ID 请用账号密码方式登录）。',
        });
        return;
    }

    const server = data.useHttps ? `https://${domain}` : `http://${domain}`;
    log.info('[原生登录] 跳转到管理端原生登录页:', server);

    // 清掉旧 cookie，确保原生页展示登录表单而不是自动进入桌面
    const ses = session.fromPartition(currentPartition());
    await ses.clearStorageData({ storages: ['cookies'] });
    mainWindow.loadURL(`${server}/login`);
}

// 原生登录页顶栏注入的"服务器地址"框回车切换：记住地址并重载新服务器的登录页
function handleSwitchServer(event: IpcMainEvent, data?: { domain?: string; useHttps?: boolean }): void {
    const domain = data?.domain?.trim();
    const mainWindow = getMainWindow();
    if (!mainWindow || !domain || isFnId(domain)) return;
    if (event.sender !== mainWindow.webContents) return;
    const useHttps = !!data?.useHttps;
    const server = useHttps ? `https://${domain}` : `http://${domain}`;
    let currentOrigin = '';
    try {
        currentOrigin = new URL(mainWindow.webContents.getURL()).origin;
    } catch { /* 无效当前 URL 时直接切换 */ }
    if (server === currentOrigin) return;
    log.info('[服务器切换] 加载新服务器登录页:', server);
    const cfg = fnConfig.readConfig() || {};
    fnConfig.saveConfig({
        account: cfg.account || '',
        domain: server,
        token: '',
        useHttps,
        nativeLogin: false,
    });
    mainWindow.loadURL(`${server}/login`);
}

let loginSettleTimer: NodeJS.Timeout | null = null;

/**
 * 常驻"登录完成"侦测：主窗已离开 /login 且存在会话态 ost cookie 时，
 * 续期全部会话 cookie 并回写 config（nativeLogin），重启后免登录直进桌面。
 * 原生 SPA 登录成功后自行跳转桌面，这里只负责会话落地，幂等可重复执行。
 */
function startLoginSettleWatch(): void {
    if (loginSettleTimer) return;
    loginSettleTimer = setInterval(async () => {
        try {
            const win = getMainWindow();
            if (!win) return;
            const url = win.webContents.getURL();
            if (!/^https?:/i.test(url)) return;
            const parsed = new URL(url);
            if (/^\/(v\/)?login/.test(parsed.pathname)) return;
            const ses = session.fromPartition(currentPartition());
            const ost = await ses.cookies.get({ url, name: 'ost' });
            if (!ost.length || ost[0].expirationDate) return; // 未登录或已持久化
            const server = parsed.origin;
            await persistSessionCookies(ses, server);
            const cfg = fnConfig.readConfig() || {};
            fnConfig.saveConfig({
                account: cfg.account || '',
                domain: server,
                token: cfg.token || '',
                useHttps: server.startsWith('https'),
                nativeLogin: true,
            });
            log.info('[原生登录] 检测到管理端登录会话，cookie 已续期 30 天');
        } catch (error) {
            log.warn('[原生登录] 会话侦测异常:', error);
        }
    }, 3000);
}

function init(): void {
    startLoginSettleWatch();
    registerHandler('get-config', handleGetConfig);
    registerHandler('clear-history', handleClearHistory);
    registerHandler('delete-history-item', handleDeleteHistoryItem);
    registerHandler('login', handleLogin);
    registerHandler('native-login', handleNativeLogin);
    registerHandler('switch-server', handleSwitchServer);
}

export {
    init
};
