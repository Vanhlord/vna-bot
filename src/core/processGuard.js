"use strict";

/**
 * processGuard
 * ------------
 * Central resilience layer for running the bot on external hosting (Railway,
 * Render, Replit, VPS/PM2...). It provides:
 *
 *   1. A registry for spawned child processes (ffmpeg, yt-dlp) so they are
 *      always terminated on shutdown. Orphaned encoders keep bleeding CPU/RAM
 *      across restarts and are the classic reason a host starts OOM-killing or
 *      failing to boot the bot again.
 *   2. Crash handlers: `uncaughtException` is logged to disk and then the
 *      process exits with a non-zero code so the host can restart it cleanly
 *      instead of leaving a half-dead process that never comes back online.
 *   3. Graceful shutdown on SIGTERM/SIGINT/SIGBREAK so containers stop within
 *      their timeout window and release the voice/gateway session + HTTP port.
 */

const fs = require("node:fs");
const path = require("node:path");

const childProcesses = new Set();

let shuttingDown = false;
let handlersInstalled = false;
let crashDir = null;

function getCrashDir() {
    if (crashDir) return crashDir;
    try {
        crashDir = path.resolve(__dirname, "../../logs");
        fs.mkdirSync(crashDir, { recursive: true });
    } catch (_) {
        crashDir = path.resolve(process.cwd(), "logs");
        try {
            fs.mkdirSync(crashDir, { recursive: true });
        } catch (_) {
            /* ignore */
        }
    }
    return crashDir;
}

/**
 * Append a crash record to logs/crash.log. Never throws: crash logging must not
 * itself crash the process.
 */
function writeCrashLog(kind, payload) {
    try {
        const file = path.join(getCrashDir(), "crash.log");
        const error = payload instanceof Error ? payload : new Error(String(payload));
        const entry = [
            `===== ${new Date().toISOString()} [${kind}] =====`,
            error.stack || error.message || String(payload),
            "",
        ].join("\n");
        fs.appendFileSync(file, entry, "utf8");
    } catch (_) {
        /* ignore */
    }
}

/**
 * Track a spawned child process so it can be killed on shutdown. Returns the
 * same child instance for convenient inline usage:
 *   const proc = registerChild(spawn(bin, args));
 */
function registerChild(child) {
    if (!child || typeof child.on !== "function") return child;
    childProcesses.add(child);
    const cleanup = () => childProcesses.delete(child);
    child.once("exit", cleanup);
    child.once("close", cleanup);
    child.once("error", cleanup);
    return child;
}

function unregisterChild(child) {
    if (child) childProcesses.delete(child);
}

function killAllChildren(signal = "SIGKILL") {
    for (const child of childProcesses) {
        try {
            if (child.exitCode === null && !child.killed) {
                child.kill(signal);
            }
        } catch (_) {
            /* ignore */
        }
    }
    childProcesses.clear();
}

function childCount() {
    return childProcesses.size;
}

function isShuttingDown() {
    return shuttingDown;
}

/**
 * Terminate after a short delay so libuv can finish closing handles first.
 * Calling process.exit() while handles are mid-close triggers a libuv
 * assertion on some platforms (notably Windows).
 */
function safeExit(code) {
    setTimeout(() => process.exit(code), 100);
}

function installCrashHandlers() {
    process.on("uncaughtException", (error) => {
        console.error("[UNCAUGHT EXCEPTION] Tiến trình gặp lỗi nghiêm trọng:", error);
        writeCrashLog("uncaughtException", error);
        // Process state is no longer trustworthy: exit so hosting restarts it.
        shuttingDown = true;
        killAllChildren();
        safeExit(1);
    });

    process.on("unhandledRejection", (reason) => {
        console.error("[UNHANDLED REJECTION]:", reason);
        writeCrashLog("unhandledRejection", reason);
        // A single rejected async op should not necessarily kill a music bot.
    });

    process.on("warning", (warning) => {
        console.warn(`[PROCESS WARNING] ${warning.name}: ${warning.message}`);
    });
}

function installShutdownHandlers(options = {}) {
    const onShutdown = typeof options.onShutdown === "function" ? options.onShutdown : null;

    const shutdown = async (signal) => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log(`[LIFECYCLE] Nhận tín hiệu ${signal} — đang tắt bot an toàn...`);
        try {
            if (onShutdown) {
                await onShutdown(signal);
            }
        } catch (error) {
            console.error("[LIFECYCLE] Lỗi trong quá trình tắt bot:", error);
        } finally {
            killAllChildren();
            console.log("[LIFECYCLE] Đã dọn dẹp tiến trình con. Thoát.");
            safeExit(0);
        }
    };

    for (const signal of ["SIGTERM", "SIGINT", "SIGBREAK", "SIGHUP"]) {
        try {
            process.on(signal, () => shutdown(signal));
        } catch (_) {
            /* not supported on every platform */
        }
    }
}

/**
 * Install both crash and shutdown handling. Idempotent — safe to call twice.
 */
function installProcessGuards(options = {}) {
    if (handlersInstalled) return;
    handlersInstalled = true;
    installCrashHandlers();
    installShutdownHandlers(options);
}

module.exports = {
    registerChild,
    unregisterChild,
    killAllChildren,
    childCount,
    isShuttingDown,
    writeCrashLog,
    installCrashHandlers,
    installShutdownHandlers,
    installProcessGuards,
};
