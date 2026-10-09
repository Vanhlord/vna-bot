const NETWORK_ERROR_CODES = new Set([
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETDOWN",
  "ENETUNREACH",
  "ENOTFOUND",
  "ETIMEDOUT",
]);

function getErrorChain(error) {
  const chain = [];
  const seen = new Set();
  let current = error;

  while (current && !seen.has(current) && chain.length < 8) {
    seen.add(current);
    chain.push(current);
    current = current.cause;
  }

  return chain;
}

function getDiscordErrorCode(error) {
  for (const item of getErrorChain(error)) {
    const candidates = [item.code, item.rawError?.code, item.data?.code];
    for (const code of candidates) {
      if (typeof code === "number") return code;
      if (typeof code === "string" && /^\d+$/.test(code)) return Number(code);
    }
  }
  return null;
}

function getErrorMessage(error) {
  return getErrorChain(error)
    .map((item) => item?.message)
    .filter(Boolean)
    .join(" | ");
}

function isUnknownInteractionError(error) {
  return getDiscordErrorCode(error) === 10062 || /unknown interaction/i.test(getErrorMessage(error));
}

function isUnknownMessageError(error) {
  return getDiscordErrorCode(error) === 10008 || /unknown message/i.test(getErrorMessage(error));
}

function isDiscordNetworkError(error) {
  return getErrorChain(error).some((item) => {
    const code = String(item?.code || "").toUpperCase();
    const name = String(item?.name || "");
    const message = String(item?.message || "");

    return (
      NETWORK_ERROR_CODES.has(code) ||
      /ConnectTimeoutError|HeadersTimeoutError|BodyTimeoutError|SocketError/i.test(name) ||
      /connect timeout|fetch failed|socket hang up|ECONNRESET|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH/i.test(message)
    );
  });
}

function getInteractionAgeMs(interaction) {
  const createdAt = Number(interaction?.createdTimestamp);
  return Number.isFinite(createdAt) ? Math.max(0, Date.now() - createdAt) : null;
}

function getInteractionLabel(interaction) {
  if (interaction?.isAutocomplete?.()) return `autocomplete:/${interaction.commandName || "unknown"}`;
  if (interaction?.isChatInputCommand?.()) return `command:/${interaction.commandName || "unknown"}`;
  if (interaction?.isButton?.()) return `button:${interaction.customId || "unknown"}`;
  return "interaction:unknown";
}

function classifyDiscordError(error) {
  if (isUnknownInteractionError(error)) return "unknown-interaction";
  if (isUnknownMessageError(error)) return "unknown-message";
  if (isDiscordNetworkError(error)) return "network";
  const code = getDiscordErrorCode(error);
  return code ? `discord-${code}` : "other";
}

class DiscordErrorReporter {
  constructor(options = {}) {
    this.windowMs = options.windowMs || 30_000;
    this.sink = options.sink || console;
    this.entries = new Map();
  }

  report(scope, error, details = {}) {
    const category = classifyDiscordError(error);
    const label = details.label ? ` ${details.label}` : "";
    const key = `${scope}:${category}:${label}`;
    const existing = this.entries.get(key);

    if (existing) {
      existing.suppressed += 1;
      return false;
    }

    const age = Number.isFinite(details.ageMs) ? `, age=${details.ageMs}ms` : "";
    const code = getDiscordErrorCode(error);
    const codeText = code ? `, code=${code}` : "";
    const message = getErrorMessage(error) || String(error);
    this.sink.warn(`[DISCORD/${scope}]${label} ${message}${codeText}${age}`);

    const entry = { suppressed: 0, timer: null };
    entry.timer = setTimeout(() => {
      if (entry.suppressed > 0) {
        this.sink.warn(
          `[DISCORD/${scope}]${label} Đã gộp thêm ${entry.suppressed} lỗi ${category} giống nhau trong ${Math.round(this.windowMs / 1000)} giây.`
        );
      }
      this.entries.delete(key);
    }, this.windowMs);
    entry.timer.unref?.();
    this.entries.set(key, entry);
    return true;
  }
}

const discordErrorReporter = new DiscordErrorReporter();

module.exports = {
  DiscordErrorReporter,
  classifyDiscordError,
  discordErrorReporter,
  getDiscordErrorCode,
  getErrorMessage,
  getInteractionAgeMs,
  getInteractionLabel,
  isDiscordNetworkError,
  isUnknownInteractionError,
  isUnknownMessageError,
};
