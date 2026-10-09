const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  ActivityType,
  DiscordjsErrorCodes,
} = require("discord.js");
const { Agent } = require("undici");
const { config, validateConfig } = require("./src/config/env");
const MusicManager = require("./src/core/musicManager");
const Persist247Service = require("./src/core/persist247");
const { commands, commandMap } = require("./src/commands");
const { handleMusicButton } = require("./src/core/buttonHandler");
const { createWebServer } = require("./src/web/server");
const EmbedBuilderUtil = require("./src/utils/embedBuilder");
const { handleInteractionError } = require("./src/core/interactionErrorHandler");
const {
  installProcessGuards,
  killAllChildren,
} = require("./src/core/processGuard");
const { runNetworkPreflight } = require("./src/core/networkDiagnostics");

// 1. Validate environment configuration
validateConfig();

console.log(`[BOOT] 🚀 Khởi động VNA Music Bot — Node ${process.version} (${process.platform}/${process.arch})`);
console.log(
  `[BOOT] ✅ Đã nạp cấu hình | Token: ${config.token ? "có" : "THIẾU"} | ClientID: ${config.clientId || "(trống)"} | Web: ${config.webEnabled ? "ON" : "OFF"}`
);

// Keep Discord REST connections warm and fail a dead route before Discord's
// three-second initial interaction deadline has already elapsed.
const discordRestAgent = new Agent({
  connect: { timeout: 2_000 },
  keepAliveTimeout: 60_000,
  keepAliveMaxTimeout: 120_000,
});

// 2. Initialize Discord Client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
  ],
  rest: {
    agent: discordRestAgent,
  },
});

// 3. Initialize Core Music Manager & Web Server
const musicManager = new MusicManager(client);
const webServer = createWebServer(client, musicManager);

// Guard every awaited network call with a timeout so a dead/slow route can
// never leave the boot sequence hanging silently (the classic "bot đứng im").
function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} vượt quá ${Math.round(ms / 1000)}s`)), ms);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

// 3.1 Optional HTTP healthcheck for web-service hosts (Render/Railway/Replit).
// When the dashboard is disabled but the platform injects PORT, these hosts
// kill/restart a process that never binds a port. A tiny 200-OK endpoint keeps
// the service marked healthy without exposing the dashboard.
if (!config.webEnabled && process.env.PORT) {
  try {
    const http = require("node:http");
    const healthPort = Number(process.env.PORT);
    const healthServer = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("OK");
    });
    healthServer.on("error", (error) => {
      console.warn(`[HEALTH] Không mở được cổng ${healthPort}: ${error.message}`);
    });
    healthServer.listen(healthPort, "0.0.0.0", () => {
      console.log(`[HEALTH] ✅ Healthcheck lắng nghe tại cổng ${healthPort} (GET /).`);
    });
  } catch (error) {
    console.warn(`[HEALTH] Bỏ qua healthcheck: ${error.message}`);
  }
}

// 4. Register Slash Commands to Discord API
async function registerSlashCommands() {
  try {
    const rest = new REST({ version: "10", agent: discordRestAgent }).setToken(config.token);
    const commandPayloads = commands.map((c) => c.data.toJSON());

    console.log(`[BOOT] Đang đồng bộ ${commandPayloads.length} lệnh Slash lên Discord...`);

    if (config.devGuildId) {
      await withTimeout(
        rest.put(
          Routes.applicationGuildCommands(config.clientId || client.user.id, config.devGuildId),
          { body: commandPayloads }
        ),
        20_000,
        "Đăng ký Slash Commands (guild)"
      );
      console.log(`✅ [BOOT] Đã đăng ký lệnh Slash cho Dev Guild ID: ${config.devGuildId}`);
    } else {
      await withTimeout(
        rest.put(
          Routes.applicationCommands(config.clientId || client.user.id),
          { body: commandPayloads }
        ),
        20_000,
        "Đăng ký Slash Commands (global)"
      );
      console.log("✅ [BOOT] Đã đăng ký lệnh Slash toàn cầu (Global Commands) thành công!");
    }
  } catch (error) {
    console.error(`❌ [BOOT ERROR] Lỗi khi đăng ký Slash Commands: ${error.message}`);
  }
}

// 5. Ready Event
client.once("ready", async () => {
  console.log(`===================================================`);
  console.log(`  🎵 VNA MUSIC BOT ONLINE: ${client.user.tag}`);
  console.log(`  🌐 Servers kết nối: ${client.guilds.cache.size}`);
  console.log(`  ⚙️  Node.js: ${process.version}`);
  console.log(`===================================================`);

  // Auto register slash commands
  await registerSlashCommands();

  // Set bot activity
  client.user.setPresence({
    activities: [
      {
        name: "/play | VNA Music 5⭐",
        type: ActivityType.Listening,
      },
    ],
    status: "online",
  });

  // Auto reconnect to all 24/7 channels
  await musicManager.autoJoinAll247Guilds();

  // Start Web Dashboard & Embed Sender
  webServer.start();
});

// 6. Interaction Create Event (Slash Commands, Autocomplete, Buttons)
client.on("interactionCreate", async (interaction) => {
  try {
    // 6.1. Autocomplete Search
    if (interaction.isAutocomplete()) {
      const command = commandMap.get(interaction.commandName);
      if (command && typeof command.autocomplete === "function") {
        await command.autocomplete(interaction);
      }
      return;
    }

    // 6.2. Slash Commands
    if (interaction.isChatInputCommand()) {
      const command = commandMap.get(interaction.commandName);
      if (!command) return;
      await command.execute(interaction, musicManager);
      return;
    }

    // 6.3. Interactive Controller Components (Buttons, Select Menus, Modals)
    if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) {
      await handleMusicButton(interaction, musicManager);
      return;
    }
  } catch (error) {
    await handleInteractionError(interaction, error, (message) =>
      EmbedBuilderUtil.createErrorEmbed(message)
    );
  }
});

// 7. Auto Leave Voice Channel When Empty
client.on("voiceStateUpdate", (oldState, newState) => {
  if (!config.autoLeaveOnEmpty) return;

  const guildId = oldState.guild.id;

  // If this server has 24/7 mode enabled, NEVER auto-leave
  if (Persist247Service.is247(guildId)) {
    return;
  }

  const queue = musicManager.getQueue(guildId);
  if (!queue || !queue.voiceChannel) return;

  // Ignore voice events that fire while a join is still in flight: the channel
  // can legitimately look empty before the gateway confirms the bot's arrival,
  // which would otherwise make the bot leave right after /join or /treo.
  if (queue.isJoining) return;

  const botVoiceChannel = oldState.guild.channels.cache.get(queue.voiceChannel.id);
  if (!botVoiceChannel) return;

  // Filter out bots to check human members
  const humanMembers = botVoiceChannel.members.filter((m) => !m.user.bot);
  if (humanMembers.size === 0) {
    console.log(`[VOICE] Kênh voice ${botVoiceChannel.name} không còn người nghe. Tự động rời phòng...`);
    if (queue.textChannel) {
      queue.textChannel.send("👋 Kênh voice không còn ai, bot xin phép rời phòng để tiết kiệm băng thông!").catch(() => { });
    }
    musicManager.destroyQueue(guildId);
  }
});

// 8. Discord Client & Shard Error Handling
// Without an "error" listener, EventEmitter throws on any client error, which
// used to leave the process in a half-dead state on hosting.
client.on("error", (error) => {
  console.error("[CLIENT ERROR]", error);
});

client.on("warn", (message) => {
  console.warn("[CLIENT WARN]", message);
});

client.on("shardError", (error, shardId) => {
  console.error(`[SHARD ${shardId}] Lỗi kết nối gateway:`, error);
});

client.on("shardDisconnect", (event, shardId) => {
  console.warn(
    `[SHARD ${shardId}] Mất kết nối gateway (code ${event?.code ?? "?"}). discord.js sẽ tự kết nối lại...`
  );
});

client.on("shardReconnecting", (shardId) => {
  console.log(`[SHARD ${shardId}] Đang kết nối lại với Discord...`);
});

client.on("shardReady", (shardId) => {
  console.log(`[SHARD ${shardId}] Đã sẵn sàng.`);
});

// Fired when Discord rejects the session (e.g. token revoked or two instances
// running the same token). Restarting is the only correct response.
client.on("invalidated", () => {
  console.error("❌ [CLIENT] Session bị vô hiệu hoá (invalidated). Thoát để hosting khởi động lại...");
  killAllChildren();
  gracefulExit(1);
});

// 8.1 Surface Discord REST rate limits. A Cloudflare/Discord 429 on the login
// call (`/gateway/bot`) makes discord.js wait out the whole Retry-After window
// with zero output — the exact "đứng im" symptom. Logging it makes it visible
// and explains why login appears to hang on shared/flagged hosting IPs.
let rateLimitObservedAt = 0;
client.rest.on("rateLimited", (info) => {
  rateLimitObservedAt = Date.now();
  const waitSec = Math.round((info?.timeToReset ?? 0) / 1000);
  console.warn(
    `[RATE LIMIT] Discord giới hạn tần suất (429): route=${info?.route ?? "?"} | global=${info?.global ? "CÓ" : "không"} | phải chờ ${waitSec}s`
  );
});

// 9. Process Lifecycle Guards (crash logging + graceful shutdown)
installProcessGuards({
  onShutdown: async () => {
    try {
      musicManager.destroyAll();
    } catch (error) {
      console.error(`[SHUTDOWN] Không thể dọn dẹp hàng đợi nhạc: ${error.message}`);
    }
    try {
      if (client.isReady()) {
        client.destroy();
      }
    } catch (_) {
      /* ignore */
    }
  },
});

// 10. Robust Login with Retry / Backoff
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isFatalLoginError(error) {
  const code = error && error.code;
  if (code && DiscordjsErrorCodes) {
    if (code === DiscordjsErrorCodes.TokenInvalid || code === DiscordjsErrorCodes.TokenMissing) {
      return true;
    }
  }
  const message = String((error && error.message) || "");
  return /invalid token|tokeninvalid|token is missing|an invalid token/i.test(message);
}

// A 429 (Cloudflare/Discord rate limit) is temporary — retrying quickly makes it
// worse. Detect it so the retry loop can back off long instead of crash-looping.
function isRateLimitError(error) {
  if (!error) return false;
  if (error.status === 429 || error.statusCode === 429) return true;
  const message = String(error.message || "");
  return /\b429\b|rate limit|too many requests|you are being rate limited/i.test(message);
}

const RATE_LIMIT_BACKOFF_MS = Number(process.env.LOGIN_RATELIMIT_BACKOFF_MS) || 300_000;

// `client.login()` resolves only after the gateway READY payload. If the host
// blocks the WebSocket or has no outbound access, it hangs forever with no
// output. A timeout turns that silent hang into a visible, retryable failure.
const LOGIN_TIMEOUT_MS = Number(process.env.LOGIN_TIMEOUT_MS) || 45_000;

async function loginWithTimeout(token) {
  let timer;
  try {
    return await Promise.race([
      client.login(token),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`client.login() không phản hồi sau ${Math.round(LOGIN_TIMEOUT_MS / 1000)}s`)),
          LOGIN_TIMEOUT_MS
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Exiting synchronously right after tearing down the Discord client / undici
// agent can trip a libuv assertion while handles are still closing. Defer the
// exit a tick so handles settle and the process terminates with the right code.
function gracefulExit(code) {
  setTimeout(() => process.exit(code), 100);
}

async function startBot() {
  const maxAttempts = Number(process.env.LOGIN_MAX_ATTEMPTS) || 5;
  const maxRateLimitRetries = Number(process.env.LOGIN_RATELIMIT_MAX_RETRIES) || 24;
  let rateLimitRetries = 0;
  console.log("[BOOT] 🔌 Bắt đầu kết nối tới Discord Gateway...");

  // Chạy chẩn đoán mạng song song: log sẽ hiện ngay cả khi login đang chờ,
  // giúp chỉ rõ hosting chặn ở chặng nào (DNS / TCP / REST / WebSocket).
  // Truyền token để probe thêm endpoint xác thực /gateway/bot — đúng đường
  // mà client.login() dùng, nhờ đó phân biệt rõ 429 "công khai" vs 429 "login thật".
  runNetworkPreflight({ token: config.token }).catch(() => {
    /* đã tự log bên trong */
  });

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      console.log(`[BOOT] ⏳ Đang đăng nhập Discord (lần ${attempt}/${maxAttempts})...`);
      await loginWithTimeout(config.token);
      console.log("[BOOT] ✅ Đăng nhập thành công. Đang chờ sự kiện ready...");
      return;
    } catch (error) {
      const detail = error && error.code
        ? `[${error.code}] ${error.message}`
        : (error && error.message) || String(error);
      console.error(`❌ [BOOT] Đăng nhập thất bại (lần ${attempt}/${maxAttempts}): ${detail}`);

      // A bad/revoked token will never succeed: exit so the host restarts and
      // surfaces the failure instead of idling a silently-offline process.
      if (isFatalLoginError(error)) {
        console.error("🛑 [BOOT FATAL] Token không hợp lệ hoặc bot đã bị vô hiệu hoá. Thoát để hosting khởi động lại.");
        gracefulExit(1);
        return;
      }

      // Reset the client so the next attempt starts from a clean state instead
      // of reusing a half-open gateway/REST session.
      try {
        client.destroy();
      } catch (_) {
        /* ignore */
      }

      // Rate limited (429): do NOT count it as a failed attempt and do NOT exit.
      // Exiting makes the host restart and hammer Discord again, which keeps the
      // limit alive forever. Back off long so the limit can cool down.
      // A 429 during login usually surfaces as OUR timeout error (discord.js is
      // silently waiting out Retry-After), so also treat a recent REST rate-limit
      // event as the cause.
      const rateLimitedRecently = Date.now() - rateLimitObservedAt < 120_000;
      if (isRateLimitError(error) || rateLimitedRecently) {
        rateLimitRetries += 1;
        if (rateLimitRetries > maxRateLimitRetries) {
          console.error("🛑 [BOOT FATAL] Bị Discord giới hạn tần suất (429) quá lâu. Thoát để hosting khởi động lại.");
          gracefulExit(1);
          return;
        }
        console.warn(
          `⏳ [BOOT] Discord đang giới hạn tần suất (429). Chờ ${Math.round(RATE_LIMIT_BACKOFF_MS / 1000)}s rồi thử lại (lần ${rateLimitRetries}/${maxRateLimitRetries}).`
        );
        attempt -= 1; // không tính là một lần thử thất bại
        await sleep(RATE_LIMIT_BACKOFF_MS);
        continue;
      }

      if (attempt === maxAttempts) {
        console.error("🛑 [BOOT FATAL] Không thể đăng nhập sau nhiều lần thử. Thoát để hosting khởi động lại.");
        gracefulExit(1);
        return;
      }

      const delay = Math.min(60_000, 2_000 * 2 ** (attempt - 1));
      console.log(`⏳ [BOOT] Thử đăng nhập lại sau ${Math.round(delay / 1000)}s...`);
      await sleep(delay);
    }
  }
}

startBot();
