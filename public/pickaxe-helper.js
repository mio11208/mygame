(function() {
    if (window.__PICKAXE_HELPER_LOADED__) return;
    window.__PICKAXE_HELPER_LOADED__ = true;

    // 1. Xác định thông tin người chơi & số dư từ server / URL
    const urlParams = new URLSearchParams(window.location.search);
    const currentUser = (window.__GAME_USER__ && window.__GAME_USER__.username)
        ? window.__GAME_USER__.username
        : (urlParams.get('user') || 'demo1');

    let initialWallet = (window.__GAME_USER__ && typeof window.__GAME_USER__.balance === 'number')
        ? window.__GAME_USER__.balance
        : 500.00;

    let customBalance = initialWallet; // Đơn vị ví (500.00 = 500,000 VNĐ)
    let lastRemoteBal = null;
    let isCommitting = false;

    console.log(`%c[Falling Pickaxe Helper] Kích hoạt đồng bộ ví cho tài khoản: [${currentUser}] | Số dư: ${customBalance}`, 'color: #38bdf8; font-weight: bold; font-size: 14px;');

    function formatVND(num) {
        return (Math.max(0, Number(num) || 0) * 1000).toLocaleString('vi-VN') + ' đ';
    }

    // Cung cấp số dư hiện tại cho các hook
    window.__getCustomBalance = function() {
        return customBalance;
    };

    // 2. Chèn thanh điều hướng nổi trên đầu game
    function injectTopBar() {
        if (document.getElementById('pickaxe-top-bar')) return;
        const topBar = document.createElement('div');
        topBar.id = 'pickaxe-top-bar';
        topBar.style.cssText = `
            position: fixed;
            top: 0; left: 0; right: 0;
            height: 44px;
            background: linear-gradient(180deg, rgba(12, 21, 39, 0.98) 0%, rgba(8, 14, 26, 0.95) 100%);
            border-bottom: 1px solid rgba(255, 255, 255, 0.12);
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0 12px;
            z-index: 99999999;
            backdrop-filter: blur(8px);
            box-shadow: 0 4px 15px rgba(0,0,0,0.5);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        `;
        topBar.innerHTML = `
            <a href="/" style="display:flex; align-items:center; gap:6px; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); color:#f3f4f6; padding:5px 12px; border-radius:8px; font-size:12px; font-weight:700; text-decoration:none; cursor:pointer;">
                ⬅ Quay lại sảnh
            </a>
            <div style="display:flex; align-items:center; gap:8px;">
                <span style="font-size:13px; font-weight:800; color:#ffffff;">⛏️ Falling Pickaxe</span>
                <span style="background:rgba(16, 185, 129, 0.2); color:#10b981; border:1px solid rgba(16, 185, 129, 0.4); font-size:10px; font-weight:700; padding:2px 6px; border-radius:4px;">ARCADE</span>
            </div>
            <div style="display:flex; align-items:center; gap:6px; background:rgba(16, 185, 129, 0.12); border:1px solid rgba(16, 185, 129, 0.3); padding:4px 12px; border-radius:20px;">
                <div style="width:7px; height:7px; border-radius:50%; background:#10b981; box-shadow:0 0 8px #10b981;"></div>
                <span style="font-size:11px; color:#94a3b8; font-weight:600;">Ví:</span>
                <span id="pickaxeLiveBal" style="font-size:12px; font-weight:800; color:#38bdf8;">${formatVND(customBalance)}</span>
            </div>
        `;
        document.documentElement.appendChild(topBar);

        const style = document.createElement('style');
        style.textContent = `
            body { padding-top: 44px !important; box-sizing: border-box !important; }
        `;
        document.documentElement.appendChild(style);
    }

    // 3. Modal cảnh báo hết tiền
    function checkZeroBalanceAlert(bal) {
        let alertEl = document.getElementById('pickaxe-zero-alert');
        if (bal <= 0) {
            if (!alertEl) {
                alertEl = document.createElement('div');
                alertEl.id = 'pickaxe-zero-alert';
                alertEl.style.cssText = `
                    position: fixed;
                    top: 0; left: 0; right: 0; bottom: 0;
                    background: rgba(0, 0, 0, 0.85);
                    backdrop-filter: blur(6px);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 999999999;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                `;
                alertEl.innerHTML = `
                    <div style="background:#131f38; border:1px solid rgba(239, 68, 68, 0.4); border-radius:16px; padding:24px 20px; max-width:380px; width:90%; text-align:center; box-shadow:0 20px 50px rgba(0,0,0,0.8); color:#fff;">
                        <div style="font-size:36px; margin-bottom:8px;">⚠️</div>
                        <h3 style="color:#ef4444; font-size:18px; margin-bottom:8px; font-weight:800;">Số Dư Đã Hết (0 VNĐ)</h3>
                        <p style="color:#cbd5e1; font-size:13px; line-height:1.5; margin-bottom:18px;">Bạn đã sử dụng hết tiền trong ví.<br>Vui lòng quay lại sảnh hoặc liên hệ Quản Trị Viên (Admin) để được nạp thêm!</p>
                        <a href="/" style="background:linear-gradient(180deg, #f59e0b 0%, #d97706 100%); color:#000; font-weight:800; border:none; padding:10px 24px; border-radius:8px; cursor:pointer; font-size:14px; text-decoration:none; display:inline-block;">Về Sảnh Chờ</a>
                    </div>
                `;
                document.documentElement.appendChild(alertEl);
            }
        } else if (alertEl) {
            alertEl.remove();
        }
    }

    window.__showZeroAlert = function() {
        checkZeroBalanceAlert(0);
    };

    function updateLiveDisplay(bal) {
        const el = document.getElementById('pickaxeLiveBal');
        if (el) el.textContent = formatVND(bal);
        checkZeroBalanceAlert(bal);
    }

    const rawFetch = window.fetch.bind(window);

    // 4. Hook kiểm tra trước khi gửi yêu cầu tới Pixmove (Chặn khi số dư <= 0)
    window.__beforePixmoveRequest = function(func, handler, args) {
        if (handler && func === handler.make) {
            const betSum = (args && typeof args[0] === 'number') ? args[0] : 0;
            const betUnits = betSum / 100;
            if (customBalance <= 0 || (betUnits > 0 && customBalance < betUnits)) {
                console.warn('[Falling Pickaxe] Chặn lượt chơi vì số dư không đủ:', customBalance, '<', betUnits);
                checkZeroBalanceAlert(0);
                return false;
            }
        }
        return true;
    };

    // 5. Hook xử lý kết quả trả về từ Pixmove Game Engine
    window.__onPixmoveData = function(res, func, self) {
        if (!res || !res.data) return res;

        try {
            const player = res.data.player;
            const gameState = res.data.gameState;

            // Xử lý khi mở phiên game (openSession)
            if (self && self.handler && func === self.handler.openSession) {
                if (player && typeof player.balance === 'number') {
                    lastRemoteBal = player.balance;
                    player.balance = Math.round(customBalance * 100);
                    console.log(`[Falling Pickaxe] openSession: remoteBal=${lastRemoteBal} => customBalance=${customBalance}`);
                }
            }
            // Xử lý khi bắt đầu lượt chơi / đào kho báu (make)
            else if (self && self.handler && func === self.handler.make) {
                if (player && typeof player.balance === 'number' && lastRemoteBal !== null) {
                    const delta = (player.balance - lastRemoteBal) / 100;
                    lastRemoteBal = player.balance;

                    customBalance = Math.max(0, Number((customBalance + delta).toFixed(2)));
                    player.balance = Math.round(customBalance * 100);

                    console.log(`%c[Falling Pickaxe] Kết quả lượt chơi: Delta = ${delta >= 0 ? '+' : ''}${delta} => Số dư mới: ${customBalance} (${formatVND(customBalance)})`, 'color:#10b981; font-weight:bold;');
                    updateLiveDisplay(customBalance);

                    // Đồng bộ trực tiếp vào MongoDB
                    isCommitting = true;
                    rawFetch(window.location.origin + '/api/state', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ username: currentUser, delta })
                    }).then(() => {
                        setTimeout(() => { isCommitting = false; }, 500);
                    }).catch(() => {
                        isCommitting = false;
                    });
                } else if (gameState && typeof gameState.resultSum === 'number') {
                    const betSum = (self.handler && self.handler.bet) || 0;
                    const delta = ((gameState.resultSum || 0) - betSum) / 100;
                    customBalance = Math.max(0, Number((customBalance + delta).toFixed(2)));
                    if (player) player.balance = Math.round(customBalance * 100);

                    updateLiveDisplay(customBalance);
                    rawFetch(window.location.origin + '/api/state', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ username: currentUser, delta })
                    });
                }
            }
            // Xử lý khi chốt tiền thưởng / kết thúc cược (closeBet / takeBonusWin)
            else if (self && self.handler && (func === self.handler.closeBet || func === self.handler.takeBonusWin)) {
                if (player && typeof player.balance === 'number' && lastRemoteBal !== null) {
                    const delta = (player.balance - lastRemoteBal) / 100;
                    if (Math.abs(delta) > 0.001) {
                        lastRemoteBal = player.balance;
                        customBalance = Math.max(0, Number((customBalance + delta).toFixed(2)));
                        player.balance = Math.round(customBalance * 100);
                        updateLiveDisplay(customBalance);
                        rawFetch(window.location.origin + '/api/state', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ username: currentUser, delta })
                        });
                    }
                }
            }
            // Xử lý khi game hỏi số dư định kỳ (getPlayerBalance)
            else if (self && self.handler && func === self.handler.getPlayerBalance) {
                if (player) {
                    player.balance = Math.round(customBalance * 100);
                }
            }
        } catch(err) {
            console.error('[Falling Pickaxe Helper Error]', err);
        }

        return res;
    };

    // 6. Đồng bộ số dư định kỳ từ MongoDB (khi Admin bơm thêm tiền qua /admin)
    async function syncWalletFromAdmin() {
        if (isCommitting) return;
        try {
            const res = await rawFetch(window.location.origin + `/api/state?user=${encodeURIComponent(currentUser)}`);
            const data = await res.json();
            if (typeof data.balance === 'number' && !isNaN(data.balance)) {
                const safeBal = Math.max(0, data.balance);
                if (Math.abs(customBalance - safeBal) > 0.01) {
                    console.log(`%c[Falling Pickaxe Helper] Đồng bộ tiền từ Admin: ${customBalance} => ${safeBal}`, 'color:#38bdf8; font-weight:bold;');
                    customBalance = safeBal;
                    updateLiveDisplay(customBalance);

                    // Cập nhật ngay lập tức vào canvas của game Pixmove
                    if (window.api && typeof window.api.emit === 'function') {
                        window.api.emit('PLAYER_BALANCE_CHANGED', { balance: Math.round(customBalance * 100) });
                    }
                }
            }
        } catch (e) {}
    }

    setInterval(syncWalletFromAdmin, 1200);

    // Chờ DOM sẵn sàng để chèn Top Bar
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectTopBar);
    } else {
        injectTopBar();
    }
})();
