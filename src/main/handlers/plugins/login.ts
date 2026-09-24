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
 * 登录面已改为飞牛原生 /login 页，这里不再拦登录路由；
 * 仅保留登出拦截：清掉本地会话后把窗口带回原生登录页。
 */

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
            useHttps: config.useHttps,
            nativeLogin: false,
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
 * 处理登出请求拦截：放行登出请求本身，随后把窗口带回原生登录页
 */
function handleLogoutRequest(details: OnBeforeRequestListenerDetails, callback: (response: { cancel?: boolean }) => void): void {
    log.info('检测到登出请求，清空登录信息并回到原生登录页');
    clearLoginCookies();
    callback({});
    const mainWindow = getMainWindow();
    const domain = (readConfig() || {}).domain;
    if (mainWindow && domain) {
        mainWindow.loadURL(`${domain}/login`);
    }
}

/**
 * 初始化登录拦截插件
 */
function init(): void {
    const interceptorManager = getInterceptor();

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
};
