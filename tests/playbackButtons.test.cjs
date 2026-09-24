const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 新播放策略回归：'播放' 走飞牛原生（不得有任何全局劫持插件），MPV 仅通过独立注入按钮触发。
test('native play button is never hijacked; MPV only via the injected button', () => {
    const pluginDir = path.join(__dirname, '..', 'dest', 'preload', 'plugins');
    assert.equal(fs.existsSync(path.join(pluginDir, 'playMaskButton.js')), false, 'playMaskButton 劫持插件必须已移除');
    assert.equal(fs.existsSync(path.join(pluginDir, 'playButton.js')), false, 'playButton 拦截插件必须已移除');
    assert.ok(fs.existsSync(path.join(pluginDir, 'mpvPlayButton.js')), 'mpvPlayButton 独立按钮插件必须存在');

    const mpvPlugin = fs.readFileSync(path.join(pluginDir, 'mpvPlayButton.js'), 'utf8');
    assert.match(mpvPlugin, /MPV 播放/);
    assert.match(mpvPlugin, /customPlay/);
});

test('login page no longer exposes the removed MPV takeover switch', () => {
    const loginPage = fs.readFileSync(
        path.join(__dirname, '..', 'resource', 'login', 'index.html'),
        'utf8',
    );
    assert.equal(loginPage.includes('hideOriginalPlayButton'), false);
    assert.equal(loginPage.includes('play-button-config'), false);
});
