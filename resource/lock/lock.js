// 锁屏页渲染逻辑（主世界），通过 window.lockAPI（preload 暴露）与主进程交互。
(function () {
    var $ = function (id) { return document.getElementById(id); };
    var params = new URLSearchParams(location.search);
    var mode = params.get('mode') || 'unlock';

    function applyMode() {
        $('err').textContent = '';
        if (mode === 'setup') {
            $('title').textContent = '设置开机密码';
            $('setupHint').style.display = '';
            $('row2').style.display = '';
            $('pw1').placeholder = '设置密码（至少 4 位）';
            $('submit').textContent = '保存密码';
        } else if (mode === 'change') {
            $('title').textContent = '修改开机密码';
            $('setupHint').style.display = 'none';
            $('row2').style.display = '';
            $('pw1').placeholder = '当前密码';
            $('submit').textContent = '确认修改';
        } else {
            $('title').textContent = '应用已锁定';
            $('setupHint').style.display = 'none';
            $('row2').style.display = 'none';
            $('pw1').placeholder = '请输入密码';
            $('submit').textContent = '解锁';
        }
    }
    applyMode();

    async function onSubmit() {
        var a = $('pw1').value, b = $('pw2').value;
        $('err').textContent = '';
        if (mode === 'unlock') {
            var r = await window.lockAPI.unlock(a);
            if (!r.ok) { $('err').textContent = r.error || '密码错误'; $('pw1').value = ''; }
            // 成功：主进程会关闭锁屏窗，无需在此处理
            return;
        }
        if (a.length < 4) { $('err').textContent = '密码至少 4 位'; return; }
        if (a !== b) { $('err').textContent = '两次输入不一致'; return; }
        var oldPw = mode === 'change' ? a : '';
        var res = await window.lockAPI.setPassword(oldPw, b);
        if (!res.ok) { $('err').textContent = res.error || '设置失败'; return; }
        $('pw1').value = ''; $('pw2').value = '';
        $('title').textContent = mode === 'setup' ? '开机密码已设置' : '开机密码已修改';
        $('setupHint').style.display = 'none';
        $('row2').style.display = 'none';
        $('submit').textContent = '完成';
        mode = 'done';
    }

    $('submit').addEventListener('click', function () {
        if (mode === 'done') { window.close(); return; }
        onSubmit();
    });
    $('pw1').addEventListener('keydown', function (e) { if (e.key === 'Enter') onSubmit(); });
    $('pw2').addEventListener('keydown', function (e) { if (e.key === 'Enter') onSubmit(); });
    $('hide').addEventListener('click', function () { window.lockAPI.hide(); });
    window.addEventListener('DOMContentLoaded', function () { var el = $('pw1'); if (el) el.focus(); });
})();
