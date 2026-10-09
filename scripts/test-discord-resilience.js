const assert = require("node:assert/strict");
const {
  DiscordErrorReporter,
  classifyDiscordError,
  getDiscordErrorCode,
  isDiscordNetworkError,
  isUnknownInteractionError,
} = require("../src/utils/discordErrors");
const {
  INITIAL_RESPONSE_SAFETY_LIMIT_MS,
  handleInteractionError,
} = require("../src/core/interactionErrorHandler");

function createConnectTimeoutError() {
  const cause = new Error("Connect Timeout Error (attempted address: discord.com:443, timeout: 2000ms)");
  cause.name = "ConnectTimeoutError";
  cause.code = "UND_ERR_CONNECT_TIMEOUT";
  return new TypeError("fetch failed", { cause });
}

function createInteraction(options = {}) {
  const calls = [];
  const interaction = {
    commandName: "play",
    createdTimestamp: options.createdTimestamp ?? Date.now(),
    replied: Boolean(options.replied),
    deferred: Boolean(options.deferred),
    isAutocomplete: () => false,
    isButton: () => false,
    isChatInputCommand: () => true,
    isRepliable: () => true,
    async reply(payload) {
      calls.push({ method: "reply", payload });
    },
    async editReply(payload) {
      calls.push({ method: "editReply", payload });
    },
    async followUp(payload) {
      calls.push({ method: "followUp", payload });
    },
  };
  return { calls, interaction };
}

async function testErrorClassification() {
  const timeout = createConnectTimeoutError();
  assert.equal(isDiscordNetworkError(timeout), true);
  assert.equal(classifyDiscordError(timeout), "network");

  const unknown = new Error("Unknown interaction");
  unknown.code = 10062;
  assert.equal(getDiscordErrorCode(unknown), 10062);
  assert.equal(isUnknownInteractionError(unknown), true);
  assert.equal(classifyDiscordError(unknown), "unknown-interaction");
}

async function testExpiredInteractionIsNotRetried() {
  const { calls, interaction } = createInteraction({
    createdTimestamp: Date.now() - INITIAL_RESPONSE_SAFETY_LIMIT_MS - 100,
  });
  const handled = await handleInteractionError(
    interaction,
    createConnectTimeoutError(),
    (message) => ({ message })
  );

  assert.equal(handled, false);
  assert.equal(calls.length, 0);
}

async function testUnknownInteractionIsNotRetried() {
  const { calls, interaction } = createInteraction();
  const unknown = new Error("Unknown interaction");
  unknown.code = 10062;
  const handled = await handleInteractionError(interaction, unknown, (message) => ({ message }));

  assert.equal(handled, false);
  assert.equal(calls.length, 0);
}

async function testFreshAndDeferredErrorResponses() {
  const fresh = createInteraction();
  const freshHandled = await handleInteractionError(
    fresh.interaction,
    new Error("Lỗi mô phỏng"),
    (message) => ({ message })
  );
  assert.equal(freshHandled, true);
  assert.equal(fresh.calls.length, 1);
  assert.equal(fresh.calls[0].method, "reply");

  const deferred = createInteraction({
    createdTimestamp: Date.now() - 10_000,
    deferred: true,
  });
  const deferredHandled = await handleInteractionError(
    deferred.interaction,
    new Error("Lỗi sau defer"),
    (message) => ({ message })
  );
  assert.equal(deferredHandled, true);
  assert.equal(deferred.calls.length, 1);
  assert.equal(deferred.calls[0].method, "editReply");
  assert.equal("ephemeral" in deferred.calls[0].payload, false);
}

async function testDuplicateLogCollapsing() {
  const warnings = [];
  const reporter = new DiscordErrorReporter({
    windowMs: 15,
    sink: { warn: (message) => warnings.push(message) },
  });
  const error = createConnectTimeoutError();

  reporter.report("TEST", error, { label: "same" });
  reporter.report("TEST", error, { label: "same" });
  reporter.report("TEST", error, { label: "same" });
  assert.equal(warnings.length, 1);

  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(warnings.length, 2);
  assert.match(warnings[1], /Đã gộp thêm 2 lỗi/);
}

async function main() {
  await testErrorClassification();
  await testExpiredInteractionIsNotRetried();
  await testUnknownInteractionIsNotRetried();
  await testFreshAndDeferredErrorResponses();
  await testDuplicateLogCollapsing();
  console.log("[TEST] Discord REST + interaction resilience OK (5 scenarios).");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
