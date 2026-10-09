const path = require("node:path");
const dotenv = require("dotenv");

// Load .env
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

function parseNumber(val, fallback) {
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

function parseBoolean(val, fallback) {
  if (val === undefined || val === null) return fallback;
  const s = String(val).trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(s)) return true;
  if (["false", "0", "no", "n", "off"].includes(s)) return false;
  return fallback;
}

const config = {
  token: process.env.DISCORD_TOKEN || "",
  clientId: process.env.CLIENT_ID || "",
  idleTimeoutSeconds: parseNumber(process.env.IDLE_TIMEOUT_SECONDS, 180),
  autoLeaveOnEmpty: parseBoolean(process.env.AUTO_LEAVE_ON_EMPTY, true),
  devGuildId: process.env.DEV_GUILD_ID || "",
  // Web Dashboard & Embed Sender
  webEnabled: parseBoolean(process.env.WEB_ENABLED, true),
  webPort: parseNumber(process.env.WEB_PORT || process.env.PORT, 3003),
  webHost: process.env.WEB_HOST || "0.0.0.0",
};

function validateConfig() {
  if (!config.token || config.token === "YOUR_BOT_TOKEN_HERE") {
    console.error("❌ [CONFIG ERROR] Bạn chưa cấu hình DISCORD_TOKEN trong file .env!");
    console.error("👉 Vui lòng mở file .env và điền Token của bot lấy từ Discord Developer Portal.");
    process.exit(1);
  }
}

module.exports = {
  config,
  validateConfig,
};
