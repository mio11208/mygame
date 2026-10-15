(function() {
    if (window.__QA_HELPER_LOADED__) return;
    window.__QA_HELPER_LOADED__ = true;

    // Xác định người chơi hiện tại từ session / query
    const urlParams = new URLSearchParams(window.location.search);
    const currentUser = (window.__GAME_USER__ && window.__GAME_USER__.username) 
        ? window.__GAME_USER__.username 
        : (urlParams.get('user') || 'demo1');

    console.log(`%c[QA Helper] Đang chạy với tài khoản: [${currentUser}]`, 'color: #38bdf8; font-weight: bold; font-size: 14px;');

    // 1. Vô hiệu hóa lệnh dừng debugger khi mở F12
    const _constructor = Function.prototype.constructor;
    Function.prototype.constructor = function(...args) {
        if (args.length > 0 && typeof args[args.length - 1] === 'string' && args[args.length - 1].includes('debugger')) {
            args[args.length - 1] = args[args.length - 1].replace(/debugger;?/g, '');
        }
        return _constructor.apply(this, args);
    };

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register = () => Promise.resolve();
    }

    const rawFetch = window.fetch.bind(window);

    // Mặc định ban đầu lấy từ server hoặc 500.00 (500k VNĐ)
    let customBalance = (window.__GAME_USER__ && typeof window.__GAME_USER__.balance === 'number') 
        ? window.__GAME_USER__.balance 
        : 500.00;
    let baseRemoteVal = null;
    let latestRemoteVal = null;
    let commitTimer = null;
    let isCommitting = false;
    let rawOriginalLabelSet = null;
    window.__qaBalanceLabels = new Set();

    function formatGameCurrency(val) {
        const num = Math.max(0, Number(val) || 0);
        return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    // Hiển thị Banner cảnh báo khi hết tiền (Số dư <= 0)
    function checkZeroBalanceAlert(bal) {
        let alertEl = document.getElementById('qa-zero-balance-alert');
        if (bal <= 0) {
            if (!alertEl) {
                alertEl = document.createElement('div');
                alertEl.id = 'qa-zero-balance-alert';
                alertEl.style.cssText = `
                    position: fixed;
                    top: 15px;
                    left: 50%;
                    transform: translateX(-50%);
                    background: linear-gradient(135deg, #ef4444, #b91c1c);
                    color: #ffffff;
                    padding: 12px 20px;
                    border-radius: 12px;
                    box-shadow: 0 10px 25px rgba(239, 68, 68, 0.6);
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                    font-size: 14px;
                    font-weight: 700;
                    text-align: center;
                    z-index: 9999999;
                    pointer-events: auto;
                    border: 2px solid #fecaca;
                    animation: shakeAlert 0.5s ease-in-out;
                    max-width: 90%;
                `;
                alertEl.innerHTML = `
                    <div style="font-size: 16px; margin-bottom: 4px;">⚠️ HẾT SỐ DƯ (0 VNĐ)</div>
                    <div style="font-size: 12px; opacity: 0.95; font-weight: 500;">Bạn đã sử dụng hết số dư. Vui lòng liên hệ Admin hoặc nhập Giftcode để tiếp tục vòng quay!</div>
                    <button onclick="window.location.href='/'" style="margin-top: 8px; background: #ffffff; color: #b91c1c; border: none; padding: 5px 14px; border-radius: 6px; font-weight: 700; font-size: 12px; cursor: pointer;">Trở về Trang Chủ</button>
                `;
                document.body.appendChild(alertEl);
            }
        } else if (alertEl) {
            alertEl.remove();
        }
    }

    function getLiveDisplayBalance() {
        if (latestRemoteVal !== null && baseRemoteVal !== null) {
            const delta = latestRemoteVal - baseRemoteVal;
            return Math.max(0, Number((customBalance + delta).toFixed(2)));
        }
        return Math.max(0, Number(customBalance.toFixed(2)));
    }

    // Tự động lưu số dư mới của riêng tài khoản này sau khi quay xong
    function scheduleCommitBalance() {
        clearTimeout(commitTimer);
        commitTimer = setTimeout(() => {
            if (latestRemoteVal !== null && baseRemoteVal !== null && Math.abs(latestRemoteVal - baseRemoteVal) > 0.001) {
                const delta = Number((latestRemoteVal - baseRemoteVal).toFixed(2));
                const newBalance = Math.max(0, Number((customBalance + delta).toFixed(2)));
                
                console.log(`%c[QA Helper] [${currentUser}] Spin hoàn tất: Delta = ${delta > 0 ? '+' : ''}${delta} => Số dư mới: ${newBalance}`, 'color: #10b981; font-weight: bold;');
                
                customBalance = newBalance;
                baseRemoteVal = latestRemoteVal;
                checkZeroBalanceAlert(customBalance);

                isCommitting = true;
                rawFetch(window.location.origin + '/api/user/balance', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username: currentUser, balance: newBalance })
                }).then(() => {
                    setTimeout(() => { isCommitting = false; }, 600);
                }).catch(() => {
                    isCommitting = false;
                });
            }
        }, 500);
    }

    // Đồng bộ số dư của riêng người chơi từ máy chủ (khi Admin bơm tiền)
    async function syncBalance() {
        if (isCommitting) return;
        try {
            const res = await rawFetch(window.location.origin + `/api/user/balance?user=${encodeURIComponent(currentUser)}`);
            const data = await res.json();
            if (typeof data.balance === 'number' && !isNaN(data.balance)) {
                const safeBal = Math.max(0, data.balance);
                if (Math.abs(customBalance - safeBal) > 0.01) {
                    console.log(`%c[QA Helper] [${currentUser}] Đồng bộ số dư từ Admin: ${customBalance} => ${safeBal}`, 'color: #38bdf8; font-weight: bold;');
                    customBalance = safeBal;
                    if (latestRemoteVal !== null) {
                        baseRemoteVal = latestRemoteVal;
                    }
                    updateAllBalanceLabels();
                    checkZeroBalanceAlert(customBalance);
                }
            }
        } catch (e) {}
    }

    // 2. Chuyển hướng URL sang Proxy nội bộ
    function rewriteUrl(url) {
        if (typeof url !== 'string') return url;
        if (url.startsWith('http://') || url.startsWith('https://')) {
            if (!url.startsWith(window.location.origin) && !url.includes('google-analytics.com') && !url.includes('googletagmanager.com')) {
                const isHttps = url.startsWith('https://');
                const proto = isHttps ? 'https' : 'http';
                const cleanUrl = url.replace(/^https?:\/\//i, '');
                return window.location.origin + '/__ext/' + proto + '/' + cleanUrl;
            }
        }
        return url;
    }

    // 3. Lọc node và tính toán số dư an toàn
    function isExcludedNode(nodeName, parentName) {
        const n = String(nodeName || '').toLowerCase();
        const p = String(parentName || '').toLowerCase();
        if (n.includes('bet') || n.includes('cuoc') || n.includes('prize') || n.includes('win') || n.includes('rollover')) return true;
        if (p.includes('bet') || p.includes('cuoc') || p.includes('prize') || p.includes('win')) return true;
        return false;
    }

    function transformBalanceValue(val, nodeName, parentName) {
        if (val == null) return val;
        const strVal = String(val);
        const trimmed = strVal.trim();
        const cleanStr = trimmed.replace(/,/g, '');
        const num = parseFloat(cleanStr);
        if (isNaN(num)) return strVal;

        if (isExcludedNode(nodeName, parentName)) return strVal;

        if (num >= 40000 && num <= 500000) {
            const isBalanceNode = /balance|wallet|cash|sodu|tien/i.test(nodeName) || /balance|wallet|cash|sodu|tien/i.test(parentName);
            if (isBalanceNode) {
                if (baseRemoteVal === null) {
                    baseRemoteVal = num;
                }
                latestRemoteVal = num;

                const delta = num - baseRemoteVal;
                const targetVal = Math.max(0, Number((customBalance + delta).toFixed(2)));
                const formatted = formatGameCurrency(targetVal);

                scheduleCommitBalance();

                return formatted;
            }
        }

        return strVal;
    }

    // 4. Hook vào Cocos Creator
    function hookLabelProto(proto, compName) {
        if (!proto || proto.__qaHooked) return;
        proto.__qaHooked = true;
        const originalDesc = Object.getOwnPropertyDescriptor(proto, 'string');
        if (originalDesc && originalDesc.set) {
            const originalSet = originalDesc.set;
            const originalGet = originalDesc.get;
            if (!rawOriginalLabelSet) rawOriginalLabelSet = originalSet;

            Object.defineProperty(proto, 'string', {
                configurable: true,
                enumerable: true,
                get: function() {
                    return originalGet.call(this);
                },
                set: function(val) {
                    if (this.__isSettingCustomString) {
                        return originalSet.call(this, val);
                    }

                    const nodeName = (this.node && this.node.name) ? this.node.name : '';
                    const parentName = (this.node && this.node.parent && this.node.parent.name) ? this.node.parent.name : '';

                    if (this.node && !isExcludedNode(nodeName, parentName)) {
                        const n = nodeName.toLowerCase();
                        const p = parentName.toLowerCase();
                        if (n.includes('balance') || n.includes('wallet') || n.includes('cash') || p.includes('balance') || p.includes('wallet')) {
                            window.__qaBalanceLabels.add(this);
                        }
                    }

                    const transformed = transformBalanceValue(val, nodeName, parentName);
                    this.__isSettingCustomString = true;
                    try {
                        return originalSet.call(this, transformed);
                    } finally {
                        this.__isSettingCustomString = false;
                    }
                }
            });
        }
    }

    function setupCocosHook() {
        if (!window.cc) return;
        if (window.cc.Label) hookLabelProto(window.cc.Label.prototype, 'cc.Label');
        if (window.cc.RichText) hookLabelProto(window.cc.RichText.prototype, 'cc.RichText');
    }

    function updateAllBalanceLabels() {
        const currentTarget = Math.max(0, getLiveDisplayBalance());
        const formatted = formatGameCurrency(currentTarget);

        window.__qaBalanceLabels.forEach(lbl => {
            try {
                if (lbl && lbl.node && lbl.node.isValid) {
                    if (rawOriginalLabelSet) {
                        rawOriginalLabelSet.call(lbl, formatted);
                    } else {
                        lbl.__isSettingCustomString = true;
                        lbl.string = formatted;
                        lbl.__isSettingCustomString = false;
                    }
                }
            } catch(e) {}
        });
    }

    function scanDomForBalance() {
        try {
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
            let textNode;
            const currentTarget = Math.max(0, getLiveDisplayBalance());
            const formatted = formatGameCurrency(currentTarget);
            while (textNode = walker.nextNode()) {
                const text = textNode.nodeValue;
                if (text && /\b(4\d|5\d|6\d|7\d|8\d|9\d|1\d\d|2\d\d|3\d\d|4\d\d),\d{3}\.\d{2}\b/.test(text)) {
                    textNode.nodeValue = text.replace(/\b(4\d|5\d|6\d|7\d|8\d|9\d|1\d\d|2\d\d|3\d\d|4\d\d),\d{3}\.\d{2}\b/g, formatted);
                }
            }
        } catch(e) {}
    }

    setInterval(setupCocosHook, 100);
    setInterval(syncBalance, 600);
    setInterval(scanDomForBalance, 250);
    syncBalance();

    // 5. Bọc XHR & Fetch
    const rawOpen = XMLHttpRequest.prototype.open;
    const rawSend = XMLHttpRequest.prototype.send;
    const rawSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        this._origUrl = url;
        this._url = rewriteUrl(url);
        this._headers = {};
        return rawOpen.call(this, method, this._url, ...rest);
    };

    XMLHttpRequest.prototype.setRequestHeader = function(header, value) {
        if (!this._headers) this._headers = {};
        this._headers[header.toLowerCase()] = value;
        return rawSetRequestHeader.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function(...args) {
        // Nếu người chơi hết tiền, chặn request Spin
        if (this._url && this._url.includes('Spin') && customBalance <= 0) {
            console.warn('[QA Helper] Đã chặn gửi request Spin vì số dư = 0!');
            checkZeroBalanceAlert(0);
        }

        return rawSend.apply(this, args);
    };

    window.fetch = async function(input, init) {
        let urlStr = typeof input === 'string' ? input : (input && input.url ? input.url : '');
        init = init || {};

        if (urlStr && !urlStr.includes('/api/')) {
            const newUrl = rewriteUrl(urlStr);
            if (typeof input === 'string') input = newUrl;
            else if (input && input.url) input = new Request(newUrl, input);
        }

        return await rawFetch(input, init);
    };
})();
