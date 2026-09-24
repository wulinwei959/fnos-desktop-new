const test = require('node:test');
const assert = require('node:assert/strict');
const r = require('../dest/modules/fn_config/serverRegistry.js');

test('normalizeDomain 归一 scheme / 大小写 / 末尾斜杠', () => {
    assert.equal(r.normalizeDomain('NAS.Example.COM/'), 'https://nas.example.com');
    assert.equal(r.normalizeDomain('https://nas.example.com///'), 'https://nas.example.com');
    assert.equal(r.normalizeDomain('http://192.168.1.5:5666/'), 'http://192.168.1.5:5666');
    assert.equal(r.normalizeDomain('  '), '');
    // http 与 https 是不同端点
    assert.notEqual(r.normalizeDomain('http://a.com'), r.normalizeDomain('https://a.com'));
});

test('首台服务器加入即成为活动项，domain 重复只更新不新增', () => {
    let reg = r.emptyRegistry();
    reg = r.upsertServer(reg, { domain: 'https://a.com', account: 'alice' }, 1);
    assert.equal(r.listServers(reg).length, 1);
    assert.equal(reg.activeDomain, 'https://a.com');

    reg = r.upsertServer(reg, { domain: 'https://a.com', account: 'bob' }, 2);
    assert.equal(r.listServers(reg).length, 1, '同一 domain 不应新增');
    assert.equal(r.getActiveServer(reg).account, 'bob', 'account 应被更新');
});

test('活动项被删除时回退到剩余第一台；删非活动项不影响活动项', () => {
    let reg = r.coerceRegistry({
        servers: [
            { domain: 'https://a.com', addedAt: 1 },
            { domain: 'https://b.com', addedAt: 2 },
        ],
        activeDomain: 'https://a.com',
    });
    reg = r.removeServer(reg, 'https://a.com');
    assert.equal(reg.activeDomain, 'https://b.com');
    assert.equal(r.listServers(reg).length, 1);

    const before = r.removeServer(reg, 'https://not-exist.com');
    assert.equal(before, reg, '删不存在的项应原样返回');
});

test('setActiveServer 未知 domain 时不改；已知则切换', () => {
    let reg = r.upsertServer(r.emptyRegistry(), { domain: 'https://a.com' }, 1);
    reg = r.upsertServer(reg, { domain: 'https://b.com' }, 2);
    assert.equal(reg.activeDomain, 'https://a.com');
    assert.equal(r.setActiveServer(reg, 'https://b.com').activeDomain, 'https://b.com');
    assert.equal(r.setActiveServer(reg, 'https://zzz.com').activeDomain, 'https://a.com', '未知不改');
});

test('超过上限时淘汰最旧且非活动者，保留活动项', () => {
    let reg = r.coerceRegistry({ servers: [], activeDomain: null });
    // 塞入 32 台，active 设为第 1 台，再加第 33 台应淘汰最旧的非活动（第 2 台）
    for (let i = 1; i <= 32; i++) {
        reg = r.upsertServer(reg, { domain: `https://s${i}.com` }, i);
    }
    reg = r.setActiveServer(reg, 'https://s1.com');
    reg = r.upsertServer(reg, { domain: 'https://s33.com' }, 33);
    const list = r.listServers(reg);
    assert.equal(list.length, 32, '总数受上限约束');
    assert.equal(reg.activeDomain, 'https://s1.com', '活动项不应被淘汰');
    assert.ok(!list.some(s => s.domain === 'https://s2.com'), '最旧非活动应被挤出');
    assert.ok(list.some(s => s.domain === 'https://s33.com'), '新加入应保留');
});

test('所有操作不可变：不修改传入的注册表与内部数组', () => {
    let reg = r.upsertServer(r.emptyRegistry(), { domain: 'https://a.com' }, 1);
    const snapshotServers = reg.servers.slice();
    r.upsertServer(reg, { domain: 'https://b.com' }, 2);
    r.removeServer(reg, 'https://a.com');
    assert.deepEqual(reg.servers, snapshotServers, '原注册表不应被改动');
    assert.equal(reg.activeDomain, 'https://a.com');
    assert.notEqual(r.listServers(reg), reg.servers, 'listServers 应返回副本');
});

test('coerceRegistry 容忍脏数据：补全缺失 addedAt、去重、回退非法活动项', () => {
    const reg = r.coerceRegistry({
        servers: [
            { domain: 'https://a.com' },                 // 缺 addedAt
            { domain: 'https://A.com/' },                // 规范化后与上重复
            { domain: 'https://b.com', addedAt: 5 },
        ],
        activeDomain: 'https://ghost.com',               // 不存在
    });
    assert.equal(r.listServers(reg).length, 2, '重复 domain 去重');
    assert.equal(reg.activeDomain, 'https://a.com', '非法活动项回退到第一台');
    assert.equal(typeof r.listServers(reg)[0].addedAt, 'number');
});
