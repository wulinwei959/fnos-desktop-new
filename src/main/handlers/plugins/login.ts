import * as path from 'path';
import { OnBeforeRequestListenerDetails } from 'electron';
import { getInstance as getInterceptor } from '../core/interceptor';
import { readConfig, saveConfig } from '../../../modules/fn_config/config';
import { getMainWindow } from '../../common/mainwin';
import { session } from 'electron';
import * as log from '../../../modules/logger';
import { clearAccessGrants } from '../../../modules/fn_api/accessGrant';
import { currentPartition } from '../../common/partition';

/**
 * 登录拦截插件
 * 处理登录和登出请求的拦截
 */

/**
 * 原生登录放行开关：
 * 二次验证（2FA）走飞牛原生 /v/login 页时，需要临时放行 login-interceptor，
 * 否则原生登录页会被本拦截器再次拉回自定义登录页，形成死循环。
 * 由 auth.ts 的 native-login 流程在跳转前置 true、登录完成或失败后置 false。
 */
let nativeLoginActive = false;

function setNativeLoginActive(active: boolean): void {
    nativeLoginActive = active;
    log.info('[原生登录] 拦截器放行状态:', active);
}

function isNativeLoginActive(): boolean {
    return nativeLoginActive;
}

/**
 * 清空登录信息和Cookie
 */
function clearLoginCookies(): void {
    log.info('清空登录信息和Cookie');

    // 清空配置中保存的token
    const config = readConfig() || {};
    clearAccessGrants();
    if (config.token || config.domain) {
        // 保留domain和useHttps但清空token
        saveConfig({
            account: config.account || '',
            domain: config.domain || '',
            token: '',
            useHttps: config.useHttps
        });
        log.info('已清空配置中的登录token');
    }

    // 清除会话中的cookie
    const ses = session.fromPartition(currentPartition());
    ses.clearStorageData({
        storages: ['cookies']
    }).then(() => {
        log.info('会话Cookie已清除');
    }).catch(err => {
        log.error('清除Cookie失败:', err);
    });
}

/**
 * 处理登录请求拦截
 * @param details - 请求详情
 * @param callback - 回调函数
 */
function handleLoginRequest(details: OnBeforeRequestListenerDetails, callback: (response: { cancel?: boolean }) => void): void {
    // 原生 2FA 登录进行中：放行，不拉回自定义页
    if (nativeLoginActive) {
        callback({});
        return;
    }

    log.info('检测到登录请求，清空登录信息并跳转到登录页面');
    
    // 清空配置cookie
    clearLoginCookies();
    
    // 取消请求
    callback({ cancel: true });
    
    // 加载自定义页面
    const mainWindow = getMainWindow();
    if (mainWindow) {
        mainWindow.loadFile(path.join(__dirname, '../../../../resource/login/index.html'));
    } else {
        log.error('主窗口未创建，无法跳转到登录页面');
    }
}

/**
 * 处理登出请求拦截
 * @param details - 请求详情
 * @param callback - 回调函数
 */
function handleLogoutRequest(details: OnBeforeRequestListenerDetails, callback: (response: { cancel?: boolean }) => void): void {
    log.info('检测到登出请求，清空登录信息并跳转到登录页面');
    
    // 清空配置cookie
    clearLoginCookies();
    
    // 取消请求
    callback({ cancel: true });
    
    // 加载自定义页面
    const mainWindow = getMainWindow();
    if (mainWindow) {
        mainWindow.loadFile(path.join(__dirname, '../../../../resource/login/index.html'));
    } else {
        log.error('主窗口未创建，无法跳转到登录页面');
    }
}

/**
 * 初始化登录拦截插件
 */
function init(): void {
    const interceptorManager = getInterceptor();

    // 注册登录请求拦截器
    interceptorManager.registerBeforeRequest(
        {
            urls: [
                'http://*/v/login',
                'https://*/v/login',
                'http://*/v/welcome',
                'https://*/v/welcome',
                // fnOS 管理端会话过期会跳根路径 /login（不带 /v），同样拉回自定义登录页
                'http://*/login',
                'https://*/login',
            ]
        },
        handleLoginRequest,
        'login-interceptor'
    );

    // 注册登出请求拦截器
    interceptorManager.registerBeforeRequest(
        {
            urls: [
                'http://*/v/api/v1/user/logout',
                'https://*/v/api/v1/user/logout'
            ]
        },
        handleLogoutRequest,
        'logout-interceptor'
    );

    log.info('登录拦截插件已初始化');
}

export {
    init,
    setNativeLoginActive,
    isNativeLoginActive,
};
