const {
  createAudioPlayer,
  createAudioResource,
  joinVoiceChannel,
  entersState,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  NoSubscriberBehavior,
} = require("@discordjs/voice");
const GuildQueue = require("./queue");
const AudioResolver = require("./audioResolver");
const EmbedBuilderUtil = require("../utils/embedBuilder");
const Persist247Service = require("./persist247");
const { config } = require("../config/env");
const { discordErrorReporter } = require("../utils/discordErrors");

class MusicManager {
  constructor(client, dependencies = {}) {
    this.client = client;
    this.queues = new Map();
    this.voice = {
      createAudioPlayer: dependencies.createAudioPlayer || createAudioPlayer,
      createAudioResource: dependencies.createAudioResource || createAudioResource,
      joinVoiceChannel: dependencies.joinVoiceChannel || joinVoiceChannel,
      entersState: dependencies.entersState || entersState,
    };
    this.persist247 = dependencies.persist247Service || Persist247Service;
    this.reconnectTimers = new Map();
    this.reconnectAttempts = new Map();
    this.reconnectBaseDelayMs = dependencies.reconnectBaseDelayMs || 3000;
  }

  getQueue(guildId) {
    return this.queues.get(guildId) || null;
  }

  getOrCreateQueue(guildId, options = {}) {
    let queue = this.queues.get(guildId);
    if (!queue) {
      queue = new GuildQueue(guildId, options);
      this.queues.set(guildId, queue);
    }
    if (options.textChannel) queue.textChannel = options.textChannel;
    if (options.voiceChannel) queue.voiceChannel = options.voiceChannel;
    return queue;
  }

  async joinVoice(voiceChannel, textChannel) {
    const guildId = voiceChannel.guild.id;
    const queue = this.getOrCreateQueue(guildId, { textChannel, voiceChannel });
    this.clearReconnectTimer(guildId);
    // Mark the queue as "joining" so the auto-leave-on-empty handler does not
    // abandon the channel while the gateway is still confirming the join.
    queue.isJoining = true;

    try {
      let connection = queue.connection;
      if (!connection || connection.state.status === VoiceConnectionStatus.Destroyed) {
        connection = this.createConnection(voiceChannel, guildId);
        queue.connection = connection;
      } else {
        const mustRejoin =
          connection.joinConfig?.channelId !== voiceChannel.id ||
          connection.state.status === VoiceConnectionStatus.Disconnected;

        if (mustRejoin) {
          const accepted = connection.rejoin({ channelId: voiceChannel.id, selfDeaf: true });
          if (!accepted) {
            connection.destroy();
            connection = this.createConnection(voiceChannel, guildId);
            queue.connection = connection;
          }
        }
      }

      try {
        await this.voice.entersState(connection, VoiceConnectionStatus.Ready, 20_000);
      } catch (error) {
        if (queue.connection === connection && connection.state.status !== VoiceConnectionStatus.Ready) {
          if (connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy();
          queue.connection = null;
          if (this.persist247.is247(guildId)) this.schedule247Reconnect(guildId);
          else this.destroyQueue(guildId);
        }
        throw new Error(`Không thể kết nối voice trong 20 giây: ${error.message}`);
      }

      if (!queue.player) {
        const player = this.voice.createAudioPlayer({
          behaviors: {
            noSubscriber: NoSubscriberBehavior.Play,
          },
        });

        player.on(AudioPlayerStatus.Playing, () => {
          queue.isPlaying = true;
          queue.isPaused = false;
          if (!queue.playbackStartTime) queue.playbackStartTime = Date.now();
          this.clearIdleTimer(queue);
        });

        player.on(AudioPlayerStatus.Idle, (oldState) => {
          if (!oldState?.resource || queue.resource !== oldState.resource) return;

          const endContext = queue.pendingEndContext || { reason: "ended" };
          queue.pendingEndContext = null;
          queue.resource = null;
          queue.isPlaying = false;
          queue.isPaused = false;
          this.stopProgressUpdater(guildId);
          this.advanceQueue(guildId, endContext).catch((error) => {
            console.error(`[QUEUE ADVANCE ERROR in Guild ${guildId}]: ${error.message}`);
          });
        });

        player.on("error", (error) => {
          console.error(`[AUDIO-PLAYER ERROR in Guild ${guildId}]: ${error.message}`);
          queue.resource = null;
          this.advanceQueue(guildId, {
            reason: "error",
            errorMessage: `Gián đoạn phát âm thanh: ${error.message}`,
          }).catch((advanceError) => {
            console.error(`[QUEUE ERROR RECOVERY in Guild ${guildId}]: ${advanceError.message}`);
          });
        });

        queue.player = player;
      }

      connection.subscribe(queue.player);
      this.reconnectAttempts.delete(guildId);

      // Gửi Trạm Điều Khiển Main nếu bot tham gia phòng mà chưa có bài phát
      if (textChannel && !queue.isPlaying && !queue.currentTrack) {
        this.sendMainController(guildId).catch(() => null);
      }

      return queue;
    } finally {
      queue.isJoining = false;
    }
  }

  createConnection(voiceChannel, guildId) {
    const connection = this.voice.joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: true,
    });

    connection.on(VoiceConnectionStatus.Disconnected, () => {
      this.handleDisconnectedConnection(guildId, connection).catch((error) => {
        console.error(`[VOICE DISCONNECT ERROR in Guild ${guildId}]: ${error.message}`);
      });
    });
    return connection;
  }

  async handleDisconnectedConnection(guildId, connection) {
    const queue = this.getQueue(guildId);
    if (!queue || queue.connection !== connection) return;

    try {
      await Promise.race([
        this.voice.entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        this.voice.entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
      return;
    } catch (_) {
      if (queue.connection !== connection) return;
    }

    if (!this.persist247.is247(guildId)) {
      this.destroyQueue(guildId);
      return;
    }

    if (connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy();
    if (queue.connection === connection) queue.connection = null;
    this.schedule247Reconnect(guildId);
  }

  schedule247Reconnect(guildId) {
    if (this.reconnectTimers.has(guildId) || !this.persist247.is247(guildId)) return;

    const attempt = (this.reconnectAttempts.get(guildId) || 0) + 1;
    this.reconnectAttempts.set(guildId, attempt);
    const delay = Math.min(this.reconnectBaseDelayMs * (2 ** (attempt - 1)), 30_000);
    const timer = setTimeout(async () => {
      this.reconnectTimers.delete(guildId);
      if (!this.persist247.is247(guildId)) {
        this.reconnectAttempts.delete(guildId);
        return;
      }

      try {
        const connected = await this.reconnect247(guildId);
        if (!connected) throw new Error("Không tìm thấy server hoặc kênh voice đã lưu.");
        this.reconnectAttempts.delete(guildId);
      } catch (error) {
        console.error(`[24/7 RECONNECT ERROR for guild ${guildId}]: ${error.message}`);
        this.schedule247Reconnect(guildId);
      }
    }, delay);
    timer.unref?.();
    this.reconnectTimers.set(guildId, timer);
  }

  clearReconnectTimer(guildId) {
    const timer = this.reconnectTimers.get(guildId);
    if (timer) clearTimeout(timer);
    this.reconnectTimers.delete(guildId);
  }

  isLifecycleCurrent(guildId, queue, lifecycleId, track = null) {
    const liveQueue = this.getQueue(guildId);
    return Boolean(
      liveQueue === queue &&
      queue.lifecycleId === lifecycleId &&
      (!track || queue.currentTrack === track)
    );
  }

  async closeCurrentTrackMessage(queue, track, context, nextTrack) {
    const message = queue.currentTrackMessage;
    queue.currentTrackMessage = null;
    if (!message) return;

    // Tự động xóa embed cũ của bài trước khi chuyển sang bài mới để không làm trôi/rác kênh chat
    if (typeof message.delete === "function") {
      await message.delete().catch(() => null);
    } else if (typeof message.edit === "function") {
      let embed;
      if (context?.reason === "skipped") {
        embed = EmbedBuilderUtil.createSkippedEmbed(track, {
          skippedBy: context.actor,
          nextTrack,
        });
      } else if (context?.reason === "error") {
        embed = EmbedBuilderUtil.createPlaybackErrorEmbed(track, context.errorMessage);
      } else {
        embed = EmbedBuilderUtil.createTrackEndedEmbed(track, { nextTrack });
      }
      await message.edit({ embeds: [embed], components: [] }).catch((error) => {
        discordErrorReporter.report("EMBED", error, { label: "close-previous-track" });
      });
    }
  }

  async createTransitionMessage(queue, track, options = {}) {
    const isInitial = Boolean(options.isInitial);
    const embed = isInitial
      ? EmbedBuilderUtil.createPreparingEmbed(track, queue)
      : EmbedBuilderUtil.createTransitionEmbed(track, queue);
    let message = null;

    if (queue.lastInteraction) {
      const interaction = queue.lastInteraction;
      queue.lastInteraction = null;
      message = await interaction.editReply({ embeds: [embed], components: [] }).catch((error) => {
        discordErrorReporter.report("EMBED", error, { label: "transition-interaction" });
        return null;
      });
    }

    if (!message && queue.textChannel) {
      message = await queue.textChannel.send({ embeds: [embed], components: [] }).catch((error) => {
        discordErrorReporter.report("EMBED", error, { label: "transition-message" });
        return null;
      });
    }

    queue.currentTrackMessage = message;
    return message;
  }

  async prebufferAudioStream(stream, minBytes = 32768, maxWaitMs = 1000) {
    if (!stream) return;
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
      if (stream.destroyed) break;
      const currentLength = typeof stream.readableLength === "number" ? stream.readableLength : 0;
      if (currentLength >= minBytes) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  async playTrack(guildId, track, lifecycleId) {
    const queue = this.getQueue(guildId);
    if (!queue) return false;

    try {
      this.clearIdleTimer(queue);
      this.stopProgressUpdater(guildId);

      const audioStreamData = await AudioResolver.getAudioStream(track);
      if (!this.isLifecycleCurrent(guildId, queue, lifecycleId, track)) {
        audioStreamData.stream?.destroy?.();
        return false;
      }

      // Pre-buffering: Cho luồng nạp đệm trước (tối thiểu 32KB hoặc tối đa 1000ms)
      // để loại bỏ hoàn toàn hiện tượng vấp/giật âm thanh do thiếu hụt dữ liệu (buffer underrun)
      await this.prebufferAudioStream(audioStreamData.stream, 32768, 1000);
      if (!this.isLifecycleCurrent(guildId, queue, lifecycleId, track)) {
        audioStreamData.stream?.destroy?.();
        return false;
      }

      const resource = this.voice.createAudioResource(audioStreamData.stream, {
        inputType: audioStreamData.type,
        inlineVolume: false,
      });

      queue.resource = resource;
      queue.playbackStartTime = 0;
      queue.pausedAt = 0;
      queue.player.play(resource);
      await this.voice.entersState(queue.player, AudioPlayerStatus.Playing, 15_000);

      if (!this.isLifecycleCurrent(guildId, queue, lifecycleId, track)) return false;

      queue.isPlaying = true;
      queue.isPaused = false;
      queue.playbackStartTime = Date.now();

      const embed = EmbedBuilderUtil.createNowPlayingEmbed(queue);
      const row = EmbedBuilderUtil.createControllerRow(queue);

      // Tự động xóa tin nhắn cũ (nếu có) và gửi tin nhắn mới xuống cuối kênh chat
      if (queue.currentTrackMessage) {
        const oldMsg = queue.currentTrackMessage;
        queue.currentTrackMessage = null;
        if (typeof oldMsg.delete === "function") {
          await oldMsg.delete().catch(() => null);
        }
      }

      if (queue.textChannel) {
        queue.currentTrackMessage = await queue.textChannel.send({
          embeds: [embed],
          components: [row],
        }).catch(() => null);
      }

      this.startProgressUpdater(guildId, lifecycleId);
      return true;
    } catch (err) {
      if (!this.isLifecycleCurrent(guildId, queue, lifecycleId, track)) return false;

      console.error(`[PLAY TRACK ERROR]: ${err.message}`);
      queue.resource = null;
      queue.isPlaying = false;
      queue.isPaused = false;
      queue.player?.stop();

      const errorEmbed = EmbedBuilderUtil.createPlaybackErrorEmbed(track, err.message);
      const failedMessage = queue.currentTrackMessage;
      queue.currentTrackMessage = null;

      if (failedMessage) {
        await failedMessage.edit({ embeds: [errorEmbed], components: [] }).catch(() => null);
      } else if (queue.textChannel) {
        await queue.textChannel.send({ embeds: [errorEmbed], components: [] }).catch(() => null);
      }

      return false;
    }
  }

  async advanceQueue(guildId, context = { reason: "ended" }) {
    const queue = this.getQueue(guildId);
    if (!queue || queue.isTransitioning) return false;

    queue.isTransitioning = true;
    const lifecycleId = ++queue.lifecycleId;
    this.stopProgressUpdater(guildId);
    queue.isPlaying = false;
    queue.isPaused = false;

    try {
      const finishedTrack = queue.currentTrack;
      const ignoreCurrentLoop = context.reason === "skipped" || context.reason === "error";
      let nextTrack = queue.getNextTrack({ ignoreCurrentLoop });

      await this.closeCurrentTrackMessage(queue, finishedTrack, context, nextTrack);
      if (!this.isLifecycleCurrent(guildId, queue, lifecycleId)) return false;

      const isInitialPlay = !finishedTrack || context.reason === "play" || Boolean(context.isInitial);

      while (nextTrack) {
        await this.createTransitionMessage(queue, nextTrack, { isInitial: isInitialPlay });
        if (!this.isLifecycleCurrent(guildId, queue, lifecycleId, nextTrack)) return false;

        const started = await this.playTrack(guildId, nextTrack, lifecycleId);
        if (started) return true;
        if (!this.isLifecycleCurrent(guildId, queue, lifecycleId)) return false;

        queue.currentTrack = null;
        nextTrack = queue.getNextTrack({ ignoreCurrentLoop: true });
      }

      queue.currentTrack = null;
      if (queue.currentTrackMessage) {
        const oldMsg = queue.currentTrackMessage;
        queue.currentTrackMessage = null;
        if (typeof oldMsg.delete === "function") {
          await oldMsg.delete().catch(() => null);
        } else if (typeof oldMsg.edit === "function") {
          const endedEmbed = EmbedBuilderUtil.createQueueEndedEmbed();
          await oldMsg.edit({ embeds: [endedEmbed], components: [] }).catch(() => null);
        }
      }
      queue.resource = null;
      queue.isPlaying = false;

      // A playlist can still be fetching tracks after its first song started.
      // Keep the queue alive; the background loader will resume it when a new
      // batch arrives (or start the normal idle timer once loading is done).
      if (queue.activePlaylistLoads > 0) {
        return false;
      }

      // Hàng đợi đã phát xong, nếu bot vẫn ở trong voice thì gửi lại Trạm Điều Khiển Main ở cuối chat
      if (queue.voiceChannel && queue.textChannel) {
        await this.sendMainController(guildId).catch(() => null);
      }

      this.startIdleTimer(guildId);
      return false;
    } finally {
      if (this.getQueue(guildId) === queue && queue.lifecycleId === lifecycleId) {
        queue.isTransitioning = false;
      }
    }
  }

  async playNext(guildId, options = {}) {
    return this.advanceQueue(guildId, { reason: "ended", ...options });
  }

  async stop(guildId, options = {}) {
    const queue = this.getQueue(guildId);
    if (!queue) return false;

    if (typeof options === "boolean") options = { leaveVoice: options };
    const leaveVoice = options.leaveVoice !== false;
    const stoppedBy = options.stoppedBy || "Không xác định";

    ++queue.lifecycleId;
    queue.isTransitioning = false;
    this.stopProgressUpdater(guildId);
    const currentTrack = queue.currentTrack;
    const currentMessage = queue.currentTrackMessage;
    const clearedCount = queue.tracks.length;
    queue.clear();
    queue.currentTrack = null;
    queue.currentTrackMessage = null;
    queue.pendingEndContext = null;
    queue.resource = null;
    queue.isPlaying = false;
    queue.isPaused = false;
    queue.playbackStartTime = 0;
    if (queue.player) queue.player.stop();

    if (currentMessage) {
      if (typeof currentMessage.delete === "function") {
        await currentMessage.delete().catch(() => null);
      } else if (typeof currentMessage.edit === "function" && currentTrack) {
        const stoppedEmbed = EmbedBuilderUtil.createStoppedEmbed(currentTrack, {
          stoppedBy,
          clearedCount,
        });
        await currentMessage.edit({ embeds: [stoppedEmbed], components: [] }).catch((error) => {
          discordErrorReporter.report("EMBED", error, { label: "stop-message" });
        });
      }
    }

    if (leaveVoice && !this.persist247.is247(guildId)) {
      this.destroyQueue(guildId);
    } else {
      // Nếu bot vẫn ở lại voice (24/7 hoặc chưa rời), gửi lại Trạm Điều Khiển Main
      await this.sendMainController(guildId).catch(() => null);
    }
    return true;
  }

  pause(guildId) {
    const queue = this.getQueue(guildId);
    if (!queue || !queue.isPlaying || queue.isPaused) return false;
    queue.pausedAt = Date.now();
    queue.isPaused = true;
    return queue.player ? queue.player.pause() : false;
  }

  resume(guildId) {
    const queue = this.getQueue(guildId);
    if (!queue || !queue.isPlaying || !queue.isPaused) return false;
    if (queue.pausedAt > 0) {
      queue.playbackStartTime += Date.now() - queue.pausedAt;
      queue.pausedAt = 0;
    }
    queue.isPaused = false;
    return queue.player ? queue.player.unpause() : false;
  }

  async skip(guildId, options = {}) {
    const queue = this.getQueue(guildId);
    if (!queue || !queue.currentTrack || queue.isTransitioning || queue.pendingEndContext) return null;

    const skippedTrack = queue.currentTrack;
    queue.pendingEndContext = {
      reason: "skipped",
      actor: options.skippedBy || "Không xác định",
    };

    const stopped = queue.player ? queue.player.stop() : false;
    if (!stopped) {
      queue.resource = null;
      const context = queue.pendingEndContext;
      queue.pendingEndContext = null;
      await this.advanceQueue(guildId, context);
    }

    return skippedTrack;
  }

  shuffle(guildId) {
    const queue = this.getQueue(guildId);
    if (!queue) return false;
    queue.shuffle();
    return true;
  }

  setLoop(guildId, mode) {
    const queue = this.getQueue(guildId);
    if (!queue) return "off";
    return queue.setLoop(mode);
  }

  /**
   * Live 7-Second Progress Bar Updater
   */
  startProgressUpdater(guildId, lifecycleId = null) {
    const queue = this.getQueue(guildId);
    if (!queue) return;

    this.stopProgressUpdater(guildId);
    const expectedLifecycleId = lifecycleId ?? queue.lifecycleId;
    const trackMessage = queue.currentTrackMessage;

    queue.progressInterval = setInterval(async () => {
      if (
        queue.lifecycleId !== expectedLifecycleId ||
        queue.currentTrackMessage !== trackMessage
      ) {
        this.stopProgressUpdater(guildId);
        return;
      }

      if (!queue.isPlaying || queue.isPaused || !queue.currentTrack || !trackMessage) {
        return;
      }

      try {
        const embed = EmbedBuilderUtil.createNowPlayingEmbed(queue);
        const row = EmbedBuilderUtil.createControllerRow(queue);
        await trackMessage.edit({
          embeds: [embed],
          components: [row],
        });
      } catch (err) {
        // If message was deleted by user, stop updater
        if (err.code === 10008) {
          this.stopProgressUpdater(guildId);
          if (queue.currentTrackMessage === trackMessage) {
            queue.currentTrackMessage = null;
          }
        }
      }
    }, 7000);
  }

  async refreshNowPlayingMessage(guildId) {
    const queue = this.getQueue(guildId);
    if (!queue?.currentTrack || !queue.currentTrackMessage) return false;

    const embed = EmbedBuilderUtil.createNowPlayingEmbed(queue);
    const row = EmbedBuilderUtil.createControllerRow(queue);
    await queue.currentTrackMessage.edit({
      embeds: [embed],
      components: [row],
    }).catch(() => null);
    return true;
  }

  stopProgressUpdater(guildId) {
    const queue = this.getQueue(guildId);
    if (!queue) return;
    if (queue.progressInterval) {
      clearInterval(queue.progressInterval);
      queue.progressInterval = null;
    }
  }

  startIdleTimer(guildId) {
    const queue = this.getQueue(guildId);
    if (!queue) return;
    this.clearIdleTimer(queue);

    // If 24/7 mode is active, NEVER leave the voice channel
    if (this.persist247.is247(guildId)) {
      return;
    }

    queue.idleTimer = setTimeout(() => {
      this.destroyQueue(guildId);
    }, config.idleTimeoutSeconds * 1000);
  }

  clearIdleTimer(queue) {
    if (queue.idleTimer) {
      clearTimeout(queue.idleTimer);
      queue.idleTimer = null;
    }
  }

  destroyQueue(guildId) {
    const queue = this.queues.get(guildId);
    if (!queue) return;
    ++queue.lifecycleId;
    queue.isTransitioning = false;
    queue.resource = null;
    queue.pendingEndContext = null;
    this.stopProgressUpdater(guildId);
    this.clearIdleTimer(queue);
    this.clearReconnectTimer(guildId);
    this.reconnectAttempts.delete(guildId);
    if (queue.connection) {
      queue.connection.destroy();
    }
    this.queues.delete(guildId);
  }

  /**
   * Tear down every active queue and timer. Invoked on graceful shutdown so the
   * voice connections are closed and no stray intervals keep the process alive
   * (which would otherwise delay or block a clean restart on hosting).
   */
  destroyAll() {
    for (const guildId of [...this.queues.keys()]) {
      try {
        this.destroyQueue(guildId);
      } catch (error) {
        console.error(`[SHUTDOWN] Lỗi khi dọn hàng đợi guild ${guildId}: ${error.message}`);
      }
    }
    for (const timer of this.reconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.reconnectTimers.clear();
    this.reconnectAttempts.clear();
  }

  async autoJoinAll247Guilds() {
    const all247 = this.persist247.getAll();
    for (const [guildId, data] of Object.entries(all247)) {
      if (!data.enabled || !data.channelId) continue;
      try {
        const guild = await this.client.guilds.fetch(guildId).catch(() => null);
        if (!guild) throw new Error("Không tìm thấy server đã lưu.");
        const voiceChannel = await guild.channels.fetch(data.channelId).catch(() => null);
        if (!voiceChannel || !voiceChannel.isVoiceBased()) {
          throw new Error("Không tìm thấy kênh voice 24/7 đã lưu.");
        }

        let textChannel = null;
        if (data.textChannelId) {
          textChannel = await guild.channels.fetch(data.textChannelId).catch(() => null);
        }

        await this.joinVoice(voiceChannel, textChannel);

        // Khi khởi động lại bot: Quét xóa sạch các Embed Main cũ bị bỏ lại và gửi Embed Main mới toanh
        if (textChannel) {
          await this.sendMainController(guildId).catch(() => null);
        }

        console.log(`[24/7] Đã tự động kết nối lại kênh voice #${voiceChannel.name} trên server "${guild.name}" và làm mới Trạm Điều Khiển`);
      } catch (err) {
        console.error(`[24/7 RECONNECT ERROR for guild ${guildId}]: ${err.message}`);
        this.schedule247Reconnect(guildId);
      }
    }
  }

  async reconnect247(guildId) {
    const data = this.persist247.get(guildId);
    if (!data || !data.enabled || !data.channelId) return false;

    const guild = await this.client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return false;
    const voiceChannel = await guild.channels.fetch(data.channelId).catch(() => null);
    if (!voiceChannel || !voiceChannel.isVoiceBased?.()) return false;
    const textChannel = data.textChannelId
      ? await guild.channels.fetch(data.textChannelId).catch(() => null)
      : null;
    await this.joinVoice(voiceChannel, textChannel);
    if (textChannel) {
      await this.sendMainController(guildId).catch(() => null);
    }
    console.log(`[24/7] Đã kết nối lại kênh voice #${voiceChannel.name}`);
    return true;
  }

  /**
   * Quét và dọn sạch các tin nhắn/embed điều khiển cũ của bot trong kênh chat
   * (Đặc biệt hiệu quả khi bot khởi động lại để không bị trùng lặp các embed cũ)
   */
  async cleanupOldControllerMessages(textChannel) {
    if (!textChannel || typeof textChannel.messages?.fetch !== "function") return;
    try {
      const fetched = await textChannel.messages.fetch({ limit: 30 }).catch(() => null);
      if (!fetched || fetched.size === 0) return;

      const botId = this.client.user?.id;
      const oldMessagesToDelete = fetched.filter((msg) => {
        if (msg.author.id !== botId) return false;
        const hasMusicEmbed = msg.embeds?.some(
          (e) =>
            (e.title &&
              (e.title.includes("Trạm Điều Khiển") ||
                e.title.includes("Đang Phát") ||
                e.title.includes("Chuẩn Bị Phát") ||
                e.title.includes("Đang Xử Lý") ||
                e.title.includes("Chuyển Sang Bài") ||
                e.title.includes("Nhạc Đã Được Dừng") ||
                e.title.includes("Bài Hát Đã Kết Thúc"))) ||
            (e.footer?.text && e.footer.text.includes("AB-VNA"))
        );
        const hasMusicButtons = msg.components?.some((row) =>
          row.components?.some((comp) => comp.customId?.startsWith("music_"))
        );
        return hasMusicEmbed || hasMusicButtons;
      });

      for (const [, oldMsg] of oldMessagesToDelete) {
        await oldMsg.delete().catch(() => null);
      }
    } catch (err) {
      console.warn(`[CLEANUP] Không thể dọn dẹp tin nhắn cũ: ${err.message}`);
    }
  }

  async sendMainController(guildId) {
    const queue = this.getQueue(guildId);
    if (!queue || !queue.textChannel) return null;

    if (queue.currentTrackMessage) {
      const old = queue.currentTrackMessage;
      queue.currentTrackMessage = null;
      if (typeof old.delete === "function") {
        await old.delete().catch(() => null);
      }
    }

    // Tự động quét và xóa sạch các embed điều khiển cũ (kể cả từ phiên chạy trước khi restart)
    await this.cleanupOldControllerMessages(queue.textChannel);

    const embed = EmbedBuilderUtil.createMainControllerEmbed(queue.voiceChannel);
    const row = EmbedBuilderUtil.createMainControllerRow();
    queue.currentTrackMessage = await queue.textChannel.send({
      embeds: [embed],
      components: [row],
    }).catch(() => null);
    return queue.currentTrackMessage;
  }
}

module.exports = MusicManager;
