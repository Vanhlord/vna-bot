const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const zlib = require("node:zlib");
const { pipeline } = require("node:stream/promises");
const { execSync } = require("node:child_process");

const isWin = process.platform === "win32";
const binDir = path.resolve(__dirname, "../../data/bin");
const localBinaryName = isWin ? "ffmpeg.exe" : "ffmpeg";
const localBinaryPath = path.join(binDir, localBinaryName);

// Optional explicit override. Useful on hosting (Docker/VPS) where ffmpeg comes
// from the OS package manager: set FFMPEG_PATH=/usr/bin/ffmpeg
const envFfmpegPath = process.env.FFMPEG_PATH || "";

let ffmpegStaticPath = null;
try {
  ffmpegStaticPath = require("ffmpeg-static");
} catch (_) { }

function getDownloadUrl() {
  const platform = process.platform;
  const arch = process.arch;
  return `https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-${platform}-${arch}.gz`;
}

function downloadBinary(url, destPath) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      // Handle redirect
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadBinary(res.headers.location, destPath).then(resolve).catch(reject);
      }

      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`Failed to download ffmpeg: HTTP ${res.statusCode}`));
      }

      const tempPath = `${destPath}.download`;
      pipeline(res, zlib.createGunzip(), fs.createWriteStream(tempPath))
        .then(() => {
          const stats = fs.statSync(tempPath);
          if (stats.size < 1_000_000) {
            throw new Error("Tệp FFmpeg tải về không hợp lệ.");
          }
          fs.renameSync(tempPath, destPath);
          if (!isWin) fs.chmodSync(destPath, 0o755);
          resolve(destPath);
        })
        .catch((error) => {
          fs.rm(tempPath, { force: true }, () => { });
          reject(error);
        });
    }).on("error", reject);
  });
}

class FFmpegManager {
  static async getBinaryPath() {
    // 0. Explicit override from environment
    if (envFfmpegPath && fs.existsSync(envFfmpegPath)) {
      if (!isWin) {
        try { fs.chmodSync(envFfmpegPath, 0o755); } catch (_) { }
      }
      return envFfmpegPath;
    }

    // 1. Check local ffmpeg-static path
    if (ffmpegStaticPath && fs.existsSync(ffmpegStaticPath)) {
      if (!isWin) {
        try { fs.chmodSync(ffmpegStaticPath, 0o755); } catch (_) { }
      }
      return ffmpegStaticPath;
    }

    // 2. Check data/bin/ffmpeg
    if (fs.existsSync(localBinaryPath)) {
      if (!isWin) {
        try { fs.chmodSync(localBinaryPath, 0o755); } catch (_) { }
      }
      return localBinaryPath;
    }

    // 3. Check system PATH
    try {
      const checkCmd = isWin ? "where ffmpeg" : "which ffmpeg";
      const sysPath = execSync(checkCmd, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim().split("\n")[0].trim();
      if (sysPath && fs.existsSync(sysPath)) {
        return sysPath;
      }
    } catch (_) { }

    // 4. Auto download static binary
    console.log(`[FFMPEG] 📥 Đang tự động tải ffmpeg binary về ${localBinaryPath}...`);
    if (!fs.existsSync(binDir)) {
      fs.mkdirSync(binDir, { recursive: true });
    }

    try {
      await downloadBinary(getDownloadUrl(), localBinaryPath);
      console.log(`[FFMPEG] ✅ Đã tải ffmpeg binary thành công!`);
      return localBinaryPath;
    } catch (err) {
      console.error(`[FFMPEG ERROR] Tải ffmpeg thất bại: ${err.message}`);
      // Throwing here lets AudioResolver fall back to play-dl. Returning a
      // missing command would create an asynchronous ENOENT after the resolver
      // had already considered the stream successful.
      throw new Error(`Không tìm thấy FFmpeg khả dụng: ${err.message}`);
    }
  }
}

module.exports = FFmpegManager;
