/**
 * 空闲自动锁决策 —— 纯逻辑，不依赖 Electron，可被 node --test 覆盖。
 * 参考 fnos-desktop：空闲超时触发锁屏；但任一窗口处于全屏（如影视全屏播放）时不因空闲锁，
 * 避免看片中途被锁屏打断。
 */
export interface LockDecisionInput {
    /** 是否启用空闲自动锁。 */
    enabled: boolean;
    /** 当前系统空闲秒数（powerMonitor.getSystemIdleTime）。 */
    idleSeconds: number;
    /** 触发锁屏的空闲阈值秒数（<=0 表示不启用阈值）。 */
    thresholdSeconds: number;
    /** 是否有任一应用窗口处于全屏。 */
    anyFullscreen: boolean;
}

/** 是否应触发自动锁屏。 */
export function shouldAutoLock(input: LockDecisionInput): boolean {
    if (!input.enabled) return false;
    if (!(input.thresholdSeconds > 0)) return false;
    if (input.anyFullscreen) return false; // 全屏播放中不因空闲锁
    return input.idleSeconds >= input.thresholdSeconds;
}

/** 把"分钟"配置安全换算成阈值秒；非法/越界返回 0（= 不启用）。 */
export function minutesToThresholdSeconds(minutes: number | undefined | null): number {
    if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) return 0;
    const secs = Math.round(minutes * 60);
    return Math.min(secs, 24 * 60 * 60); // 上限 24h
}
