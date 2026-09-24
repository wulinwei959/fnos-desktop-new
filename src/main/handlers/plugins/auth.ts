import { IpcMainEvent, session } from 'electron';
import { getMainWindow } from '../../common/mainwin';
import { resolveHomeUrl } from '../../common/systemPage';
import * as fn from '../../../modules/fn_api/api';
import { restoreCookies } from '../../../modules/fn_config/cookie';
import * as fnConfig from '../../../modules/fn_config/config';
import { registerHandler } from '../core/ipcHandler';
import * as log from '../../../modules/logger';
import { showCertificateTrustDialog, addTrustedHost } from '../../../modules/cert_trust';
import { isFnId, handleFnIdLogin } from './fnid_login';
import { setNativeLoginActive } from './login';
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

// 注册认证相关处理器
function init(): void {
    registerHandler('get-config', handleGetConfig);
    registerHandler('clear-history', handleClearHistory);
    registerHandler('delete-history-item', handleDeleteHistoryItem);
    registerHandler('login', handleLogin);
    registerHandler('native-login', handleNativeLogin);
}

export {
    init
};
