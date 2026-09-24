const test = require('node:test');
const assert = require('node:assert/strict');
const d = require('../dest/modules/downloads/resumePlan.js');

test('planResume：无已收字节→restart；有已收且支持分段→resume；否则 restart', () => {
    assert.deepEqual(d.planResume({ existingBytes: 0, totalBytes: 1000, serverAcceptsRanges: true }),
        { mode: 'restart', startByte: 0 });
    assert.deepEqual(d.planResume({ existingBytes: 400, totalBytes: 1000, serverAcceptsRanges: true }),
        { mode: 'resume', startByte: 400, rangeHeader: 'bytes=400-' });
    // 不支持 Range：即便有 .part 也只能重来
    assert.equal(d.planResume({ existingBytes: 400, totalBytes: 1000, serverAcceptsRanges: false }).mode, 'restart');
});

test('planResume：已收≥总大小→complete；总大小未知仍可续传', () => {
    assert.equal(d.planResume({ existingBytes: 1000, totalBytes: 1000, serverAcceptsRanges: true }).mode, 'complete');
    assert.equal(d.planResume({ existingBytes: 5000, totalBytes: 1000, serverAcceptsRanges: true }).mode, 'complete');
    assert.equal(d.planResume({ existingBytes: 700, totalBytes: null, serverAcceptsRanges: true }).mode, 'resume');
});

test('dedupeFingerprint：同参数稳定；未知大小用 x；取 URL 路径末段', () => {
    const a = d.dedupeFingerprint({ fileName: 'v.mkv', totalBytes: 123, url: 'https://nas/dl/a/v.mkv' });
    const b = d.dedupeFingerprint({ fileName: 'v.mkv', totalBytes: 123, url: 'https://other/x/v.mkv?token=zzz' });
    assert.equal(a, b, '仅文件名+大小+末段参与指纹，忽略 host/query');
    assert.match(a, /::123::v\.mkv$/);
    assert.match(d.dedupeFingerprint({ fileName: 'x', totalBytes: null, url: 'not a url' }), /::x::$/);
});

test('sanitizeFileName：去目录、替换非法字符、防保留名、空→download、限长', () => {
    assert.equal(d.sanitizeFileName('C:\\tmp\\报告 v1?.pdf'), '报告 v1_.pdf');
    assert.equal(d.sanitizeFileName('../../etc/passwd'), 'passwd');
    assert.equal(d.sanitizeFileName('CON'), '_CON');
    assert.equal(d.sanitizeFileName('com1.txt'), '_com1.txt');
    assert.equal(d.sanitizeFileName('   '), 'download');
    assert.equal(d.sanitizeFileName('...weird.name...'), 'weird.name');
    const long = d.sanitizeFileName('a'.repeat(300) + '.mp4');
    assert.ok(long.length <= 200, '超长被截断');
    assert.ok(long.endsWith('.mp4'), '截断保留扩展名');
});

test('computeSpeed / computeEta：基于本地字节与时间窗口', () => {
    assert.equal(d.computeSpeed(1000, 1000), 1000);   // 1s 收 1000B → 1000B/s
    assert.equal(d.computeSpeed(1000, 0), 0);          // 非法耗时
    assert.equal(d.computeSpeed(-5, 100), 0);          // 非正增量
    assert.equal(d.computeEta({ totalBytes: 10000, receivedBytes: 5000, bytesPerSecond: 1000 }), 5);
    assert.equal(d.computeEta({ totalBytes: 1000, receivedBytes: 1000, bytesPerSecond: 1000 }), 0);
    assert.equal(d.computeEta({ totalBytes: null, receivedBytes: 10, bytesPerSecond: 100 }), null);
    assert.equal(d.computeEta({ totalBytes: 100, receivedBytes: 0, bytesPerSecond: 0 }), null);
});
