const express = require('express');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const app = express();
app.use(cors());
app.use(express.static('public'));

// -------------------------------------------------------------
// 1. CẤU HÌNH MONGODB ATLAS & SCHEMAS (LƯU TÀI KHOẢN BỀN VỮNG)
// -------------------------------------------------------------
const MONGO_URI = process.env.MONGO_URI || '';
let isMongoConnected = false;

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, trim: true, lowercase: true },
    password: { type: String, required: true },
    balance: { type: Number, default: 0.00 }, // Mặc định 0.00 VNĐ khi đăng ký mới (người chơi nhận tiền qua Giftcode)
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    isBanned: { type: Boolean, default: false },
    bannedReason: { type: String, default: '' },
    bannedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
    lastLogin: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// Schema mã quà tặng Gift Code
const giftCodeSchema = new mongoose.Schema({
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    reward: { type: Number, required: true }, // Số credit (1.00 credit = 1,000 VNĐ)
    rewardVND: { type: String, default: '' },
    maxUses: { type: Number, default: 100 },
    usedCount: { type: Number, default: 0 },
    usedBy: [{ type: String }], // Danh sách username đã nhập mã
    isActive: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now }
});

const GiftCode = mongoose.model('GiftCode', giftCodeSchema);

// File JSON dự phòng khi chưa cấu hình MONGO_URI hoặc mất mạng
const USERS_FILE = path.join(__dirname, 'users.json');
const STATE_FILE = path.join(__dirname, 'state.json');
const GIFTCODES_FILE = path.join(__dirname, 'giftcodes.json');

// Khởi tạo và đồng bộ MongoDB
async function initMongo() {
    if (!MONGO_URI) {
        console.warn('⚠️ [MongoDB Atlas] Chưa có biến môi trường process.env.MONGO_URI.');
        console.log('ℹ️ [Fallback] Hệ thống tự động kích hoạt lưu trữ bền vững users.json & state.json.');
        console.log('👉 [Hướng dẫn kết nối Atlas]: Thêm biến MONGO_URI="mongodb+srv://<user>:<password>@cluster0.../quayhu"');
        return;
    }

    try {
        console.log('🔄 [MongoDB Atlas] Đang kết nối tới cơ sở dữ liệu MongoDB Atlas...');
        await mongoose.connect(MONGO_URI, {
            serverSelectionTimeoutMS: 5000
        });
        isMongoConnected = true;
        console.log('✅ [MongoDB Atlas] Kết nối cơ sở dữ liệu MongoDB Atlas thành công!');
        await syncLocalToMongo();
        await syncGiftCodesToMongo();
    } catch (err) {
        isMongoConnected = false;
        console.error('❌ [MongoDB Atlas] Kết nối thất bại:', err.message);
        console.log('ℹ️ [Fallback] Tự động chuyển về hệ thống lưu trữ bền vững users.json làm dự phòng.');
    }
}

function loadLocalGiftCodes() {
    try {
        if (!fs.existsSync(GIFTCODES_FILE)) {
            const initial = {
                "TANTHU": {
                    code: "TANTHU",
                    reward: 500.00,
                    rewardVND: "500.000 đ",
                    maxUses: 1000,
                    usedCount: 0,
                    usedBy: [],
                    isActive: true,
                    createdAt: new Date().toISOString()
                }
            };
            fs.writeFileSync(GIFTCODES_FILE, JSON.stringify(initial, null, 2));
            return initial;
        }
        return JSON.parse(fs.readFileSync(GIFTCODES_FILE, 'utf8'));
    } catch (e) {
        return {};
    }
}

function saveLocalGiftCodes(data) {
    try {
        fs.writeFileSync(GIFTCODES_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('[GiftCode Save Error]', e.message);
    }
}

async function syncGiftCodesToMongo() {
    if (!isMongoConnected) return;
    try {
        const localCodes = loadLocalGiftCodes();
        for (const [codeKey, codeData] of Object.entries(localCodes)) {
            const exists = await GiftCode.findOne({ code: codeKey.toUpperCase() });
            if (!exists) {
                await GiftCode.create({
                    code: codeKey.toUpperCase(),
                    reward: codeData.reward,
                    rewardVND: codeData.rewardVND || ((codeData.reward * 1000).toLocaleString('vi-VN') + ' đ'),
                    maxUses: codeData.maxUses || 100,
                    usedCount: codeData.usedCount || 0,
                    usedBy: codeData.usedBy || [],
                    isActive: codeData.isActive !== false,
                    createdAt: codeData.createdAt ? new Date(codeData.createdAt) : new Date()
                });
            }
        }
    } catch (e) {
        console.error('[GiftCode Sync Error]', e.message);
    }
}

// Đồng bộ tài khoản từ users.json vào MongoDB Atlas khi kết nối thành công
async function syncLocalToMongo() {
    if (!isMongoConnected) return;
    try {
        const localData = loadLocalData();
        // Kiểm tra admin
        if (localData.admin) {
            const adminExists = await User.findOne({ username: 'admin' });
            if (!adminExists) {
                await User.create({
                    username: 'admin',
                    password: localData.admin.password || 'admin123',
                    balance: localData.admin.balance || 999999,
                    role: 'admin',
                    createdAt: new Date()
                });
                console.log('✅ [MongoDB Atlas] Đã tạo tài khoản quản trị Admin mặc định.');
            }
        }
        // Kiểm tra users
        if (localData.users) {
            for (const [uName, uData] of Object.entries(localData.users)) {
                const uExists = await User.findOne({ username: uName });
                if (!uExists) {
                    await User.create({
                        username: uName,
                        password: uData.password || '123',
                        balance: typeof uData.balance === 'number' ? uData.balance : 0.00,
                        role: uData.role || 'user',
                        isBanned: Boolean(uData.isBanned),
                        bannedReason: uData.bannedReason || '',
                        createdAt: uData.createdAt ? new Date(uData.createdAt) : new Date(),
                        lastLogin: uData.lastLogin ? new Date(uData.lastLogin) : new Date()
                    });
                    console.log(`✅ [MongoDB Atlas] Đã đồng bộ tài khoản [${uName}] sang MongoDB.`);
                }
            }
        }
    } catch (e) {
        console.error('[MongoDB Sync Error]', e.message);
    }
}

// In-memory cache số dư để phục vụ cực nhanh cho game client
const balanceCache = {};

function loadLocalData() {
    try {
        if (!fs.existsSync(USERS_FILE)) {
            const initial = {
                admin: { username: 'admin', password: 'admin123', role: 'admin', balance: 999999, createdAt: new Date().toISOString() },
                users: {}
            };
            fs.writeFileSync(USERS_FILE, JSON.stringify(initial, null, 2));
            return initial;
        }
        return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    } catch (e) {
        return { admin: { username: 'admin', password: 'admin123', role: 'admin', balance: 999999 }, users: {} };
    }
}

function saveLocalData(data) {
    try {
        fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('[Local DB Error]', e.message);
    }
}

// --- CÁC HÀM TRUY VẤN DỮ LIỆU ĐỒNG BỘ VÀO MONGODB & FALLBACK ---

async function dbFindUser(username) {
    const cleanUser = String(username || '').trim().toLowerCase();
    if (!cleanUser) return null;

    if (isMongoConnected) {
        try {
            const doc = await User.findOne({ username: cleanUser }).lean();
            if (doc) return doc;
        } catch (e) {
            console.error('[MongoDB findOne Error]', e.message);
        }
    }

    // Fallback JSON
    const data = loadLocalData();
    if (data.admin && data.admin.username === cleanUser) return data.admin;
    if (data.users && data.users[cleanUser]) return data.users[cleanUser];
    return null;
}

async function dbGetUserBalance(username) {
    const cleanUser = String(username || '').trim().toLowerCase();
    if (balanceCache[cleanUser] !== undefined) {
        return balanceCache[cleanUser];
    }
    const user = await dbFindUser(cleanUser);
    const bal = (user && typeof user.balance === 'number') ? user.balance : 0;
    balanceCache[cleanUser] = bal;
    return bal;
}

// Cung cấp hàm đồng bộ để các filter proxy game gọi ngay lập tức
function getCachedUserBalance(username) {
    const cleanUser = String(username || '').trim().toLowerCase();
    if (balanceCache[cleanUser] !== undefined) {
        return balanceCache[cleanUser];
    }
    const data = loadLocalData();
    if (data.admin && data.admin.username === cleanUser) return data.admin.balance;
    if (data.users && data.users[cleanUser]) return data.users[cleanUser].balance;
    return 0;
}

async function dbSetUserBalance(username, balance) {
    const cleanUser = String(username || '').trim().toLowerCase();
    let cleanVal = Number(balance);
    if (isNaN(cleanVal) || cleanVal < 0) cleanVal = 0;
    // Chuẩn hóa: nếu số tiền nhập dạng hàng trăm nghìn VNĐ (>= 100,000), quy đổi về đơn vị 1 unit = 1k
    if (cleanVal >= 100000) cleanVal = cleanVal / 1000;
    cleanVal = Number(cleanVal.toFixed(2));

    balanceCache[cleanUser] = cleanVal;

    // Cập nhật MongoDB nếu đang kết nối
    if (isMongoConnected) {
        try {
            await User.findOneAndUpdate({ username: cleanUser }, { balance: cleanVal });
        } catch (e) {
            console.error('[MongoDB updateBalance Error]', e.message);
        }
    }

    // Luôn ghi dự phòng vào users.json & state.json
    const data = loadLocalData();
    if (data.admin && data.admin.username === cleanUser) {
        data.admin.balance = cleanVal;
    } else if (data.users && data.users[cleanUser]) {
        data.users[cleanUser].balance = cleanVal;
    } else {
        if (!data.users) data.users = {};
        data.users[cleanUser] = { username: cleanUser, balance: cleanVal, role: 'user' };
    }
    saveLocalData(data);

    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify({ balance: cleanVal }, null, 2));
    } catch(e) {}

    return cleanVal;
}

async function dbCreateUser(username, password, balance = 500.00, role = 'user') {
    const cleanUser = String(username || '').trim().toLowerCase();
    let cleanBal = Number(balance);
    if (isNaN(cleanBal) || cleanBal < 0) cleanBal = 500.00;
    if (cleanBal >= 100000) cleanBal = cleanBal / 1000;
    cleanBal = Number(cleanBal.toFixed(2));

    let createdUser = null;

    if (isMongoConnected) {
        try {
            const doc = await User.create({
                username: cleanUser,
                password: password,
                balance: cleanBal,
                role: role,
                isBanned: false,
                bannedReason: '',
                createdAt: new Date(),
                lastLogin: new Date()
            });
            createdUser = doc.toObject();
        } catch (e) {
            console.error('[MongoDB CreateUser Error]', e.message);
        }
    }

    // Fallback JSON
    const data = loadLocalData();
    const newUser = {
        username: cleanUser,
        password: password,
        balance: cleanBal,
        role: role,
        isBanned: false,
        bannedReason: '',
        createdAt: new Date().toISOString(),
        lastLogin: new Date().toISOString()
    };
    if (!data.users) data.users = {};
    data.users[cleanUser] = newUser;
    saveLocalData(data);

    balanceCache[cleanUser] = cleanBal;
    return createdUser || newUser;
}

async function dbGetAllUsers() {
    if (isMongoConnected) {
        try {
            const docs = await User.find({ role: 'user' }).sort({ createdAt: -1 }).lean();
            return docs.map(d => ({
                username: d.username,
                balance: d.balance,
                role: d.role,
                isBanned: Boolean(d.isBanned),
                bannedReason: d.bannedReason || '',
                bannedAt: d.bannedAt,
                createdAt: d.createdAt,
                lastLogin: d.lastLogin
            }));
        } catch (e) {
            console.error('[MongoDB GetAllUsers Error]', e.message);
        }
    }

    const data = loadLocalData();
    return Object.values(data.users || {}).map(u => ({
        username: u.username,
        balance: u.balance,
        role: u.role,
        isBanned: Boolean(u.isBanned),
        bannedReason: u.bannedReason || '',
        bannedAt: u.bannedAt,
        createdAt: u.createdAt,
        lastLogin: u.lastLogin
    }));
}

// Khóa hoặc mở khóa tài khoản
async function dbSetUserBan(username, isBanned, reason = '') {
    const cleanUser = String(username || '').trim().toLowerCase();
    if (!cleanUser || cleanUser === 'admin') return false;

    const banBool = Boolean(isBanned);
    const bannedAtDate = banBool ? new Date() : null;

    if (isMongoConnected) {
        try {
            await User.findOneAndUpdate(
                { username: cleanUser },
                { isBanned: banBool, bannedReason: reason || '', bannedAt: bannedAtDate }
            );
        } catch (e) {
            console.error('[MongoDB SetUserBan Error]', e.message);
        }
    }

    const data = loadLocalData();
    if (data.users && data.users[cleanUser]) {
        data.users[cleanUser].isBanned = banBool;
        data.users[cleanUser].bannedReason = reason || '';
        if (banBool) data.users[cleanUser].bannedAt = new Date().toISOString();
        else delete data.users[cleanUser].bannedAt;
        saveLocalData(data);
    }

    // Nếu khóa tài khoản: lập tức hủy bỏ toàn bộ phiên đăng nhập đang hoạt động
    if (banBool) {
        for (const [tok, s] of Object.entries(sessions)) {
            if (s && s.username === cleanUser) {
                delete sessions[tok];
            }
        }
    }

    return true;
}

// Lấy danh sách bảng xếp hạng top người chơi có số dư cao nhất
async function dbGetLeaderboard(limit = 20) {
    let users = [];
    if (isMongoConnected) {
        try {
            users = await User.find({ role: 'user', isBanned: { $ne: true } })
                .sort({ balance: -1 })
                .limit(limit)
                .lean();
        } catch (e) {
            console.error('[MongoDB GetLeaderboard Error]', e.message);
        }
    }

    if (!users || users.length === 0) {
        const data = loadLocalData();
        users = Object.values(data.users || {})
            .filter(u => u.role === 'user' && !u.isBanned)
            .sort((a, b) => (b.balance || 0) - (a.balance || 0))
            .slice(0, limit);
    }

    return users.map((u, index) => ({
        rank: index + 1,
        username: u.username,
        balance: Number((u.balance || 0).toFixed(2)),
        balanceVND: (Math.max(0, u.balance || 0) * 1000).toLocaleString('vi-VN') + ' đ'
    }));
}

// --- CÁC HÀM XỬ LÝ GIFT CODE (MÃ QUÀ TẶNG DO ADMIN BAN HÀNH) ---

async function dbGetAllGiftCodes() {
    if (isMongoConnected) {
        try {
            const docs = await GiftCode.find().sort({ createdAt: -1 }).lean();
            if (docs && docs.length > 0) {
                return docs.map(d => ({
                    code: d.code,
                    reward: d.reward,
                    rewardVND: d.rewardVND || ((d.reward * 1000).toLocaleString('vi-VN') + ' đ'),
                    maxUses: d.maxUses || 100,
                    usedCount: d.usedCount || 0,
                    usedBy: d.usedBy || [],
                    isActive: d.isActive !== false,
                    createdAt: d.createdAt
                }));
            }
        } catch (e) {
            console.error('[MongoDB GetAllGiftCodes Error]', e.message);
        }
    }

    const localCodes = loadLocalGiftCodes();
    return Object.values(localCodes).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function dbCreateGiftCode(code, amount, maxUses = 100) {
    const cleanCode = String(code || '').trim().toUpperCase();
    if (!cleanCode || cleanCode.length < 3) {
        return { ok: false, msg: 'Mã Giftcode tối thiểu 3 ký tự!' };
    }

    let parsedAmount = Number(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
        return { ok: false, msg: 'Số tiền thưởng không hợp lệ!' };
    }

    // Quy đổi: 500,000 VNĐ = 500.00 credit. Nếu nhập >= 10,000 thì chia 1000
    let rewardCredits = parsedAmount >= 10000 ? (parsedAmount / 1000) : parsedAmount;
    rewardCredits = Number(rewardCredits.toFixed(2));
    const rewardVND = (rewardCredits * 1000).toLocaleString('vi-VN') + ' đ';
    const uses = Math.max(1, parseInt(maxUses) || 100);

    // Kiểm tra trùng mã
    if (isMongoConnected) {
        try {
            const exists = await GiftCode.findOne({ code: cleanCode });
            if (exists) {
                return { ok: false, msg: `Mã Giftcode [${cleanCode}] đã tồn tại!` };
            }
            await GiftCode.create({
                code: cleanCode,
                reward: rewardCredits,
                rewardVND: rewardVND,
                maxUses: uses,
                usedCount: 0,
                usedBy: [],
                isActive: true,
                createdAt: new Date()
            });
        } catch (e) {
            console.error('[MongoDB CreateGiftCode Error]', e.message);
        }
    }

    // Lưu vào JSON fallback
    const local = loadLocalGiftCodes();
    if (local[cleanCode]) {
        return { ok: false, msg: `Mã Giftcode [${cleanCode}] đã tồn tại!` };
    }
    local[cleanCode] = {
        code: cleanCode,
        reward: rewardCredits,
        rewardVND: rewardVND,
        maxUses: uses,
        usedCount: 0,
        usedBy: [],
        isActive: true,
        createdAt: new Date().toISOString()
    };
    saveLocalGiftCodes(local);

    console.log(`[GiftCode Created] Admin tạo mã [${cleanCode}] | Thưởng: ${rewardVND} (${rewardCredits} credits) | Tối đa: ${uses} lượt`);
    return { ok: true, giftCode: local[cleanCode] };
}

async function dbDeleteGiftCode(code) {
    const cleanCode = String(code || '').trim().toUpperCase();
    if (!cleanCode) return false;

    if (isMongoConnected) {
        try {
            await GiftCode.findOneAndDelete({ code: cleanCode });
        } catch (e) {
            console.error('[MongoDB DeleteGiftCode Error]', e.message);
        }
    }

    const local = loadLocalGiftCodes();
    if (local[cleanCode]) {
        delete local[cleanCode];
        saveLocalGiftCodes(local);
    }
    console.log(`[GiftCode Deleted] Đã xóa mã Giftcode [${cleanCode}]`);
    return true;
}

async function dbRedeemGiftCode(codeStr, username) {
    const cleanCode = String(codeStr || '').trim().toUpperCase();
    const cleanUser = String(username || '').trim().toLowerCase();

    if (!cleanUser) {
        return { ok: false, msg: 'Vui lòng đăng nhập tài khoản để nhận Giftcode!' };
    }
    if (!cleanCode) {
        return { ok: false, msg: 'Vui lòng nhập mã Giftcode!' };
    }

    const user = await dbFindUser(cleanUser);
    if (!user) {
        return { ok: false, msg: 'Không tìm thấy tài khoản người chơi!' };
    }
    if (user.isBanned) {
        return { ok: false, msg: '🚫 Tài khoản của bạn đã bị khóa bởi Quản trị viên!' };
    }

    let codeDoc = null;
    if (isMongoConnected) {
        try {
            codeDoc = await GiftCode.findOne({ code: cleanCode });
        } catch (e) {
            console.error('[MongoDB FindGiftCode Error]', e.message);
        }
    }

    if (!codeDoc) {
        const local = loadLocalGiftCodes();
        codeDoc = local[cleanCode];
    }

    if (!codeDoc || codeDoc.isActive === false) {
        return { ok: false, msg: '❌ Mã Giftcode không tồn tại hoặc đã hết hạn!' };
    }

    if (codeDoc.maxUses && codeDoc.usedCount >= codeDoc.maxUses) {
        return { ok: false, msg: '❌ Mã Giftcode này đã hết lượt sử dụng!' };
    }

    const usedByList = codeDoc.usedBy || [];
    if (usedByList.includes(cleanUser)) {
        return { ok: false, msg: '⚠️ Bạn đã từng nhập mã Giftcode này rồi! Mỗi tài khoản chỉ được nhập 1 lần.' };
    }

    // Cộng thưởng vào tài khoản
    const reward = Number(codeDoc.reward) || 0;
    const rewardVND = codeDoc.rewardVND || ((reward * 1000).toLocaleString('vi-VN') + ' đ');
    const curBalance = await dbGetUserBalance(cleanUser);
    const newBalance = Number((curBalance + reward).toFixed(2));
    await dbSetUserBalance(cleanUser, newBalance);

    // Cập nhật lượt dùng
    if (isMongoConnected) {
        try {
            await GiftCode.findOneAndUpdate(
                { code: cleanCode },
                {
                    $inc: { usedCount: 1 },
                    $push: { usedBy: cleanUser }
                }
            );
        } catch (e) {
            console.error('[MongoDB UpdateGiftCode Error]', e.message);
        }
    }

    const local = loadLocalGiftCodes();
    if (local[cleanCode]) {
        if (!local[cleanCode].usedBy) local[cleanCode].usedBy = [];
        local[cleanCode].usedBy.push(cleanUser);
        local[cleanCode].usedCount = (local[cleanCode].usedCount || 0) + 1;
        saveLocalGiftCodes(local);
    }

    console.log(`[GiftCode Redeemed] Người chơi [${cleanUser}] nhập [${cleanCode}] thành công | +${rewardVND} | Số dư mới: ${newBalance}`);
    return {
        ok: true,
        code: cleanCode,
        reward,
        rewardVND,
        newBalance,
        newBalanceVND: (newBalance * 1000).toLocaleString('vi-VN') + ' đ',
        msg: `🎉 Nhập mã [${cleanCode}] thành công! Bạn nhận được +${rewardVND} vào ví!`
    };
}

// Khởi chạy kết nối MongoDB
initMongo();

// In-memory sessions token map: token => { username, role }
const sessions = {};

function createSession(user) {
    const token = 'tok_' + user.username + '_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    sessions[token] = {
        username: user.username,
        role: user.role,
        createdAt: Date.now()
    };
    return token;
}

function getSessionUser(req) {
    const authHeader = req.headers['authorization'];
    let token = '';
    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
    } else if (req.query && req.query.token) {
        token = req.query.token;
    }

    if (token && sessions[token]) {
        return sessions[token];
    }
    return null;
}

// -------------------------------------------------------------
// 2. API XÁC THỰC MONGODB (REGISTER, LOGIN, ME, LOGOUT)
// -------------------------------------------------------------
app.post('/api/auth/register', express.json(), async (req, res) => {
    try {
        const { username, password } = req.body || {};
        if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
            return res.status(400).json({ ok: false, msg: 'Vui lòng nhập tài khoản và mật khẩu hợp lệ!' });
        }
        const cleanUser = username.trim().toLowerCase();
        if (cleanUser.length < 3) {
            return res.status(400).json({ ok: false, msg: 'Tên tài khoản tối thiểu 3 ký tự!' });
        }
        if (password.length < 3) {
            return res.status(400).json({ ok: false, msg: 'Mật khẩu tối thiểu 3 ký tự!' });
        }

        const existing = await dbFindUser(cleanUser);
        if (existing) {
            return res.status(400).json({ ok: false, msg: 'Tên tài khoản đã tồn tại trên hệ thống!' });
        }

        // Số dư ban đầu 0.00 VNĐ - Người chơi nhập Giftcode từ Admin để nhận thưởng
        const newUser = await dbCreateUser(cleanUser, password, 0.00, 'user');
        const token = createSession(newUser);

        console.log(`[Auth Register] Đăng ký thành công tài khoản [${cleanUser}] | Số dư ban đầu: 0 VNĐ (Nhận thưởng qua Giftcode)`);
        res.json({
            ok: true,
            token,
            user: { username: cleanUser, balance: 0.00, role: 'user' }
        });
    } catch (err) {
        console.error('[Register Error]', err.message);
        res.status(500).json({ ok: false, msg: 'Lỗi đăng ký tài khoản: ' + err.message });
    }
});

app.post('/api/auth/login', express.json(), async (req, res) => {
    try {
        const { username, password } = req.body || {};
        if (!username || !password) {
            return res.status(400).json({ ok: false, msg: 'Vui lòng nhập tài khoản và mật khẩu!' });
        }
        const cleanUser = username.trim().toLowerCase();
        const user = await dbFindUser(cleanUser);

        if (!user || user.password !== password) {
            return res.status(401).json({ ok: false, msg: 'Tài khoản hoặc mật khẩu không chính xác!' });
        }

        // KIỂM TRA TÀI KHOẢN CÓ BỊ KHÓA HAY KHÔNG
        if (user.isBanned) {
            console.warn(`[Auth Login] Chặn đăng nhập tài khoản bị khóa: [${cleanUser}]`);
            return res.status(403).json({
                ok: false,
                isBanned: true,
                msg: '🚫 Tài khoản của bạn đã bị khóa bởi Quản trị viên (Admin). Vui lòng liên hệ Admin để được hỗ trợ!'
            });
        }

        // Cập nhật lastLogin
        if (isMongoConnected) {
            await User.findOneAndUpdate({ username: cleanUser }, { lastLogin: new Date() }).catch(() => {});
        }

        const token = createSession(user);
        console.log(`[Auth Login] Đăng nhập thành công: [${cleanUser}] (Role: ${user.role})`);
        res.json({
            ok: true,
            token,
            user: { username: user.username, balance: user.balance, role: user.role }
        });
    } catch (err) {
        console.error('[Login Error]', err.message);
        res.status(500).json({ ok: false, msg: 'Lỗi đăng nhập: ' + err.message });
    }
});

app.get('/api/auth/me', async (req, res) => {
    const session = getSessionUser(req);
    if (!session) {
        return res.status(401).json({ ok: false, msg: 'Chưa đăng nhập!' });
    }
    const user = await dbFindUser(session.username);
    if (!user) {
        return res.status(404).json({ ok: false, msg: 'Không tìm thấy tài khoản!' });
    }
    if (user.isBanned) {
        return res.status(403).json({
            ok: false,
            isBanned: true,
            msg: '🚫 Tài khoản này đã bị khóa bởi Quản trị viên!'
        });
    }
    res.json({
        ok: true,
        user: { username: user.username, balance: user.balance, role: user.role }
    });
});

app.post('/api/auth/logout', (req, res) => {
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        delete sessions[token];
    }
    res.json({ ok: true });
});

// -------------------------------------------------------------
// 3. API SỐ DƯ & TRẠNG THÁI LIÊN KẾT MONGODB (STATE & BALANCE)
// -------------------------------------------------------------
app.get('/api/state', async (req, res) => {
    const session = getSessionUser(req);
    const username = req.query.user || (session ? session.username : 'demo1');
    const uDoc = await dbFindUser(username);
    if (uDoc && uDoc.isBanned) {
        return res.status(403).json({ ok: false, isBanned: true, msg: 'Tài khoản của bạn đã bị khóa!' });
    }
    const bal = await dbGetUserBalance(username);
    res.json({ ok: true, username, balance: bal, balanceVND: (bal * 1000).toLocaleString('vi-VN') + ' đ' });
});

app.post('/api/state', express.json(), async (req, res) => {
    const session = getSessionUser(req);
    const username = req.body.username || (session ? session.username : 'demo1');
    const uDoc = await dbFindUser(username);
    if (uDoc && uDoc.isBanned) {
        return res.status(403).json({ ok: false, isBanned: true, msg: 'Tài khoản của bạn đã bị khóa!' });
    }
    let { balance, add, delta } = req.body || {};

    let current = await dbGetUserBalance(username);

    if (typeof balance === 'number') {
        current = balance;
    } else if (typeof add === 'number') {
        current += add;
    } else if (typeof delta === 'number') {
        current += delta;
    }

    current = Math.max(0, Number(Number(current).toFixed(2)));
    await dbSetUserBalance(username, current);
    res.json({ ok: true, username, balance: current, balanceVND: (current * 1000).toLocaleString('vi-VN') + ' đ' });
});

app.get('/api/user/balance', async (req, res) => {
    const session = getSessionUser(req);
    const username = req.query.user || (session ? session.username : 'demo1');
    const bal = await dbGetUserBalance(username);
    res.json({ username, balance: bal });
});

app.post('/api/user/balance', express.json(), async (req, res) => {
    const session = getSessionUser(req);
    const username = req.body.username || (session ? session.username : 'demo1');
    let { balance, delta } = req.body || {};

    let current = await dbGetUserBalance(username);
    if (typeof balance === 'number') {
        current = balance;
    } else if (typeof delta === 'number') {
        current += delta;
    }

    current = Math.max(0, Number(Number(current).toFixed(2)));
    await dbSetUserBalance(username, current);
    res.json({ ok: true, username, balance: current });
});

// -------------------------------------------------------------
// 4. API QUẢN TRỊ ADMIN (DANH SÁCH & ĐIỀU CHỈNH SỐ DƯ MONGODB)
// -------------------------------------------------------------
app.get('/api/admin/users', async (req, res) => {
    const session = getSessionUser(req);
    if (!session || session.role !== 'admin') {
        return res.status(403).json({ ok: false, msg: 'Chỉ Admin mới có quyền truy cập!' });
    }
    const list = await dbGetAllUsers();
    res.json({ ok: true, users: list });
});

app.post('/api/admin/user/balance', express.json(), async (req, res) => {
    const session = getSessionUser(req);
    if (!session || session.role !== 'admin') {
        return res.status(403).json({ ok: false, msg: 'Chỉ Admin mới có quyền truy cập!' });
    }

    let { targetUsername, balance, add } = req.body || {};
    if (!targetUsername) {
        return res.status(400).json({ ok: false, msg: 'Thiếu tên tài khoản cần chỉnh!' });
    }
    targetUsername = targetUsername.trim().toLowerCase();

    let cur = await dbGetUserBalance(targetUsername);
    if (typeof balance === 'number') {
        if (balance >= 100000) balance = balance / 1000;
        cur = balance;
    }
    if (typeof add === 'number') {
        if (add >= 100000) add = add / 1000;
        cur += add;
    }

    cur = Math.max(0, Number(Number(cur).toFixed(2)));
    await dbSetUserBalance(targetUsername, cur);
    console.log(`[Admin Update] Đã chỉnh số dư của [${targetUsername}] => ${cur} (${(cur * 1000).toLocaleString('vi-VN')} VNĐ)`);
    res.json({ ok: true, username: targetUsername, balance: cur });
});

// API Khóa / Mở khóa tài khoản người chơi (Ban / Unban Account)
app.post('/api/admin/user/ban', express.json(), async (req, res) => {
    const session = getSessionUser(req);
    if (!session || session.role !== 'admin') {
        return res.status(403).json({ ok: false, msg: 'Chỉ Admin mới có quyền thực hiện thao tác này!' });
    }

    let { targetUsername, isBanned, reason } = req.body || {};
    if (!targetUsername) {
        return res.status(400).json({ ok: false, msg: 'Thiếu tên tài khoản cần xử lý!' });
    }
    targetUsername = targetUsername.trim().toLowerCase();
    if (targetUsername === 'admin') {
        return res.status(400).json({ ok: false, msg: 'Không thể khóa tài khoản Admin tối cao!' });
    }

    const success = await dbSetUserBan(targetUsername, isBanned, reason);
    if (!success) {
        return res.status(404).json({ ok: false, msg: 'Không tìm thấy tài khoản để xử lý!' });
    }

    console.log(`[Admin Ban] ${isBanned ? '🔒 ĐÃ KHÓA' : '🔓 ĐÃ MỞ KHÓA'} tài khoản [${targetUsername}] | Lý do: ${reason || 'Không có'}`);
    res.json({ ok: true, username: targetUsername, isBanned: Boolean(isBanned) });
});

// API Bảng Xếp Hạng người chơi có nhiều tiền nhất (Leaderboard)
app.get('/api/leaderboard', async (req, res) => {
    try {
        const topUsers = await dbGetLeaderboard(20);
        const session = getSessionUser(req);
        let currentUserRank = null;

        if (session && session.username) {
            const u = await dbFindUser(session.username);
            if (u) {
                const all = await dbGetLeaderboard(100);
                const foundIdx = all.findIndex(x => x.username === session.username);
                currentUserRank = {
                    username: session.username,
                    balance: u.balance,
                    balanceVND: (Math.max(0, u.balance) * 1000).toLocaleString('vi-VN') + ' đ',
                    rank: foundIdx !== -1 ? (foundIdx + 1) : '>100'
                };
            }
        }

        res.json({ ok: true, topUsers, currentUserRank });
    } catch (err) {
        console.error('[Leaderboard Error]', err.message);
        res.status(500).json({ ok: false, msg: 'Lỗi tải bảng xếp hạng: ' + err.message });
    }
});

// -------------------------------------------------------------
// 4.5. API GIFT CODE (MÃ QUÀ TẶNG DO ADMIN BAN HÀNH & USER NHẬP)
// -------------------------------------------------------------

// API Người chơi nhập Giftcode nhận thưởng vào ví
app.post('/api/giftcode/redeem', express.json(), async (req, res) => {
    try {
        const session = getSessionUser(req);
        let { code, username } = req.body || {};
        const targetUser = (session && session.username) || username;
        if (!targetUser) {
            return res.status(401).json({ ok: false, msg: 'Vui lòng đăng nhập tài khoản trước khi nhập Giftcode!' });
        }

        const result = await dbRedeemGiftCode(code, targetUser);
        if (!result.ok) {
            return res.status(400).json(result);
        }
        res.json(result);
    } catch (err) {
        console.error('[Redeem Error]', err.message);
        res.status(500).json({ ok: false, msg: 'Lỗi xử lý Giftcode: ' + err.message });
    }
});

// API Lấy danh sách toàn bộ Gift Code (Dành riêng cho Admin)
app.get('/api/admin/giftcodes', async (req, res) => {
    const session = getSessionUser(req);
    if (!session || session.role !== 'admin') {
        return res.status(403).json({ ok: false, msg: 'Chỉ Admin mới có quyền truy cập danh sách Giftcode!' });
    }
    const list = await dbGetAllGiftCodes();
    res.json({ ok: true, giftCodes: list });
});

// API Admin tạo mã Giftcode mới
app.post('/api/admin/giftcode/create', express.json(), async (req, res) => {
    const session = getSessionUser(req);
    if (!session || session.role !== 'admin') {
        return res.status(403).json({ ok: false, msg: 'Chỉ Admin mới có quyền tạo Giftcode!' });
    }
    const { code, amount, maxUses } = req.body || {};
    const result = await dbCreateGiftCode(code, amount, maxUses);
    if (!result.ok) {
        return res.status(400).json(result);
    }
    res.json(result);
});

// API Admin xóa mã Giftcode
app.post('/api/admin/giftcode/delete', express.json(), async (req, res) => {
    const session = getSessionUser(req);
    if (!session || session.role !== 'admin') {
        return res.status(403).json({ ok: false, msg: 'Chỉ Admin mới có quyền xóa Giftcode!' });
    }
    const { code } = req.body || {};
    await dbDeleteGiftCode(code);
    res.json({ ok: true, msg: `Đã xóa mã Giftcode [${code}] thành công!` });
});

app.post('/api/log', express.json(), (req, res) => {
    const { tag, data } = req.body || {};
    console.log(`[CLIENT-LOG] [${tag}]`, typeof data === 'object' ? JSON.stringify(data) : data);
    res.json({ ok: true });
});

// -------------------------------------------------------------
// 5. PHỤC VỤ TRANG GIAO DIỆN CHÍNH (PORTAL / LOBBY) & ADMIN
// -------------------------------------------------------------
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// -------------------------------------------------------------
// 6. TÍCH HỢP 2 TRÒ CHƠI MỚI VÀO SẢNH & LIÊN KẾT SỐ DƯ
// -------------------------------------------------------------

// -------------------------------------------------------------
// 6. TÍCH HỢP 2 TRÒ CHƠI MỚI VÀO SẢNH & LIÊN KẾT SỐ DƯ 100%
// -------------------------------------------------------------

// Proxy endpoint cho bộ điều phối Socket Balancer của Falling Pickaxe
app.get('/api/balancer/nodes/get_config', async (req, res) => {
    try {
        const targetUrl = 'https://geo-demo.pixmove-geo.vip/api/balancer/nodes/get_config?token=KrihrfWXpba7VWVD63aBPHhb8&host=geo-demo.pixmove-geo.vip&lang=en';
        const r = await axios.get(targetUrl, {
            headers: { 'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0' },
            timeout: 8000
        });
        res.json(r.data);
    } catch (e) {
        // Fallback cấu hình socket node chính của Pixmove
        res.json({
            status: 'success',
            data: {
                host: 'games-sgp-1.pixmove.co/transport',
                port: 443,
                type: 'io',
                prefix: 'pix-server',
                protocol: 'wss',
                isReconnect: true,
                reconnectTime: 1000,
                requestTimeout: 15000
            },
            serverTime: Date.now(),
            duration: 100
        });
    }
});

// Proxy toàn bộ tài nguyên (JS, CSS, Font, Image) của Falling Pickaxe để bypass triệt để lỗi CORS Font
app.use('/falling_pickaxe', async (req, res) => {
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        return res.status(200).end();
    }

    // Nếu đã có file patch tối ưu hóa cục bộ (ví dụ: bundle.f6e25587e7eb6b9b.js)
    const localFilePath = path.join(__dirname, 'public', 'falling_pickaxe', req.path);
    if (fs.existsSync(localFilePath) && fs.statSync(localFilePath).isFile()) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        if (req.path.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        else if (req.path.endsWith('.css')) res.setHeader('Content-Type', 'text/css');
        return res.sendFile(localFilePath);
    }

    try {
        const targetUrl = 'https://geo-demo.pixmove-geo.vip/falling_pickaxe' + req.url;
        const forwardHeaders = {};
        for (const [k, v] of Object.entries(req.headers)) {
            const lower = k.toLowerCase();
            if (!['host', 'connection'].includes(lower)) {
                forwardHeaders[k] = v;
            }
        }
        forwardHeaders['referer'] = 'https://geo-demo.pixmove-geo.vip/falling_pickaxe/';
        forwardHeaders['origin'] = 'https://geo-demo.pixmove-geo.vip';

        const resp = await axios({
            method: req.method,
            url: targetUrl,
            responseType: 'arraybuffer',
            headers: forwardHeaders,
            validateStatus: () => true,
            timeout: 15000
        });

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        if (resp.headers['content-type']) {
            res.setHeader('Content-Type', resp.headers['content-type']);
        }
        res.status(resp.status).send(resp.data);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

function renderBannedPage(username) {
    return `
    <!DOCTYPE html>
    <html lang="vi">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Tài Khoản Đã Bị Khóa</title>
        <style>
            body { background: #0a0e1a; color: #fff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
            .ban-card { background: #131f38; border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 20px; padding: 40px 28px; max-width: 420px; width: 100%; text-align: center; box-shadow: 0 20px 60px rgba(0,0,0,0.8); }
            .ban-icon { font-size: 56px; margin-bottom: 12px; }
            h2 { color: #ef4444; font-size: 22px; font-weight: 800; margin-bottom: 10px; }
            p { color: #cbd5e1; font-size: 14px; line-height: 1.6; margin-bottom: 24px; }
            a { background: linear-gradient(180deg, #f59e0b, #d97706); color: #000; font-weight: 800; padding: 12px 28px; border-radius: 10px; text-decoration: none; display: inline-block; font-size: 14px; }
        </style>
    </head>
    <body>
        <div class="ban-card">
            <div class="ban-icon">🚫</div>
            <h2>TÀI KHOẢN ĐÃ BỊ KHÓA</h2>
            <p>Tài khoản <strong>${username}</strong> đã bị Quản Trị Viên (Admin) tạm khóa do vi phạm chính sách hoặc yêu cầu bảo mật.<br>Vui lòng liên hệ Admin để được hỗ trợ mở khóa!</p>
            <a href="/">⬅ Quay Lại Sảnh Chờ</a>
        </div>
    </body>
    </html>
    `;
}

// ROUTE 1: Game Falling Pickaxe (Arcade / Đào Kho Báu - Đồng bộ 100% ví)
app.get('/game/falling-pickaxe', async (req, res) => {
    try {
        // Tự động bảo vệ demo token của Pixmove để tránh lỗi InvalidToken
        if (!req.query.token || req.query.token.startsWith('tok_')) {
            const q = new URLSearchParams(req.query);
            if (q.get('token') && q.get('token').startsWith('tok_')) {
                q.set('authToken', q.get('token'));
            }
            q.set('token', 'KrihrfWXpba7VWVD63aBPHhb8');
            if (!q.has('lang')) q.set('lang', 'en');
            return res.redirect(`/game/falling-pickaxe?${q.toString()}`);
        }

        const session = getSessionUser(req);
        const username = req.query.user || (session ? session.username : 'demo1');
        
        // Kiểm tra tài khoản bị khóa
        const userDoc = await dbFindUser(username);
        if (userDoc && userDoc.isBanned) {
            return res.status(403).send(renderBannedPage(username));
        }

        const balance = await dbGetUserBalance(username);

        console.log(`[Falling Pickaxe] Khởi động game cho [${username}] | Số dư ví: ${balance}`);

        const targetUrl = 'https://geo-demo.pixmove-geo.vip/falling_pickaxe/?token=KrihrfWXpba7VWVD63aBPHhb8&lang=en';
        const response = await axios.get(targetUrl, {
            headers: { 'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            timeout: 10000
        });
        let html = response.data;

        // Tiêm script đồng bộ ví và base href nội bộ same-origin (loại bỏ hoàn toàn lỗi CORS font)
        const injectTags = `
        <script>
        window.__GAME_USER__ = { username: "${username}", balance: ${balance} };
        </script>
        <script src="/pickaxe-helper.js"></script>
        <base href="/falling_pickaxe/">
        `;
        html = html.replace('<head>', '<head>' + injectTags);

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch (err) {
        console.error('[Falling Pickaxe Error]', err.message);
        res.status(500).send('Lỗi tải Falling Pickaxe: ' + err.message);
    }
});

// ROUTE 2: Game Aviamasters 2 (Bay Lượn / Crash - Đồng bộ 100% ví)
app.get('/game/aviamasters2', async (req, res) => {
    try {
        const session = getSessionUser(req);
        const username = req.query.user || (session ? session.username : 'demo1');

        // Kiểm tra tài khoản bị khóa
        const userDoc = await dbFindUser(username);
        if (userDoc && userDoc.isBanned) {
            return res.status(403).send(renderBannedPage(username));
        }

        const balance = await dbGetUserBalance(username);

        // Lấy link khởi chạy hợp lệ không bị hết hạn token từ BGaming
        const playUrl = 'https://demo.bgaming-network.com/play/Aviamasters2/FUN?server=demo';
        const launchResp = await axios.get(playUrl, {
            headers: { 'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            maxRedirects: 5,
            timeout: 10000,
            validateStatus: () => true
        });

        let targetUrl = launchResp.request && launchResp.request.res && launchResp.request.res.responseUrl
            ? launchResp.request.res.responseUrl
            : 'https://demo.bgaming-network.com/games/Aviamasters2/FUN';

        console.log(`[Aviamasters 2] Khởi động game cho [${username}] | Số dư ví: ${balance}`);

        // Tải mã HTML gốc của Aviamasters 2
        let html = '';
        if (typeof launchResp.data === 'string' && launchResp.data.includes('Aviamasters')) {
            html = launchResp.data;
        } else {
            const gamePageResp = await axios.get(targetUrl, {
                headers: { 'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0' },
                timeout: 10000
            });
            html = gamePageResp.data;
        }

        // Tiêm script đồng bộ ví avia-helper.js trước các script của game
        const injectTags = `
        <script>
        window.__GAME_USER__ = { username: "${username}", balance: ${balance} };
        </script>
        <script src="/avia-helper.js?v=${Date.now()}"></script>
        <base href="https://demo.bgaming-network.com/games/Aviamasters2/">
        `;
        html = html.replace('<head>', '<head>' + injectTags);

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch (err) {
        console.error('[Aviamasters 2 Error]', err.message);
        res.status(500).send('Lỗi tải Aviamasters 2: ' + err.message);
    }
});

// -------------------------------------------------------------
// 7. ROUTE GAME VÒNG QUAY MAY MẮN PG SOFT (SLOT 135)
// -------------------------------------------------------------
const GAME_QUERY = '?ot=ca7094186b309ee149c55c8822e7ecf2&l=vi&btt=2&ao=22wle%3Db26tvvy7y%3Dyki&or=11deletn%3Dar-opxz%3Dnzx&__hv=2fMEUCIQDF0iJq%2BNIQQsoh5fQlEkTmrEv4vgZV4bYuMaUcrzI0PwIgMDpsistP9y0FOI7VYtjdVPc17nZdpgfPM4LtReWZ9Es%3D&__sv=010501HSlD3JHtvMhHjGea7u3RdvQg6W6L5QG99dNPORhxcGY';

app.get('/135/index.html', async (req, res) => {
    try {
        const targetUser = req.query.user ? req.query.user.trim().toLowerCase() : 'demo1';
        const token = req.query.token || '';

        // Tự động gắn đầy đủ query PG Soft nếu thiếu
        if (!req.originalUrl.includes('ot=')) {
            return res.redirect(`/135/index.html${GAME_QUERY}&user=${encodeURIComponent(targetUser)}&token=${encodeURIComponent(token)}`);
        }

        // Kiểm tra tài khoản bị khóa
        const userDoc = await dbFindUser(targetUser);
        if (userDoc && userDoc.isBanned) {
            return res.status(403).send(renderBannedPage(targetUser));
        }

        const userBal = await dbGetUserBalance(targetUser);
        console.log(`[Vòng Quay 135] Khởi động game cho [${targetUser}] | Số dư: ${userBal}`);

        const targetUrl = 'https://m.pg-demo.com/135/index.html' + GAME_QUERY;
        const response = await axios.get(targetUrl, {
            headers: { 'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        let html = response.data;

        let testHelperContent = '';
        try {
            testHelperContent = fs.readFileSync(path.join(__dirname, 'public', 'test-helper.js'), 'utf8');
        } catch (e) {}

        const injectTags = `
        <script>
        window.__GAME_USER__ = { username: "${targetUser}", balance: ${userBal} };
        ${testHelperContent}
        </script>
        <script src="/test-helper.js"></script>
        <base href="https://m.pg-demo.com/135/">
        `;
        html = html.replace('<head>', '<head>' + injectTags);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch (err) {
        console.error('[Slot 135 Error]', err.message);
        res.status(500).send('Lỗi tải ứng dụng: ' + err.message);
    }
});

// -------------------------------------------------------------
// 8. REVERSE PROXY & SIMULATION ENGINE CHO PG SOFT
// -------------------------------------------------------------
let cookieJar = {};
let lastSessionToken = '';

app.use(express.raw({ type: '*/*', limit: '10mb' }), async (req, res) => {
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        return res.status(200).end();
    }

    try {
        let targetUrl = '';
        if (req.originalUrl.startsWith('/__ext/')) {
            const afterExt = req.originalUrl.slice('/__ext/'.length);
            const firstSlash = afterExt.indexOf('/');
            const proto = afterExt.slice(0, firstSlash);
            const rest = afterExt.slice(firstSlash + 1);
            targetUrl = `${proto}://${rest}`;
        } else if (req.originalUrl.startsWith('/__proxy/')) {
            const encodedPart = req.originalUrl.replace('/__proxy/', '');
            const qIndex = encodedPart.indexOf('?');
            if (qIndex !== -1 && !encodedPart.substring(0, qIndex).includes('%3F')) {
                targetUrl = decodeURIComponent(encodedPart.substring(0, qIndex)) + encodedPart.substring(qIndex);
            } else {
                targetUrl = decodeURIComponent(encodedPart);
            }
        } else if (req.originalUrl.startsWith('/shared/')) {
            targetUrl = 'http://static.pg-demo.com' + req.originalUrl;
        } else {
            targetUrl = 'https://m.pg-demo.com' + req.originalUrl;
        }

        if (targetUrl.includes('m.pg-demo.com/shared/')) {
            targetUrl = targetUrl.replace('https://m.pg-demo.com/shared/', 'http://static.pg-demo.com/shared/').replace('http://m.pg-demo.com/shared/', 'http://static.pg-demo.com/shared/');
        }

        // Nhận diện người chơi từ referer query (?user=...)
        let requestUser = 'demo1';
        try {
            const referer = req.headers['referer'] || '';
            const match = referer.match(/[?&]user=([^&#]+)/);
            if (match) requestUser = decodeURIComponent(match[1]);
        } catch(e) {}

        // KIỂM TRA ĐIỀU KIỆN: CHẶN QUAY KHI HẾT TIỀN (Số dư <= 0)
        if (targetUrl.includes('/Spin') && req.method === 'POST') {
            const curBal = getCachedUserBalance(requestUser);
            if (curBal <= 0) {
                console.warn(`[CHẶN QUAY] Người chơi [${requestUser}] đã hết số dư (${curBal}). Từ chối vòng quay!`);
                const errorResp = {
                    "dt": null,
                    "err": {
                        "cd": "1001",
                        "msg": "Số dư không đủ! Bạn đã sử dụng hết tiền. Vui lòng liên hệ Admin để nạp thêm để tiếp tục chơi!"
                    }
                };
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.setHeader('Access-Control-Allow-Origin', '*');
                return res.status(200).send(Buffer.from(JSON.stringify(errorResp)));
            }
        }

        const forwardHeaders = {};
        for (const [k, v] of Object.entries(req.headers)) {
            const lower = k.toLowerCase();
            if (!['host', 'content-length', 'connection'].includes(lower)) {
                forwardHeaders[k] = v;
            }
        }

        forwardHeaders['origin'] = 'https://m.pg-demo.com';
        forwardHeaders['referer'] = 'https://m.pg-demo.com/135/index.html';

        if (lastSessionToken && !forwardHeaders['authorization'] && !forwardHeaders['Authorization']) {
            forwardHeaders['Authorization'] = `Bearer ${lastSessionToken}`;
        }

        const cookieEntries = Object.entries(cookieJar);
        if (cookieEntries.length > 0) {
            const cookieStr = cookieEntries.map(([k, v]) => `${k}=${v}`).join('; ');
            forwardHeaders['cookie'] = forwardHeaders['cookie'] ? (forwardHeaders['cookie'] + '; ' + cookieStr) : cookieStr;
        }

        const bodyData = ['POST', 'PUT', 'PATCH'].includes(req.method) && req.body && Buffer.isBuffer(req.body) && req.body.length > 0
            ? req.body
            : undefined;

        let response = await axios({
            method: req.method,
            url: targetUrl,
            data: bodyData,
            responseType: 'arraybuffer',
            headers: forwardHeaders,
            validateStatus: () => true,
            timeout: 12000
        });

        if (response.headers['set-cookie']) {
            const list = Array.isArray(response.headers['set-cookie']) ? response.headers['set-cookie'] : [response.headers['set-cookie']];
            list.forEach(c => {
                const part = c.split(';')[0];
                const eq = part.indexOf('=');
                if (eq !== -1) {
                    cookieJar[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
                }
            });
        }

        try {
            const fullText = Buffer.from(response.data).toString('utf8');
            if (fullText && fullText.trim().startsWith('{')) {
                const json = JSON.parse(fullText);
                if (json && json.dt && json.dt.tk) {
                    lastSessionToken = json.dt.tk;
                }
            }
        } catch (e) {}

        // ĐỒNG BỘ HÓA SỐ DƯ TẠI GAME WALLET
        if (targetUrl.includes('GameWallet/Get') || targetUrl.includes('GameWallet')) {
            try {
                const text = Buffer.from(response.data).toString('utf8');
                if (text && text.trim().startsWith('{')) {
                    const json = JSON.parse(text);
                    if (json && json.dt && typeof json.dt === 'object') {
                        const localBal = getCachedUserBalance(requestUser);

                        json.dt.tb = localBal;
                        json.dt.cb = localBal;
                        if (json.dt.tbb !== undefined) json.dt.tbb = 0;
                        if (json.dt.pb !== undefined) json.dt.pb = 0;

                        const modifiedBuf = Buffer.from(JSON.stringify(json));
                        res.setHeader('Content-Type', 'application/json; charset=utf-8');
                        res.setHeader('Access-Control-Allow-Origin', '*');
                        res.setHeader('Access-Control-Allow-Headers', '*');
                        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
                        return res.status(200).send(modifiedBuf);
                    }
                }
            } catch (err) {
                console.error('[GameWallet Proxy Intercept Error]', err.message);
            }
        }

        // BƯỚC FALLBACK MOCK: Nếu GameInfo/Get bị 401
        if (response.status === 401 && targetUrl.includes('GameInfo/Get')) {
            const curBal = getCachedUserBalance(requestUser);
            const mockGameInfo = {
                "dt": {
                    "c": "VND",
                    "cs": "₫",
                    "ml": [1, 2, 3, 5, 10],
                    "csList": [0.05, 0.5, 2.5, 10.0],
                    "in": 0,
                    "p": 135,
                    "gci": {
                        "p": 135,
                        "sn": "Wild Bounty Showdown",
                        "bm": 1,
                        "df": 0
                    },
                    "fb": null,
                    "ls": {
                        "si": {
                            "wp": null,
                            "lw": null,
                            "sn": [1, 2, 3, 4, 5, 6],
                            "tw": 0,
                            "bl": curBal,
                            "blb": curBal,
                            "bla": curBal
                        }
                    }
                },
                "err": null
            };
            const mockBuf = Buffer.from(JSON.stringify(mockGameInfo));
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Headers', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
            return res.status(200).send(mockBuf);
        }

        if (response.headers['content-type']) {
            res.setHeader('Content-Type', response.headers['content-type']);
        }
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.status(response.status).send(response.data);
    } catch (err) {
        console.error('[Proxy Error]', err.message);
        res.status(500).send(err.message);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Game & Portal Server đã sẵn sàng tại port ${PORT}`);
});
