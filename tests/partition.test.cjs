const test = require('node:test');
const assert = require('node:assert/strict');
const {
    PARTITION_FNTV,
    partitionForServer,
    currentPartition,
    setCurrentPartition,
} = require('../dest/main/common/partition.js');

test('empty server key falls back to the single-server baseline partition', () => {
    assert.equal(partitionForServer(''), PARTITION_FNTV);
    assert.equal(partitionForServer('   '), PARTITION_FNTV);
    assert.equal(PARTITION_FNTV, 'persist:fntv');
});

test('distinct servers map to distinct, namespaced persistent partitions', () => {
    const a = partitionForServer('https://nas.example.com');
    const b = partitionForServer('http://192.168.1.100:5666');
    assert.match(a, /^persist:nas-[0-9a-f]{16}$/);
    assert.match(b, /^persist:nas-[0-9a-f]{16}$/);
    assert.notEqual(a, b);
});

test('the same server key is stable and case/whitespace-insensitive', () => {
    const x = partitionForServer('https://nas.example.com');
    assert.equal(x, partitionForServer('https://nas.example.com'));
    assert.equal(x, partitionForServer('HTTPS://NAS.example.com  '));
});

test('currentPartition defaults to baseline and follows setCurrentPartition', () => {
    const original = currentPartition();
    assert.equal(original, PARTITION_FNTV);

    const p = partitionForServer('https://corp-nas.lan');
    setCurrentPartition(p);
    assert.equal(currentPartition(), p);

    // 恢复基线，避免污染其它测试
    setCurrentPartition(PARTITION_FNTV);
    assert.equal(currentPartition(), PARTITION_FNTV);
});
