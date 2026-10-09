const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");

const isWin = process.platform === "win32";
const binDir = path.resolve(__dirname, "../../data/bin");
const localBinaryName = isWin ? "yt-dlp.exe" : "yt-dlp";
const localBinaryPath = path.join(binDir, localBinaryName);

// Standard yt-dlp-exec path
const nodeModulesYtdlpPath = path.resolve(
  __dirname,
  `../../node_modules/yt-dlp-exec/bin/${localBinaryName}`
);

// Optional explicit override. Useful on hosting (Docker/VPS) where yt-dlp is
// installed globally or lives outside the project: set YTDLP_PATH=/usr/bin/yt-dlp
const envYtdlpPath = process.env.YTDLP_PATH || "";

function getDownloadUrl() {
  return isWin
    ? "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
    : "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp";
}

function downloadBinary(url, destPath) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      // Handle redirect
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadBinary(res.headers.location, destPath).then(resolve).catch(reject);
      }

      if (res.statusCode !== 200) {
        return reject(new Error(`Failed to download yt-dlp: HTTP ${res.statusCode}`));
      }

      const fileStream = fs.createWriteStream(destPath);
      res.pipe(fileStream);

      fileStream.on("finish", () => {
        fileStream.close(() => {
          if (!isWin) {
            try {
              fs.chmodSync(destPath, 0o755);
            } catch (_) { }
          }
          resolve(destPath);
        });
      });

      fileStream.on("error", (err) => {
        fs.unlink(destPath, () => { });
        reject(err);
      });
    }).on("error", reject);
  });
}

class YtDlpManager {
  static async getBinaryPath() {
    // 0. Explicit override from environment
    if (envYtdlpPath && fs.existsSync(envYtdlpPath)) {
      if (!isWin) {
        try { fs.chmodSync(envYtdlpPath, 0o755); } catch (_) { }
      }
      return envYtdlpPath;
    }

    // 1. Check local node_modules
    if (fs.existsSync(nodeModulesYtdlpPath)) {
      if (!isWin) {
        try { fs.chmodSync(nodeModulesYtdlpPath, 0o755); } catch (_) { }
      }
      return nodeModulesYtdlpPath;
    }

    // 2. Check data/bin/yt-dlp
    if (fs.existsSync(localBinaryPath)) {
      if (!isWin) {
        try { fs.chmodSync(localBinaryPath, 0o755); } catch (_) { }
      }
      return localBinaryPath;
    }

    // 3. Auto download if missing
    console.log(`[YT-DLP] 📥 Đang tự động tải yt-dlp binary về ${localBinaryPath}...`);
    if (!fs.existsSync(binDir)) {
      fs.mkdirSync(binDir, { recursive: true });
    }

    try {
      await downloadBinary(getDownloadUrl(), localBinaryPath);
      console.log(`[YT-DLP] ✅ Đã tải yt-dlp binary thành công!`);
      return localBinaryPath;
    } catch (err) {
      console.error(`[YT-DLP ERROR] Tải yt-dlp thất bại: ${err.message}`);
      // Fallback to command name in PATH
      return "yt-dlp";
    }
  }
}

module.exports = YtDlpManager;
