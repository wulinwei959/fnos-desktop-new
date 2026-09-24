// 首次连接页：收集服务器地址（IP/域名→原生登录页；FN ID→补账号密码走 FN Connect）。
(function () {
    var ipcRenderer = window.electronAPI;
    var domainInput = document.getElementById('domain');
    var domainError = document.getElementById('domainError');
    var httpsSwitch = document.getElementById('httpsSwitch');
    var nextBtn = document.getElementById('nextBtn');
    var fnidFields = document.getElementById('fnidFields');
    var usernameInput = document.getElementById('username');
    var passwordInput = document.getElementById('password');

    function isFnId(value) {
        return value && !value.includes('.') && value.length >= 6 && value.length <= 30;
    }

    function isValidDomainOrIP(value) {
        if (isFnId(value)) return true;
        var domainRegex = /^([\u4e00-\u9fa5a-zA-Z0-9-]+\.)+[\u4e00-\u9fa5a-zA-Z]{2,}(:\d+)?$/;
        var ipv4Regex = /^(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)){3}(:\d+)?$/;
        return domainRegex.test(value) || ipv4Regex.test(value);
    }

    function checkInput() {
        var domain = domainInput.value.trim();
        var valid = Boolean(domain) && isValidDomainOrIP(domain);
        var fnid = valid && isFnId(domain);
        fnidFields.style.display = fnid ? '' : 'none';
        if (fnid) {
            valid = Boolean(usernameInput.value.trim() && passwordInput.value);
        }
        nextBtn.disabled = !valid;
        nextBtn.textContent = fnid ? '登录' : '前往登录';
        domainError.style.display = domain && !isValidDomainOrIP(domain) ? 'block' : 'none';
    }

    function submit() {
        if (nextBtn.disabled) return;
        var domain = domainInput.value.trim();
        if (isFnId(domain)) {
            ipcRenderer.send('login', {
                domain: domain,
                username: usernameInput.value.trim(),
                password: passwordInput.value,
                accessCode: document.getElementById('accessCode').value.trim(),
                useHttps: httpsSwitch.checked,
            });
        } else {
            ipcRenderer.send('native-login', { domain: domain, useHttps: httpsSwitch.checked });
        }
        nextBtn.disabled = true;
        setTimeout(function () {
            nextBtn.disabled = false;
            checkInput();
        }, 5000);
    }

    domainInput.addEventListener('input', checkInput);
    usernameInput.addEventListener('input', checkInput);
    passwordInput.addEventListener('input', checkInput);
    nextBtn.addEventListener('click', submit);
    document.addEventListener('keypress', function (e) {
        if (e.key === 'Enter' && !nextBtn.disabled) submit();
    });

    ipcRenderer.on('config-data', function (event, data) {
        var config = (data && data.config) || {};
        if (config.domain && !domainInput.value) {
            domainInput.value = String(config.domain).replace(/^https?:\/\//, '');
            httpsSwitch.checked = config.useHttps === true;
        }
        if (config.account && !usernameInput.value) {
            usernameInput.value = config.account;
        }
        checkInput();
    });
    ipcRenderer.send('get-config');
})();
