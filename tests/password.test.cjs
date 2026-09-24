const test = require('node:test');
const assert = require('node:assert/strict');
const {
    createPasswordRecord,
    hashPassword,
    verifyPassword,
} = require('../dest/modules/security/password.js');

test('createPasswordRecord yields random salt and never stores the plaintext', () => {
    const a = createPasswordRecord('correct horse battery');
    const b = createPasswordRecord('correct horse battery');
    assert.match(a.salt, /^[0-9a-f]{32}$/);
    assert.match(a.hash, /^[0-9a-f]{128}$/);
    // 同口令两次生成的盐不同 → 哈希不同（随机盐）
    assert.notEqual(a.salt, b.salt);
    assert.notEqual(a.hash, b.hash);
    assert.doesNotMatch(JSON.stringify(a), /correct horse battery/);
});

test('verifyPassword accepts the right password and rejects wrong ones', () => {
    const record = createPasswordRecord('s3cr3t-pass');
    assert.equal(verifyPassword('s3cr3t-pass', record), true);
    assert.equal(verifyPassword('S3CR3T-PASS', record), false);
    assert.equal(verifyPassword('s3cr3t-pas', record), false);
    assert.equal(verifyPassword('', record), false);
});

test('hashPassword is deterministic for a given salt', () => {
    const salt = '00'.repeat(16);
    assert.equal(hashPassword('abc', salt), hashPassword('abc', salt));
    assert.notEqual(hashPassword('abc', salt), hashPassword('abd', salt));
});

test('verifyPassword is safe against malformed records', () => {
    assert.equal(verifyPassword('x', null), false);
    assert.equal(verifyPassword('x', undefined), false);
    assert.equal(verifyPassword('x', { salt: '', hash: '' }), false);
    // 长度不一致不应抛错，只应返回 false
    assert.equal(verifyPassword('x', { salt: 'ab', hash: 'deadbeef' }), false);
});
