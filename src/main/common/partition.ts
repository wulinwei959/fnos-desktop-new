/**
 * 会话分区管理（多服务器登录态隔离的统一入口）。
 *
 * 背景：基座（fntv-electron）全程写死 `persist:fntv` 单分区，只能同时登录一台服务器。
 * 本模块抽成分区接缝：
 *   - `partitionForServer(key)`：按服务器标识派生稳定的持久分区名（沿用 fnos-desktop 的
 *     `persist:nas-<hash>` 约定），不同服务器 → 不同分区，Cookie/缓存物理隔离。
 *   - `currentPartition()` / `setCurrentPartition()`：当前活动分区。P1a 阶段保持默认
 *     `persist:fntv`（行为与基座一致，不破坏既有单测）；P1b 实现多服务器切换时，
 *     在切换处调用 `setCurrentPartition(partitionForServer(...))` 并重建主窗口。
 *
 * 纯字符串逻辑，不依赖 Electron，可被 node --test 单测覆盖。
 */
import { createHash } from 'node:crypto';

/** 单服务器基线分区（保留，兼容旧行为） */
export const PARTITION_FNTV = 'persist:fntv';
/** FN ID 无头 OAuth 的独立一次性分区（与主分区隔离，见 handlers/plugins/fnid_login.ts） */
export const PARTITION_FNID_OAUTH = 'persist:fnid-oauth';

const NAS_PREFIX = 'persist:nas-';

let _currentPartition: string = PARTITION_FNTV;

/** 当前活动分区。主窗口、cookie 拦截器、登录清理等统一读这里。 */
export function currentPartition(): string {
    return _currentPartition;
}

/** 切换活动分区（P1b 多服务器切换时调用；通常配合主窗口重建）。 */
export function setCurrentPartition(partition: string): void {
    _currentPartition = partition || PARTITION_FNTV;
}

/**
 * 由服务器标识派生持久分区名。
 * @param serverKey 规范化的服务器键：`https://nas.example.com` / `http://192.168.1.100:5666`，
 *                  或 FN ID（如 `fnos.net/abc123`）。不同输入 → 不同分区。
 */
export function partitionForServer(serverKey: string): string {
    const key = (serverKey || '').trim().toLowerCase();
    if (!key) {
        return PARTITION_FNTV;
    }
    const hash = createHash('sha256').update(key).digest('hex').slice(0, 16);
    return `${NAS_PREFIX}${hash}`;
}
