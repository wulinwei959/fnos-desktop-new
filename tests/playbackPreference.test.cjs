const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
    isMpvPlaybackEnabled,
} = require('../dest/modules/fn_config/playbackPreference.js');

test('默认走原生播放：仅显式 true 才启用 MPV 接管', () => {
    assert.equal(isMpvPlaybackEnabled(true), true);
    assert.equal(isMpvPlaybackEnabled(false), false);
    assert.equal(isMpvPlaybackEnabled(undefined), false); // 默认原生
    assert.equal(isMpvPlaybackEnabled(null), false);
    assert.equal(isMpvPlaybackEnabled('true'), false);
    assert.equal(isMpvPlaybackEnabled(1), false);
    assert.equal(isMpvPlaybackEnabled({ value: true }), false);
});

test('preload 超时与登录页设置默认走原生播放', () => {
    const preloadPlayback = fs.readFileSync(
        path.join(__dirname, '..', 'dest', 'preload', 'core', 'playback.js'),
        'utf8',
    );
    const loginPage = fs.readFileSync(
        path.join(__dirname, '..', 'resource', 'login', 'index.html'),
        'utf8',
    );

    // 超时兜底 = 原生（false）
    assert.match(preloadPlayback, /resolve\(\{ hideOriginalPlayButton: false \}\)/);
    // 登录页开关默认不勾选
    assert.match(loginPage, /id="hideOriginalPlayButtonSwitch"(?!.*\bchecked\b)/);
    // 回填逻辑：仅 === true 才勾上
    assert.match(loginPage, /data\.hideOriginalPlayButton === true/);
});
