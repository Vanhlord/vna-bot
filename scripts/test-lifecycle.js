const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { VoiceConnectionStatus } = require("@discordjs/voice");
const MusicManager = require("../src/core/musicManager");
const EmbedBuilderUtil = require("../src/utils/embedBuilder");

function createTrack(title, requestedBy) {
  return {
    title,
    url: `https://example.com/${encodeURIComponent(title)}`,
    author: "Test Artist",
    duration: "03:30",
    durationSec: 210,
    thumbnail: "https://example.com/cover.jpg",
    requestedBy,
  };
}

function createFakeMessage(name) {
  return {
    name,
    edits: [],
    async edit(payload) {
      this.edits.push(payload);
      return this;
    },
  };
}

function createFakeChannel() {
  return {
    sent: [],
    async send(payload) {
      const message = createFakeMessage(`message-${this.sent.length + 1}`);
      message.initialPayload = payload;
      this.sent.push(message);
      return message;
    },
  };
}

function getEmbedTitle(payload) {
  return payload.embeds[0].toJSON().title;
}

function getEmbedFields(payload) {
  return payload.embeds[0].toJSON().fields || [];
}

class FakeVoiceConnection extends EventEmitter {
  constructor(channelId) {
    super();
    this.joinConfig = { channelId };
    this.state = { status: VoiceConnectionStatus.Ready };
    this.rejoinCalls = [];
    this.subscriptions = [];
    this.destroyed = false;
  }

  rejoin(config) {
    this.rejoinCalls.push(config);
    this.joinConfig = { ...this.joinConfig, ...config };
    this.state = { status: VoiceConnectionStatus.Ready };
    return true;
  }

  subscribe(player) {
    this.subscriptions.push(player);
    return { player };
  }

  destroy() {
    this.destroyed = true;
    this.state = { status: VoiceConnectionStatus.Destroyed };
  }
}

function createVoiceChannel(guild, id, name = id) {
  return {
    id,
    name,
    guild,
    isVoiceBased: () => true,
  };
}

async function testExistingConnectionMovesToRequestedChannel() {
  const persist247Service = { is247: () => false };
  const manager = new MusicManager({}, {
    entersState: async (target, status) => {
      assert.equal(status, VoiceConnectionStatus.Ready);
      return target;
    },
    persist247Service,
  });
  const guild = { id: "guild-move", voiceAdapterCreator: {} };
  const oldConnection = new FakeVoiceConnection("voice-a");
  const player = { id: "player-move" };
  const queue = manager.getOrCreateQueue(guild.id, {
    voiceChannel: createVoiceChannel(guild, "voice-a"),
  });
  queue.connection = oldConnection;
  queue.player = player;

  const result = await manager.joinVoice(createVoiceChannel(guild, "voice-b"), null);

  assert.equal(result, queue);
  assert.equal(oldConnection.rejoinCalls.length, 1);
  assert.equal(oldConnection.rejoinCalls[0].channelId, "voice-b");
  assert.equal(oldConnection.joinConfig.channelId, "voice-b");
  assert.equal(queue.voiceChannel.id, "voice-b");
  assert.equal(oldConnection.subscriptions.at(-1), player);
}

async function test247ReconnectReplacesDeadConnection() {
  const guildId = "guild-reconnect";
  const oldConnection = new FakeVoiceConnection("voice-old");
  oldConnection.state = { status: VoiceConnectionStatus.Disconnected };
  const newConnection = new FakeVoiceConnection("voice-saved");
  const player = { id: "player-reconnect" };
  const persisted = {
    enabled: true,
    channelId: "voice-saved",
    textChannelId: "text-saved",
  };
  const persist247Service = {
    get: () => persisted,
    getAll: () => ({ [guildId]: persisted }),
    is247: () => true,
  };
  const guild = {
    id: guildId,
    name: "Reconnect Guild",
    voiceAdapterCreator: {},
    channels: { fetch: async () => null },
  };
  const savedVoiceChannel = createVoiceChannel(guild, "voice-saved", "Saved Voice");
  const savedTextChannel = { id: "text-saved" };
  guild.channels.fetch = async (id) => {
    if (id === savedVoiceChannel.id) return savedVoiceChannel;
    if (id === savedTextChannel.id) return savedTextChannel;
    return null;
  };

  const manager = new MusicManager(
    { guilds: { fetch: async () => guild } },
    {
      entersState: async (target, status) => {
        if (
          target === oldConnection &&
          (status === VoiceConnectionStatus.Signalling || status === VoiceConnectionStatus.Connecting)
        ) {
          throw new Error("connection died");
        }
        return target;
      },
      joinVoiceChannel: () => newConnection,
      persist247Service,
      reconnectBaseDelayMs: 1,
    }
  );
  const queue = manager.getOrCreateQueue(guildId, {
    voiceChannel: createVoiceChannel(guild, "voice-old"),
  });
  queue.connection = oldConnection;
  queue.player = player;

  await manager.handleDisconnectedConnection(guildId, oldConnection);
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(oldConnection.destroyed, true);
  assert.equal(queue.connection, newConnection);
  assert.equal(queue.voiceChannel.id, "voice-saved");
  assert.equal(newConnection.subscriptions.at(-1), player);
  assert.equal(manager.reconnectTimers.has(guildId), false);
}

async function testNaturalTransitionUsesNewMessage() {
  const manager = new MusicManager({});
  manager.startIdleTimer = () => {};
  manager.playTrack = async () => true;

  const channel = createFakeChannel();
  const queue = manager.getOrCreateQueue("guild-natural", { textChannel: channel });
  const oldMessage = createFakeMessage("old-track-message");
  const firstTrack = createTrack("Bài thứ nhất", "User A");
  const secondTrack = createTrack("Bài thứ hai", "User B");

  queue.currentTrack = firstTrack;
  queue.currentTrackMessage = oldMessage;
  queue.tracks.push(secondTrack);

  const started = await manager.advanceQueue("guild-natural", { reason: "ended" });

  assert.equal(started, true);
  assert.equal(oldMessage.edits.length, 1);
  assert.equal(getEmbedTitle(oldMessage.edits[0]), "✅ Bài Hát Đã Kết Thúc");
  assert.deepEqual(oldMessage.edits[0].components, []);
  assert.equal(channel.sent.length, 1);
  assert.equal(getEmbedTitle(channel.sent[0].initialPayload), "⏭️ Đang Chuyển Sang Bài Tiếp Theo");
  assert.notEqual(queue.currentTrackMessage, oldMessage);
  assert.equal(queue.currentTrack, secondTrack);
}

async function testQueueEndClosesWithoutNewMessage() {
  const manager = new MusicManager({});
  manager.startIdleTimer = () => {};

  const channel = createFakeChannel();
  const queue = manager.getOrCreateQueue("guild-ended", { textChannel: channel });
  const oldMessage = createFakeMessage("last-track-message");
  queue.currentTrack = createTrack("Bài cuối", "User C");
  queue.currentTrackMessage = oldMessage;

  const started = await manager.advanceQueue("guild-ended", { reason: "ended" });

  assert.equal(started, false);
  assert.equal(getEmbedTitle(oldMessage.edits[0]), "🏁 Hàng Đợi Đã Phát Xong");
  assert.equal(channel.sent.length, 0);
  assert.equal(queue.currentTrackMessage, null);
}

async function testStopIncludesActorAndClearedCount() {
  const manager = new MusicManager({});
  const queue = manager.getOrCreateQueue("guild-stop");
  const message = createFakeMessage("stopped-track-message");
  queue.currentTrack = createTrack("Bài đang phát", "User D");
  queue.currentTrackMessage = message;
  queue.tracks.push(createTrack("Chờ 1", "User E"), createTrack("Chờ 2", "User F"));
  queue.player = { stop: () => true };

  const stopped = await manager.stop("guild-stop", {
    leaveVoice: false,
    stoppedBy: "Moderator A",
  });

  assert.equal(stopped, true);
  assert.equal(getEmbedTitle(message.edits[0]), "⏹️ Nhạc Đã Được Dừng");
  const fields = getEmbedFields(message.edits[0]);
  assert.equal(fields.find((field) => field.name === "Người đã dừng").value, "Moderator A");
  assert.equal(fields.find((field) => field.name === "Đã xóa khỏi hàng đợi").value, "2 bài");
  assert.equal(queue.tracks.length, 0);
  assert.equal(queue.currentTrackMessage, null);
}

async function testSkipClosesOldAndStartsOneNextTrack() {
  const manager = new MusicManager({});
  manager.startIdleTimer = () => {};
  let playCalls = 0;
  manager.playTrack = async () => {
    playCalls += 1;
    return true;
  };

  const channel = createFakeChannel();
  const queue = manager.getOrCreateQueue("guild-skip", { textChannel: channel });
  const oldMessage = createFakeMessage("skipped-track-message");
  const skippedTrack = createTrack("Bài bị skip", "User G");
  const nextTrack = createTrack("Bài kế tiếp", "User H");
  queue.currentTrack = skippedTrack;
  queue.currentTrackMessage = oldMessage;
  queue.tracks.push(nextTrack);
  queue.player = { stop: () => false };

  const result = await manager.skip("guild-skip", { skippedBy: "User I" });

  assert.equal(result, skippedTrack);
  assert.equal(getEmbedTitle(oldMessage.edits[0]), "⏭️ Bài Hát Đã Bị Bỏ Qua");
  assert.equal(playCalls, 1);
  assert.equal(queue.currentTrack, nextTrack);
  assert.equal(channel.sent.length, 1);
}

async function testFailedTrackGetsClosedAndContinues() {
  const manager = new MusicManager({});
  manager.startIdleTimer = () => {};

  const channel = createFakeChannel();
  const queue = manager.getOrCreateQueue("guild-error", { textChannel: channel });
  const oldMessage = createFakeMessage("finished-before-error");
  const failedTrack = createTrack("Bài bị lỗi", "User J");
  const recoveryTrack = createTrack("Bài phát tiếp", "User K");
  queue.currentTrack = createTrack("Bài vừa hết", "User L");
  queue.currentTrackMessage = oldMessage;
  queue.tracks.push(failedTrack, recoveryTrack);

  let playCalls = 0;
  manager.playTrack = async (guildId, track) => {
    playCalls += 1;
    if (track !== failedTrack) return true;

    const failedMessage = queue.currentTrackMessage;
    queue.currentTrackMessage = null;
    await failedMessage.edit({
      embeds: [EmbedBuilderUtil.createPlaybackErrorEmbed(track, "Lỗi mô phỏng")],
      components: [],
    });
    return false;
  };

  const started = await manager.advanceQueue("guild-error", { reason: "ended" });

  assert.equal(started, true);
  assert.equal(playCalls, 2);
  assert.equal(channel.sent.length, 2);
  assert.equal(getEmbedTitle(channel.sent[0].edits[0]), "⚠️ Không Thể Phát Bài Hát");
  assert.equal(getEmbedTitle(channel.sent[1].initialPayload), "⏭️ Đang Chuyển Sang Bài Tiếp Theo");
  assert.equal(queue.currentTrack, recoveryTrack);
  assert.equal(queue.currentTrackMessage, channel.sent[1]);
}

async function testBackgroundPlaylistLoadKeepsQueueAlive() {
  const manager = new MusicManager({});
  let idleTimerStarted = false;
  manager.startIdleTimer = () => {
    idleTimerStarted = true;
  };

  const channel = createFakeChannel();
  const queue = manager.getOrCreateQueue("guild-playlist-background", { textChannel: channel });
  queue.currentTrack = createTrack("Bài đầu tiên", "User M");
  queue.currentTrackMessage = createFakeMessage("first-playlist-track");
  queue.activePlaylistLoads = 1;

  const advancedWhileLoading = await manager.advanceQueue("guild-playlist-background", { reason: "ended" });

  assert.equal(advancedWhileLoading, false);
  assert.equal(queue.currentTrack, null);
  assert.equal(idleTimerStarted, false);

  const nextTrack = createTrack("Bài nạp nền", "User M");
  queue.tracks.push(nextTrack);
  queue.activePlaylistLoads = 0;
  manager.playTrack = async () => true;

  const advancedAfterBatch = await manager.advanceQueue("guild-playlist-background", { reason: "ended" });

  assert.equal(advancedAfterBatch, true);
  assert.equal(queue.currentTrack, nextTrack);
}

async function testInitialPlayUsesPreparingEmbedWithoutTransition() {
  const manager = new MusicManager({});
  manager.startIdleTimer = () => {};
  manager.playTrack = async () => true;

  const channel = createFakeChannel();
  const queue = manager.getOrCreateQueue("guild-initial-play", { textChannel: channel });
  const track = createTrack("Bài mở đầu", "User N");

  queue.tracks.push(track);
  // queue.currentTrack is null (no previous song)

  const started = await manager.playNext("guild-initial-play", { isInitial: true });

  assert.equal(started, true);
  assert.equal(channel.sent.length, 1);
  const initialTitle = getEmbedTitle(channel.sent[0].initialPayload);
  assert.equal(initialTitle, "🎵 Đang Chuẩn Bị Phát Nhạc");
  assert.notEqual(initialTitle, "⏭️ Đang Chuyển Sang Bài Tiếp Theo");
}

async function testInitialPlayEditsInteractionWithoutTransition() {
  const manager = new MusicManager({});
  manager.startIdleTimer = () => {};
  manager.playTrack = async () => true;

  const interactionEdits = [];
  const fakeInteraction = {
    async editReply(payload) {
      interactionEdits.push(payload);
      return createFakeMessage("interaction-reply-msg");
    },
  };

  const queue = manager.getOrCreateQueue("guild-initial-interaction");
  const track = createTrack("Bài gõ lệnh", "User O");
  queue.tracks.push(track);
  queue.lastInteraction = fakeInteraction;

  const started = await manager.playNext("guild-initial-interaction", { isInitial: true });

  assert.equal(started, true);
  assert.equal(interactionEdits.length, 1);
  const initialTitle = getEmbedTitle(interactionEdits[0]);
  assert.equal(initialTitle, "🎵 Đang Chuẩn Bị Phát Nhạc");
  assert.notEqual(initialTitle, "⏭️ Đang Chuyển Sang Bài Tiếp Theo");
}

async function main() {
  await testExistingConnectionMovesToRequestedChannel();
  await test247ReconnectReplacesDeadConnection();
  await testNaturalTransitionUsesNewMessage();
  await testQueueEndClosesWithoutNewMessage();
  await testStopIncludesActorAndClearedCount();
  await testSkipClosesOldAndStartsOneNextTrack();
  await testFailedTrackGetsClosedAndContinues();
  await testBackgroundPlaylistLoadKeepsQueueAlive();
  await testInitialPlayUsesPreparingEmbedWithoutTransition();
  await testInitialPlayEditsInteractionWithoutTransition();
  console.log("[TEST] Voice connection + music lifecycle OK (10 scenarios).");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
