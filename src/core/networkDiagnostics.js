"use strict";

/**
 * Chẩn đoán kết nối mạng tới Discord.
 *
 * Khi `client.login()` treo (không resolve, không reject) thì gần như luôn là
 * do mạng chứ không phải code: hosting chặn/không tới được Discord Gateway.
 * Hàm dưới đây kiểm tra từng "chặng" riêng biệt để biết chính xác chặng nào
 * hỏng, thay vì chỉ thấy một timeout chung chung:
 *
 *   1) DNS phân giải discord.com / gateway.discord.gg (A + AAAA)
 *   2) TCP tới cổng 443 (mặc định + buộc IPv4)
 *   3) HTTPS REST API  https://discord.com/api/v10/gateway
 *   4) WebSocket Gateway wss://gateway.discord.gg (đúng transport discord.js dùng)
 */

const dns = require("node:dns").promises;
const net = require("node:net");
const https = require("node:https");

const DEFAULT_TIMEOUT_MS = Number(process.env.NETCHECK_TIMEOUT_MS) || 8000;

function withTimeout(promise, ms, label) {
    let timer;
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`${label} quá hạn ${ms}ms`)), ms);
        }),
    ]).finally(() => {
        if (timer) clearTimeout(timer);
    });
}

async function checkDns(host, timeoutMs) {
    const out = {};
    const families = [
        ["A", dns.resolve4],
        ["AAAA", dns.resolve6],
    ];
    for (const [name, fn] of families) {
        try {
            const addrs = await withTimeout(fn(host), timeoutMs, `DNS ${name} ${host}`);
            out[name] = { ok: true, addrs };
        } catch (error) {
            out[name] = { ok: false, error: error.code || error.message };
        }
    }
    return out;
}

function checkTcp(host, port, family, timeoutMs) {
    return new Promise((resolve) => {
        const started = Date.now();
        let done = false;
        let socket;
        const finish = (ok, detail) => {
            if (done) return;
            done = true;
            if (socket) socket.destroy();
            resolve({ ok, ms: Date.now() - started, detail });
        };
        try {
            socket = net.connect({ host, port, family: family || 0 });
        } catch (error) {
            finish(false, error.message);
            return;
        }
        socket.setTimeout(timeoutMs);
        socket.once("connect", () => finish(true, `OK sau ${Date.now() - started}ms`));
        socket.once("timeout", () => finish(false, `timeout ${timeoutMs}ms (gói tin có thể bị chặn)`));
        socket.once("error", (error) => finish(false, error.code || error.message));
    });
}

function checkHttps(url, timeoutMs, extraHeaders = {}) {
    return new Promise((resolve) => {
        const started = Date.now();
        let req;
        try {
            req = https.get(
                url,
                {
                    timeout: timeoutMs,
                    headers: {
                        // Gửi User-Agent hợp lệ: Cloudflare hay trả 429/403 cho
                        // request thiếu UA xuất phát từ IP datacenter.
                        "User-Agent": "VNA-Music-Bot-SelfCheck/1.0 (+https://discord.com)",
                        Accept: "application/json",
                        ...extraHeaders,
                    },
                },
                (res) => {
                    res.resume();
                    const status = res.statusCode;
                    const ok = status >= 200 && status < 400;
                    resolve({ ok, status, detail: `HTTP ${status} sau ${Date.now() - started}ms` });
                }
            );
        } catch (error) {
            resolve({ ok: false, detail: error.message });
            return;
        }
        req.once("timeout", () => {
            req.destroy();
            resolve({ ok: false, detail: `timeout ${timeoutMs}ms` });
        });
        req.once("error", (error) => resolve({ ok: false, detail: error.code || error.message }));
    });
}

function checkWebSocket(url, timeoutMs) {
    return new Promise((resolve) => {
        let WebSocketImpl;
        try {
            // `ws` là transport thật mà discord.js dùng cho gateway — test đúng nó.
            WebSocketImpl = require("ws");
        } catch (_) {
            WebSocketImpl = globalThis.WebSocket;
        }
        if (!WebSocketImpl) {
            resolve({ ok: false, detail: "không tìm thấy thư viện WebSocket (ws)" });
            return;
        }
        const started = Date.now();
        let done = false;
        let socket;
        const finish = (ok, detail) => {
            if (done) return;
            done = true;
            try {
                if (socket && typeof socket.terminate === "function") socket.terminate();
            } catch (_) {
                /* ignore */
            }
            resolve({ ok, ms: Date.now() - started, detail });
        };
        try {
            socket = new WebSocketImpl(url, { handshakeTimeout: timeoutMs });
        } catch (error) {
            finish(false, error.message);
            return;
        }
        socket.on("open", () => finish(true, `handshake OK sau ${Date.now() - started}ms`));
        socket.on("message", () => finish(true, `nhận HELLO sau ${Date.now() - started}ms`));
        socket.on("error", (error) => finish(false, error.code || error.message));
        socket.on("close", (code) => {
            if (!done) finish(false, `đóng sớm (code ${code})`);
        });
        setTimeout(() => finish(false, `timeout ${timeoutMs}ms`), timeoutMs + 500);
    });
}

function formatDns(entry) {
    if (!entry) return "?";
    if (entry.ok) return (entry.addrs || []).join("|") || "(rỗng)";
    return `LỖI(${entry.error})`;
}

function symbol(result) {
    return result && result.ok ? "✅" : "❌";
}

/**
 * Chạy toàn bộ phép thử mạng. Không bao giờ throw — mọi lỗi được bắt và log.
 * Trả về object kết quả để nơi gọi có thể dùng lại nếu cần.
 */
async function runNetworkPreflight(options = {}) {
    const timeoutMs = Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS;
    const tag = "[NET]";
    const results = { dns: {}, tcp: {}, https: null, auth: null, ws: null };

    console.log(`${tag} 🔎 Kiểm tra kết nối mạng tới Discord (timeout ${timeoutMs}ms/chặng)...`);

    try {
        const dnsDomain = await checkDns("discord.com", timeoutMs);
        const dnsGateway = await checkDns("gateway.discord.gg", timeoutMs);
        results.dns.discord = dnsDomain;
        results.dns.gateway = dnsGateway;
        console.log(`${tag} DNS discord.com        → A:${formatDns(dnsDomain.A)} AAAA:${formatDns(dnsDomain.AAAA)}`);
        console.log(`${tag} DNS gateway.discord.gg → A:${formatDns(dnsGateway.A)} AAAA:${formatDns(dnsGateway.AAAA)}`);

        const tcpAuto = await checkTcp("discord.com", 443, 0, timeoutMs);
        const tcpV4 = await checkTcp("discord.com", 443, 4, timeoutMs);
        results.tcp.discordAuto = tcpAuto;
        results.tcp.discordV4 = tcpV4;
        console.log(`${tag} TCP discord.com:443     → mặc định:${symbol(tcpAuto)} ${tcpAuto.detail} | IPv4:${symbol(tcpV4)} ${tcpV4.detail}`);

        const tcpGateway = await checkTcp("gateway.discord.gg", 443, 0, timeoutMs);
        results.tcp.gateway = tcpGateway;
        console.log(`${tag} TCP gateway:443         → ${symbol(tcpGateway)} ${tcpGateway.detail}`);

        const httpsRes = await checkHttps("https://discord.com/api/v10/gateway", timeoutMs);
        results.https = httpsRes;
        console.log(`${tag} HTTPS /api/v10/gateway  → ${symbol(httpsRes)} ${httpsRes.detail}`);

        const wsRes = await checkWebSocket("wss://gateway.discord.gg/?v=10&encoding=json", timeoutMs);
        results.ws = wsRes;
        console.log(`${tag} WSS gateway             → ${symbol(wsRes)} ${wsRes.detail}`);

        // Probe xác thực: gọi ĐÚNG endpoint mà client.login() dùng đầu tiên
        // (GET /gateway/bot kèm header Authorization). Đây là phép thử quyết định
        // để phân biệt "endpoint công khai bị 429" với "đường login thật bị 429".
        let authRes = null;
        if (options.token) {
            authRes = await checkHttps("https://discord.com/api/v10/gateway/bot", timeoutMs, {
                Authorization: `Bot ${options.token}`,
            });
            results.auth = authRes;
            console.log(`${tag} AUTH /gateway/bot      → ${symbol(authRes)} ${authRes.detail}`);
        }

        const rateLimited = httpsRes.status === 429 || (authRes && authRes.status === 429);

        if (authRes && authRes.ok && httpsRes.status === 429) {
            console.log(`${tag} ⚠️ Lạ: endpoint công khai trả 429 nhưng AUTH /gateway/bot lại OK. Chủ yếu là burst tạm thời.`);
            console.log(`${tag}    → Thử khởi động lại sau ít phút; nhiều khả năng login sẽ vào được.`);
        } else if (rateLimited) {
            console.log(`${tag} ⚠️ REST trả 429 — IP hosting đang bị Discord/Cloudflare GIỚI HẠN TẦN SUẤT (không phải bị chặn cổng).`);
            console.log(`${tag}    → discord.js sẽ chờ hết Retry-After nên login trông như "treo". Cần đổi IP/host hoặc chờ hạ nhiệt.`);
            if (authRes && authRes.status === 429) {
                console.log(`${tag}    → XÁC NHẬN: 429 đánh trúng đường login thật (/gateway/bot). Đây là nguyên nhân treo.`);
            }
        } else if (httpsRes.ok && wsRes.ok) {
            console.log(`${tag} ✅ Mọi chặng mạng đều OK. Nếu login vẫn treo, nghi vấn token/intents hoặc Discord đang bảo trì.`);
        } else if (httpsRes.ok && !wsRes.ok) {
            console.log(`${tag} ⚠️ REST API OK nhưng WebSocket Gateway bị chặn — hosting đang chặn WSS tới Discord.`);
        } else if (!httpsRes.ok) {
            console.log(`${tag} ⚠️ Không tới được Discord REST API — hosting chặn/kẹt outbound tới discord.com:443.`);
        }
    } catch (error) {
        console.error(`${tag} ❌ Chẩn đoán mạng gặp lỗi không mong đợi: ${error.message}`);
    }

    return results;
}

module.exports = { runNetworkPreflight };
