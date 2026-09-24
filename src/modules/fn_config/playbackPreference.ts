export function isMpvPlaybackEnabled(value: unknown): boolean {
    // 默认走飞牛原生播放：只有用户显式开启（true）才由 MPV 接管。
    // 合并版策略变更——MPV 不再是全局默认，而是详情页的独立"用 MPV 播放"按钮按需选择。
    return value === true;
}
