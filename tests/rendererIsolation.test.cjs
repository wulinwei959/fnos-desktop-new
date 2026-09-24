const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('main window disables renderer Node access and enables context isolation', () => {
    const mainWindow = fs.readFileSync(
        path.join(__dirname, '..', 'dest', 'main', 'common', 'mainwin.js'),
        'utf8',
    );
    assert.match(mainWindow, /nodeIntegration:\s*false/);
    assert.match(mainWindow, /contextIsolation:\s*true/);
});

test('login page uses the restricted preload bridge and never inlines credentials', () => {
    const loginPage = fs.readFileSync(
        path.join(__dirname, '..', 'resource', 'login', 'index.html'),
        'utf8',
    );
    const loginScript = fs.readFileSync(
        path.join(__dirname, '..', 'resource', 'login', 'server.js'),
        'utf8',
    );
    const combined = `${loginPage}\n${loginScript}`;
    assert.doesNotMatch(combined, /require\(['"]electron['"]\)/);
    assert.match(loginScript, /window\.electronAPI/);
    // 密码只通过 IPC 传给主进程，绝不拼进 HTML/DOM 字符串
    assert.doesNotMatch(loginScript, /innerHTML\s*=.*password/i);
    assert.doesNotMatch(loginScript, /data-password="\$\{/);
});
