"use strict";

/**
 * Runs after `npm install` for THIS project. The root project's lifecycle
 * scripts are not affected by npm's *dependency* install-script blocking, so
 * this reliably provisions the ffmpeg / yt-dlp binaries even when the
 * `ffmpeg-static` and `yt-dlp-exec` post-install scripts are skipped by the
 * hosting build machine.
 *
 * Always exits 0: a transient network failure must not break a deployment.
 * (The managers also lazily download on first use, this just warms them up.)
 */

const fs = require("node:fs");
const path = require("node:path");

async function ensureDir(dir) {
    try {
        fs.mkdirSync(dir, { recursive: true });
    } catch (_) {
        /* ignore */
    }
}

async function main() {
    await ensureDir(path.resolve(__dirname, "../logs"));
    await ensureDir(path.resolve(__dirname, "../data/bin"));

    try {
        const FFmpegManager = require("../src/core/ffmpegManager");
        const ffmpegPath = await FFmpegManager.getBinaryPath();
        console.log(`[POSTINSTALL] ✅ ffmpeg sẵn sàng: ${ffmpegPath}`);
    } catch (error) {
        console.warn(`[POSTINSTALL] ⚠️ Không thể chuẩn bị ffmpeg: ${error.message}`);
    }

    try {
        const YtDlpManager = require("../src/core/ytdlpManager");
        const ytdlpPath = await YtDlpManager.getBinaryPath();
        console.log(`[POSTINSTALL] ✅ yt-dlp sẵn sàng: ${ytdlpPath}`);
    } catch (error) {
        console.warn(`[POSTINSTALL] ⚠️ Không thể chuẩn bị yt-dlp: ${error.message}`);
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.warn(`[POSTINSTALL] ⚠️ Bỏ qua lỗi không nghiêm trọng: ${error && error.message}`);
        process.exit(0);
    });
