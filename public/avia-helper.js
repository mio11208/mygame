(function() {
    if (window.__AVIA_HELPER_LOADED__) return;
    window.__AVIA_HELPER_LOADED__ = true;

    // 1. Xác định thông tin tài khoản & số dư từ server / URL
    const urlParams = new URLSearchParams(window.location.search);
    const currentUser = (window.__GAME_USER__ && window.__GAME_USER__.username)
        ? window.__GAME_USER__.username
        : (urlParams.get('user') || 'demo1');

    let initialWallet = (window.__GAME_USER__ && typeof window.__GAME_USER__.balance === 'number')
        ? window.__GAME_USER__.balance
        : 500.00;

    let customBalance = initialWallet; // Đơn vị ví (500.00 = 500,000 VNĐ)
    let lastRemoteTotal = null;        // Tổng số dư thực tế phía remote BGaming để tính chính xác cược thường & mua bonus
    let pendingWin = 0;               // Tiền thắng của chuyến bay đang bay, chờ hạ cánh
    let pendingWinTimeout = null;      // Bộ đếm thời gian dự phòng nếu sự kiện hạ cánh bị trễ
    let isCommitting = false;

    console.log(`%c[Aviamasters 2 Helper] Kích hoạt đồng bộ ví cho tài khoản: [${currentUser}] | Số dư ban đầu: ${customBalance} (${formatVND(customBalance)})`, 'color: #38bdf8; font-weight: bold; font-size: 14px;');

    function formatVND(num) {
        return (Math.max(0, Number(num) || 0) * 1000).toLocaleString('vi-VN') + ' đ';
    }

    // 2. Chèn thanh điều hướng nổi trên đầu game
    function injectTopBar() {
        if (document.getElementById('avia-top-bar')) return;
        const topBar = document.createElement('div');
        topBar.id = 'avia-top-bar';
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
                <span style="font-size:13px; font-weight:800; color:#ffffff;">✈️ Aviamasters 2</span>
                <span style="background:rgba(245, 158, 11, 0.2); color:#f59e0b; border:1px solid rgba(245, 158, 11, 0.4); font-size:10px; font-weight:700; padding:2px 6px; border-radius:4px;">CRASH GAME</span>
            </div>
            <div style="display:flex; align-items:center; gap:6px; background:rgba(16, 185, 129, 0.12); border:1px solid rgba(16, 185, 129, 0.3); padding:4px 12px; border-radius:20px;">
                <div style="width:7px; height:7px; border-radius:50%; background:#10b981; box-shadow:0 0 8px #10b981;"></div>
                <span style="font-size:11px; color:#94a3b8; font-weight:600;">Ví:</span>
                <span id="aviaLiveBal" style="font-size:12px; font-weight:800; color:#38bdf8;">${formatVND(customBalance)}</span>
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
        let alertEl = document.getElementById('avia-zero-alert');
        if (bal <= 0) {
            if (!alertEl) {
                alertEl = document.createElement('div');
                alertEl.id = 'avia-zero-alert';
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
                        <p style="color:#cbd5e1; font-size:13px; line-height:1.5; margin-bottom:18px;">Bạn đã sử dụng hết tiền trong ví.<br>Vui lòng quay lại sảnh hoặc nhập Giftcode để tiếp tục chơi!</p>
                        <a href="/" style="background:linear-gradient(180deg, #f59e0b 0%, #d97706 100%); color:#000; font-weight:800; border:none; padding:10px 24px; border-radius:8px; cursor:pointer; font-size:14px; text-decoration:none; display:inline-block;">Về Sảnh Chờ</a>
                    </div>
                `;
                document.documentElement.appendChild(alertEl);
            }
        } else if (alertEl) {
            alertEl.remove();
        }
    }

    function updateLiveDisplay(bal) {
        const el = document.getElementById('aviaLiveBal');
        if (el) el.textContent = formatVND(bal);
        checkZeroBalanceAlert(bal);
    }

    // 4. Hàm đồng bộ biến động số dư vào MongoDB & Backend
    const rawFetch = window.fetch.bind(window);

    function commitDelta(delta) {
        if (!delta || Math.abs(delta) < 0.0001) return;
        isCommitting = true;
        rawFetch(window.location.origin + '/api/state', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: currentUser, delta: delta })
        }).then(res => res.json()).then(data => {
            if (data && typeof data.balance === 'number' && pendingWin === 0) {
                customBalance = data.balance;
                updateLiveDisplay(customBalance);
            }
            setTimeout(() => { isCommitting = false; }, 400);
        }).catch(err => {
            console.error('[Aviamasters Helper State Commit Error]', err);
            isCommitting = false;
        });
    }

    // 5. Hàm chốt thưởng cho chuyến bay khi máy bay hạ cánh an toàn
    function flushPendingWin(triggerSource) {
        if (pendingWinTimeout) {
            clearTimeout(pendingWinTimeout);
            pendingWinTimeout = null;
        }
        if (pendingWin > 0) {
            const winToAdd = pendingWin;
            pendingWin = 0;
            customBalance = Number((customBalance + winToAdd).toFixed(2));
            console.log(`%c[Aviamasters 2] 🛬 Máy bay hạ cánh an toàn! Cộng thưởng: +${winToAdd} (${formatVND(winToAdd)}) => Số dư mới: ${customBalance} (${formatVND(customBalance)}) [Trigger: ${triggerSource}]`, 'color:#10b981; font-weight:bold; font-size:13px;');
            updateLiveDisplay(customBalance);
            commitDelta(winToAdd);
        }
    }

    // 6. Lắng nghe sự kiện kết thúc chuyến bay từ BGaming engine
    window.trackGameEventListeners = window.trackGameEventListeners || [];
    window.trackGameEventListeners.push(function(eventName, eventObj, eventData) {
        if (eventName === 'finish_round_animations' || eventName === 'finish_spin_animations') {
            flushPendingWin(eventName);
        }
    });

    // Dự phòng an toàn khi rời trang hoặc làm mới trình duyệt
    window.addEventListener('beforeunload', () => {
        if (pendingWin > 0) {
            const winToAdd = pendingWin;
            pendingWin = 0;
            if (navigator.sendBeacon) {
                const blob = new Blob([JSON.stringify({ username: currentUser, delta: winToAdd })], { type: 'application/json' });
                navigator.sendBeacon(window.location.origin + '/api/state', blob);
            } else {
                commitDelta(winToAdd);
            }
        }
    });
    window.addEventListener('pagehide', () => {
        if (pendingWin > 0) {
            const winToAdd = pendingWin;
            pendingWin = 0;
            if (navigator.sendBeacon) {
                const blob = new Blob([JSON.stringify({ username: currentUser, delta: winToAdd })], { type: 'application/json' });
                navigator.sendBeacon(window.location.origin + '/api/state', blob);
            }
        }
    });

    // 7. Hook window.fetch để chặn/sửa gói cược, mua bonus và trả thưởng của BGaming
    window.fetch = async function(input, init) {
        const url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
        const isBgamingApi = url.includes('/api/Aviamasters2/') || (window.__OPTIONS__ && window.__OPTIONS__.api && url.includes(window.__OPTIONS__.api));

        if (isBgamingApi && init && init.body) {
            let reqBody = null;
            try {
                reqBody = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
            } catch (e) {}

            const command = reqBody ? reqBody.command : null;

            // Nếu người chơi bắt đầu lượt bay mới mà tiền thắng lượt trước chưa cộng, chốt ngay lập tức
            if (command === 'spin' && pendingWin > 0) {
                flushPendingWin('next_spin_start');
            }

            // Chặn cược / mua bonus khi hết số dư hoặc cược vượt quá số dư ví
            if (command === 'spin') {
                let betSubunits = (reqBody && reqBody.options && typeof reqBody.options.bet === 'number')
                    ? reqBody.options.bet
                    : 1000;
                
                // Mua tính năng Bonus (freespin_chance) có hệ số nhân 50 lần cược cơ sở
                if (reqBody && reqBody.options && reqBody.options.purchased_feature) {
                    betSubunits = betSubunits * 50;
                }

                const betVal = betSubunits / 100;

                if (customBalance < betVal || customBalance <= 0) {
                    console.warn(`[Aviamasters Helper] Chặn cược/mua bonus: Số dư ví (${customBalance}) < Giá cược/tính năng (${betVal})`);
                    checkZeroBalanceAlert(customBalance);
                    const mockErr = {
                        errors: [{ code: 1001, desc: `Số dư ví không đủ! Cần ${formatVND(betVal)} để thực hiện, nhưng ví chỉ còn ${formatVND(customBalance)}. Vui lòng nạp thêm tiền hoặc nhập Giftcode.` }]
                    };
                    return new Response(JSON.stringify(mockErr), {
                        status: 422,
                        headers: { 'Content-Type': 'application/json' }
                    });
                }
            }

            // Gửi request thực tế tới BGaming server
            const response = await rawFetch(input, init);

            try {
                const clone = response.clone();
                const json = await clone.json();

                // 1. Phản hồi cho lệnh 'init': Ghi đè số dư ví hiển thị trong game thành số dư của user
                if (command === 'init' && json && json.balance) {
                    if (typeof json.balance.wallet === 'number') {
                        lastRemoteTotal = json.balance.wallet + (typeof json.balance.game === 'number' ? json.balance.game : 0);
                    }

                    json.balance.wallet = Math.round(customBalance * 100);
                    if (json.options && json.options.currency) {
                        json.options.currency.symbol = "đ";
                    }

                    console.log(`%c[Aviamasters Helper] Khởi tạo game với số dư ví: ${customBalance} (${formatVND(customBalance)})`, 'color:#10b981; font-weight:bold;');
                    updateLiveDisplay(customBalance);

                    return new Response(JSON.stringify(json), {
                        status: response.status,
                        statusText: response.statusText,
                        headers: response.headers
                    });
                }

                // 2. Phản hồi cho lệnh 'spin':
                // - Trừ tiền cược / mua bonus ngay khi máy bay cất cánh
                // - Ghi nhận tiền thắng (nếu có) để cộng khi máy bay hạ cánh thành công
                if (command === 'spin' && json && json.balance) {
                    // Tính chính xác số tiền cược thực tế bị trừ từ remote server BGaming
                    let roundBetSubunits = 0;
                    if (lastRemoteTotal !== null && typeof json.balance.wallet === 'number' && lastRemoteTotal > json.balance.wallet) {
                        roundBetSubunits = lastRemoteTotal - json.balance.wallet;
                    } else {
                        // Fallback tính theo reqBody
                        let baseSub = (reqBody && reqBody.options && typeof reqBody.options.bet === 'number') ? reqBody.options.bet : 1000;
                        if (reqBody && reqBody.options && reqBody.options.purchased_feature) {
                            baseSub = baseSub * 50;
                        } else if (json.outcome && typeof json.outcome.bet === 'number') {
                            baseSub = json.outcome.bet;
                        }
                        roundBetSubunits = baseSub;
                    }
                    const roundBet = roundBetSubunits / 100;

                    const roundWinSubunits = (json.outcome && typeof json.outcome.win === 'number')
                        ? json.outcome.win
                        : (typeof json.balance.game === 'number' ? json.balance.game : 0);
                    const roundWin = roundWinSubunits / 100;

                    // Cập nhật lại lastRemoteTotal cho vòng cược kế tiếp
                    if (typeof json.balance.wallet === 'number') {
                        lastRemoteTotal = json.balance.wallet + (typeof json.balance.game === 'number' ? json.balance.game : 0);
                    }

                    // 1. Trừ tiền cược / tiền mua bonus ngay lập tức khi máy bay xuất phát
                    customBalance = Math.max(0, Number((customBalance - roundBet).toFixed(2)));
                    const isBonusBuy = !!(reqBody && reqBody.options && reqBody.options.purchased_feature);
                    console.log(`%c[Aviamasters 2] 🛫 ${isBonusBuy ? 'MUA TÍNH NĂNG BONUS' : 'Máy bay cất cánh'}! Giá: -${roundBet} (${formatVND(roundBet)}) => Số dư ví tạm tính: ${customBalance} (${formatVND(customBalance)}) | Tiền thắng dự kiến: +${roundWin} (${formatVND(roundWin)})`, 'color:#f59e0b; font-weight:bold;');
                    updateLiveDisplay(customBalance);
                    commitDelta(-roundBet);

                    // 2. Thiết lập tiền thắng chờ hạ cánh
                    if (roundWin > 0) {
                        pendingWin = roundWin;
                        // Bộ đếm thời gian dự phòng: tối đa 14 giây nếu game không phát sự kiện animation
                        if (pendingWinTimeout) clearTimeout(pendingWinTimeout);
                        pendingWinTimeout = setTimeout(() => {
                            flushPendingWin('fallback_timer');
                        }, 14000);
                    } else {
                        pendingWin = 0;
                    }

                    // 3. Chuẩn hóa phản hồi cho BGaming engine:
                    // Engine game tính: e.balance = json.balance.wallet + json.balance.game
                    // Do đó ví wallet = customBalance (đã trừ cược/mua bonus), còn game = roundWin
                    // Khi máy bay cất cánh, game hiển thị số dư ví đã trừ.
                    // Khi máy bay hạ cánh, game sẽ tự cộng lên thành (customBalance + roundWin) hiển thị khớp 100% với Top Bar!
                    json.balance.wallet = Math.round(customBalance * 100);
                    json.balance.game = Math.round(roundWin * 100);

                    return new Response(JSON.stringify(json), {
                        status: response.status,
                        statusText: response.statusText,
                        headers: response.headers
                    });
                }

            } catch (e) {
                console.error('[Aviamasters Helper Error]', e);
                return response;
            }
        }

        return await rawFetch(input, init);
    };

    // 8. Đồng bộ số dư định kỳ từ MongoDB (khi Admin bơm thêm tiền qua /admin hoặc Giftcode)
    async function syncWalletFromAdmin() {
        if (isCommitting || pendingWin > 0) return;
        try {
            const res = await rawFetch(window.location.origin + `/api/state?user=${encodeURIComponent(currentUser)}`);
            const data = await res.json();
            if (typeof data.balance === 'number' && !isNaN(data.balance)) {
                const safeBal = Math.max(0, data.balance);
                if (Math.abs(customBalance - safeBal) > 0.01) {
                    console.log(`%c[Aviamasters Helper] Đồng bộ tiền từ Admin: ${customBalance} => ${safeBal}`, 'color:#38bdf8; font-weight:bold;');
                    customBalance = safeBal;
                    updateLiveDisplay(customBalance);
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
