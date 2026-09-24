const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldAutoLock, minutesToThresholdSeconds } = require('../dest/main/common/lockPolicy.js');

test('未启用或阈值<=0 不锁', () => {
    assert.equal(shouldAutoLock({ enabled: false, idleSeconds: 9999, thresholdSeconds: 60, anyFullscreen: false }), false);
    assert.equal(shouldAutoLock({ enabled: true, idleSeconds: 9999, thresholdSeconds: 0, anyFullscreen: false }), false);
});

test('空闲达到阈值才锁，未达不锁', () => {
    assert.equal(shouldAutoLock({ enabled: true, idleSeconds: 59, thresholdSeconds: 60, anyFullscreen: false }), false);
    assert.equal(shouldAutoLock({ enabled: true, idleSeconds: 60, thresholdSeconds: 60, anyFullscreen: false }), true);
    assert.equal(shouldAutoLock({ enabled: true, idleSeconds: 120, thresholdSeconds: 60, anyFullscreen: false }), true);
});

test('任一窗口全屏时不因空闲锁（看片不被打断）', () => {
    assert.equal(shouldAutoLock({ enabled: true, idleSeconds: 9999, thresholdSeconds: 60, anyFullscreen: true }), false);
});

test('minutesToThresholdSeconds 安全换算', () => {
    assert.equal(minutesToThresholdSeconds(5), 300);
    assert.equal(minutesToThresholdSeconds(0), 0);
    assert.equal(minutesToThresholdSeconds(undefined), 0);
    assert.equal(minutesToThresholdSeconds(-1), 0);
    assert.equal(minutesToThresholdSeconds(NaN), 0);
    assert.equal(minutesToThresholdSeconds(999999), 24 * 60 * 60); // 上限 24h
});
