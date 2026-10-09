const express = require("express");
const path = require("node:path");
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
} = require("discord.js");
const { config } = require("../config/env");
const Persist247Service = require("../core/persist247");
const PlaylistService = require("../core/playlistService");
const AudioResolver = require("../core/audioResolver");

function createWebServer(client, musicManager) {
  const app = express();

  app.use(express.json({ limit: "5mb" }));
  app.use(express.urlencoded({ extended: true, limit: "5mb" }));

  // Set views
  app.set("view engine", "ejs");
  app.set("views", path.resolve(__dirname, "views"));

  /**
   * Helper: Get formatted Guilds data with channels, active queue & 24/7 status
   */
  function getGuildsData() {
    const list = [];
    const all247 = Persist247Service.getAll();

    client.guilds.cache.forEach((guild) => {
      const textChannels = [];
      const voiceChannels = [];

      guild.channels.cache.forEach((channel) => {
        // Voice channels
        if (
          (channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice) &&
          channel.viewable
        ) {
          voiceChannels.push({
            id: channel.id,
            name: channel.name,
            userCount: channel.members?.size || 0,
          });
        }

        // Text channels
        if (channel.isTextBased && channel.isTextBased() && channel.viewable) {
          textChannels.push({
            id: channel.id,
            name: channel.name,
          });
        }
      });

      textChannels.sort((a, b) => a.name.localeCompare(b.name));
      voiceChannels.sort((a, b) => a.name.localeCompare(b.name));

      // Active queue details
      const q = musicManager.getQueue(guild.id);
      let activeQueue = null;

      if (q) {
        let currentSec = 0;
        if (q.playbackStartTime && q.isPlaying) {
          currentSec = Math.floor((Date.now() - q.playbackStartTime) / 1000);
          if (q.currentTrack?.durationSec && currentSec > q.currentTrack.durationSec) {
            currentSec = q.currentTrack.durationSec;
          }
        }

        activeQueue = {
          isPlaying: Boolean(q.isPlaying),
          isPaused: Boolean(q.isPaused),
          loopMode: q.loopMode || "off",
          voiceChannelId: q.voiceChannel?.id || "",
          voiceChannelName: q.voiceChannel?.name || "",
          textChannelId: q.textChannel?.id || "",
          currentSec,
          progressBar: q.getProgressBar ? q.getProgressBar(14) : "▰▰▱▱▱▱",
          currentTrack: q.currentTrack
            ? {
                title: q.currentTrack.title,
                url: q.currentTrack.url,
                author: q.currentTrack.author,
                duration: q.currentTrack.duration,
                durationSec: q.currentTrack.durationSec || 0,
                thumbnail: q.currentTrack.thumbnail || "",
                requestedBy: q.currentTrack.requestedBy || "Web",
              }
            : null,
          tracks: (q.tracks || []).slice(0, 50).map((t, idx) => ({
            index: idx + 1,
            title: t.title,
            url: t.url,
            author: t.author,
            duration: t.duration,
            requestedBy: t.requestedBy,
          })),
          totalQueued: (q.tracks || []).length,
        };
      }

      const is247 = Persist247Service.is247(guild.id);
      const conf247 = all247[guild.id] || null;

      list.push({
        id: guild.id,
        name: guild.name,
        icon: guild.iconURL({ size: 64 }) || "",
        memberCount: guild.memberCount || 0,
        textChannels,
        voiceChannels,
        activeQueue,
        is247,
        channel247Id: conf247?.channelId || "",
      });
    });

    list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }

  // ========================================================
  // 1. DASHBOARD MAIN ROUTE
  // ========================================================
  app.get(["/", "/embed", "/dashboard"], (req, res) => {
    try {
      const guilds = getGuildsData();
      const all247 = Persist247Service.getAll();
      const playlists = PlaylistService.listPlaylists();

      // Collect summary active queues
      const activeQueues = [];
      guilds.forEach((g) => {
        if (g.activeQueue && g.activeQueue.isPlaying && g.activeQueue.currentTrack) {
          activeQueues.push({
            guildId: g.id,
            guildName: g.name,
            currentTrack: g.activeQueue.currentTrack,
            isPaused: g.activeQueue.isPaused,
            loopMode: g.activeQueue.loopMode,
            queueCount: g.activeQueue.totalQueued,
            voiceChannelName: g.activeQueue.voiceChannelName,
          });
        }
      });

      const stats = {
        totalGuilds: client.guilds.cache.size,
        totalUsers: client.guilds.cache.reduce((acc, g) => acc + (g.memberCount || 0), 0),
        totalVoiceConnections: musicManager.queues.size,
        totalPlaylists: playlists.length,
        uptimeSeconds: Math.floor(process.uptime()),
        ping: client.ws?.ping ?? 0,
      };

      res.render("embed", {
        botName: client.user ? client.user.username : "VNA Music Bot",
        botAvatar: client.user ? client.user.displayAvatarURL() : "",
        botTag: client.user ? client.user.tag : "VNA Music",
        guilds,
        activeQueues,
        all247,
        playlists,
        stats,
      });
    } catch (error) {
      console.error("[WEB ERROR]:", error);
      res.status(500).send("Internal Server Error: " + error.message);
    }
  });

  // ========================================================
  // 2. REAL-TIME BOT STATE API (POLLING)
  // ========================================================
  app.get("/api/music/state", (req, res) => {
    try {
      const guilds = getGuildsData();
      const playlists = PlaylistService.listPlaylists();
      res.json({
        success: true,
        stats: {
          uptimeSeconds: Math.floor(process.uptime()),
          ping: client.ws?.ping ?? 0,
          totalVoice: musicManager.queues.size,
        },
        guilds,
        playlists,
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ========================================================
  // 3. PLAYLIST MANAGEMENT APIS
  // ========================================================
  // 3.1 List all playlists
  app.get("/api/playlists", (req, res) => {
    try {
      const playlists = PlaylistService.listPlaylists();
      res.json({ success: true, playlists });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 3.2 View playlist details (all tracks)
  app.get("/api/playlists/:name", (req, res) => {
    try {
      const details = PlaylistService.getPlaylistDetails(req.params.name);
      if (!details) {
        return res.status(404).json({ success: false, error: "Playlist không tồn tại." });
      }
      res.json({ success: true, playlist: details });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 3.3 Create playlist
  app.post("/api/playlists/create", (req, res) => {
    try {
      const { name } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ success: false, error: "Tên danh sách phát không được để trống." });
      }
      const result = PlaylistService.createPlaylist(name.trim());
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 3.4 Add single or multiple tracks to playlist
  app.post("/api/playlists/add", (req, res) => {
    try {
      const { name, song, songs } = req.body;
      if (!name) {
        return res.status(400).json({ success: false, error: "Tên playlist không được để trống." });
      }

      if (songs) {
        const result = PlaylistService.batchAddTracks(name, songs);
        return res.json(result);
      }

      if (!song || !song.trim()) {
        return res.status(400).json({ success: false, error: "Vui lòng nhập link hoặc tên bài hát." });
      }

      const result = PlaylistService.addTrackToPlaylist(name, song.trim());
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 3.5 Remove track by index
  app.post("/api/playlists/remove", (req, res) => {
    try {
      const { name, index } = req.body;
      if (!name || !index) {
        return res.status(400).json({ success: false, error: "Thiếu thông tin bài hát cần xóa." });
      }
      const result = PlaylistService.removeTrackFromPlaylist(name, index);
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 3.6 Delete playlist
  app.post("/api/playlists/delete", (req, res) => {
    try {
      const { name } = req.body;
      if (!name) {
        return res.status(400).json({ success: false, error: "Tên playlist không được để trống." });
      }
      const result = PlaylistService.deletePlaylist(name);
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 3.7 Play playlist into Discord Voice from Web
  app.post("/api/playlists/play", async (req, res) => {
    try {
      const { guild_id, voice_channel_id, playlist_name, mode } = req.body;
      if (!guild_id || !voice_channel_id || !playlist_name) {
        return res.status(400).json({
          success: false,
          error: "Vui lòng chọn Server, Kênh Voice và Danh Sách Nhạc!",
        });
      }

      const guild = client.guilds.cache.get(guild_id);
      if (!guild) {
        return res.status(404).json({ success: false, error: "Bot không có trong server này." });
      }

      const voiceChannel = guild.channels.cache.get(voice_channel_id);
      if (!voiceChannel) {
        return res.status(404).json({ success: false, error: "Không tìm thấy kênh voice đã chọn." });
      }

      const rawTracks = PlaylistService.getPlaylistTracks(playlist_name);
      if (rawTracks.length === 0) {
        return res.status(400).json({
          success: false,
          error: `Playlist "${playlist_name}" hiện chưa có bài hát nào!`,
        });
      }

      // Default text channel
      const textChannel =
        guild.channels.cache.find(
          (c) => c.isTextBased && c.isTextBased() && c.viewable && c.permissionsFor(client.user)?.has("SendMessages")
        ) || null;

      const isShuffle = mode === "dis";
      const orderedTracks = isShuffle ? PlaylistService.shuffleArray(rawTracks) : [...rawTracks];
      const queue = await musicManager.joinVoice(voiceChannel, textChannel);

      const requestedBy = `Web Dashboard (${playlist_name})`;

      // 1. Resolve first track and play immediately
      const firstResult = await AudioResolver.resolve(orderedTracks[0], requestedBy);
      const firstTrack = firstResult.tracks[0];
      if (!firstTrack) {
        throw new Error("Không thể trích xuất bài hát đầu tiên trong playlist.");
      }

      queue.addTrack(firstTrack);

      if (!queue.currentTrack && !queue.isTransitioning) {
        await musicManager.playNext(guild_id, { isInitial: true });
      }

      // 2. Progressive background loader with cancel guard
      if (orderedTracks.length > 1) {
        queue.activePlaylistLoads = (queue.activePlaylistLoads || 0) + 1;
        void (async () => {
          try {
            for (let i = 1; i < orderedTracks.length; i++) {
              if (musicManager.getQueue(guild_id) !== queue) break;
              try {
                const r = await AudioResolver.resolve(orderedTracks[i], requestedBy);
                if (musicManager.getQueue(guild_id) !== queue) break;
                if (r.tracks && r.tracks.length > 0) {
                  queue.addTrack(r.tracks[0]);
                }
              } catch (_) {}
            }
          } finally {
            if (musicManager.getQueue(guild_id) === queue) {
              queue.activePlaylistLoads = Math.max(0, (queue.activePlaylistLoads || 1) - 1);
              if (!queue.currentTrack && !queue.isTransitioning) {
                await musicManager.playNext(guild_id);
              }
            }
          }
        })();
      }

      res.json({
        success: true,
        message: `Đang phát playlist "${playlist_name}" (${orderedTracks.length} bài) trong phòng #${voiceChannel.name}!`,
      });
    } catch (err) {
      console.error("[API PLAY PLAYLIST ERROR]:", err);
      res.status(500).json({ success: false, error: err.message || "Lỗi khi phát playlist" });
    }
  });

  // ========================================================
  // 4. VOICE CHANNEL ACTIONS & MUSIC CONTROLS
  // ========================================================
  // 4.0 Direct Voice Join / Leave from Web
  app.post("/api/voice/join", async (req, res) => {
    try {
      const { guild_id, voice_channel_id } = req.body;
      if (!guild_id || !voice_channel_id) {
        return res.status(400).json({ success: false, error: "Vui lòng chọn Server và Kênh Voice!" });
      }
      const guild = client.guilds.cache.get(guild_id);
      if (!guild) return res.status(404).json({ success: false, error: "Không tìm thấy server." });
      const voiceChannel = guild.channels.cache.get(voice_channel_id);
      if (!voiceChannel) return res.status(404).json({ success: false, error: "Không tìm thấy kênh voice." });

      const textChannel =
        guild.channels.cache.find(
          (c) => c.isTextBased && c.isTextBased() && c.viewable && c.permissionsFor(client.user)?.has("SendMessages")
        ) || null;

      await musicManager.joinVoice(voiceChannel, textChannel);
      res.json({ success: true, message: `Bot đã tham gia kênh voice #${voiceChannel.name}!` });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post("/api/voice/leave", async (req, res) => {
    try {
      const { guild_id } = req.body;
      if (!guild_id) return res.status(400).json({ success: false, error: "Thiếu guild_id" });
      const queue = musicManager.getQueue(guild_id);
      if (queue) {
        musicManager.destroyQueue(guild_id);
      }
      res.json({ success: true, message: "Bot đã rời khỏi kênh voice." });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 4.1 Play song or query directly from Web
  app.post("/api/music/play", async (req, res) => {
    try {
      const { guild_id, voice_channel_id, query } = req.body;
      if (!guild_id || !voice_channel_id || !query || !query.trim()) {
        return res.status(400).json({
          success: false,
          error: "Vui lòng chọn Server, Kênh Voice và nhập bài hát!",
        });
      }

      const guild = client.guilds.cache.get(guild_id);
      if (!guild) {
        return res.status(404).json({ success: false, error: "Không tìm thấy server." });
      }

      const voiceChannel = guild.channels.cache.get(voice_channel_id);
      if (!voiceChannel) {
        return res.status(404).json({ success: false, error: "Không tìm thấy kênh voice." });
      }

      const textChannel =
        guild.channels.cache.find(
          (c) => c.isTextBased && c.isTextBased() && c.viewable && c.permissionsFor(client.user)?.has("SendMessages")
        ) || null;

      const queue = await musicManager.joinVoice(voiceChannel, textChannel);
      const resolveResult = await AudioResolver.resolve(query.trim(), "Web Dashboard");

      if (resolveResult.type === "playlist") {
        queue.addTracks(resolveResult.tracks);
        if (!queue.currentTrack && !queue.isTransitioning) {
          await musicManager.playNext(guild_id, { isInitial: true });
        }
        return res.json({
          success: true,
          message: `Đã thêm playlist ${resolveResult.tracks.length} bài vào phòng #${voiceChannel.name}!`,
        });
      }

      const track = resolveResult.tracks[0];
      const position = queue.addTrack(track);

      if (!queue.currentTrack && !queue.isTransitioning) {
        await musicManager.playNext(guild_id, { isInitial: true });
        return res.json({
          success: true,
          message: `Đang phát: "${track.title}" trong phòng #${voiceChannel.name}!`,
        });
      }

      res.json({
        success: true,
        message: `Đã thêm vào hàng đợi vị trí #${position}: "${track.title}"!`,
      });
    } catch (err) {
      console.error("[API WEB PLAY ERROR]:", err);
      res.status(500).json({ success: false, error: err.message || "Lỗi khi phát bài hát" });
    }
  });

  // 4.2 Control actions: pause, resume, skip, stop, shuffle, loop, remove_track, clear_queue
  app.post("/api/music/control", async (req, res) => {
    try {
      const { guild_id, action, mode, index } = req.body;
      if (!guild_id) return res.status(400).json({ success: false, error: "Thiếu guild_id" });

      const queue = musicManager.getQueue(guild_id);

      switch (action) {
        case "pause":
          musicManager.pause(guild_id);
          return res.json({ success: true, message: "Đã tạm dừng bài hát." });

        case "resume":
          musicManager.resume(guild_id);
          return res.json({ success: true, message: "Đã tiếp tục phát nhạc." });

        case "skip":
          await musicManager.skip(guild_id, { skippedBy: "Web Dashboard" });
          return res.json({ success: true, message: "Đã chuyển sang bài tiếp theo." });

        case "stop":
          await musicManager.stop(guild_id, { stoppedBy: "Web Dashboard" });
          return res.json({ success: true, message: "Đã dừng phát và dọn hàng đợi." });

        case "shuffle":
          musicManager.shuffle(guild_id);
          return res.json({ success: true, message: "Đã xáo trộn hàng đợi." });

        case "loop":
          if (!["off", "track", "queue"].includes(mode)) {
            return res.status(400).json({ success: false, error: "Chế độ lặp không hợp lệ (off/track/queue)." });
          }
          musicManager.setLoop(guild_id, mode);
          return res.json({ success: true, message: `Đã đặt chế độ lặp: ${mode}` });

        case "remove_track":
          if (!queue || !queue.tracks) {
            return res.status(400).json({ success: false, error: "Hàng đợi trống." });
          }
          const idx = Number(index) - 1;
          if (idx >= 0 && idx < queue.tracks.length) {
            const removed = queue.tracks.splice(idx, 1)[0];
            return res.json({
              success: true,
              message: `Đã xóa bài "${removed.title}" khỏi hàng đợi!`,
            });
          }
          return res.status(400).json({ success: false, error: "Số thứ tự bài không hợp lệ." });

        case "clear_queue":
          if (queue) {
            queue.tracks = [];
          }
          return res.json({ success: true, message: "Đã xóa sạch các bài đang chờ trong hàng đợi." });

        default:
          return res.status(400).json({ success: false, error: "Hành động không hợp lệ" });
      }
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ========================================================
  // 5. 24/7 VOICE PERSISTENCE MANAGEMENT
  // ========================================================
  app.post("/api/247/toggle", async (req, res) => {
    try {
      const { guild_id, voice_channel_id, enabled } = req.body;
      if (!guild_id) return res.status(400).json({ success: false, error: "Thiếu guild_id" });

      const guild = client.guilds.cache.get(guild_id);
      if (!guild) return res.status(404).json({ success: false, error: "Không tìm thấy server." });

      if (enabled) {
        if (!voice_channel_id) {
          return res.status(400).json({ success: false, error: "Vui lòng chọn kênh voice cần treo 24/7!" });
        }
        const voiceChannel = guild.channels.cache.get(voice_channel_id);
        if (!voiceChannel) {
          return res.status(404).json({ success: false, error: "Không tìm thấy kênh voice đã chọn." });
        }

        Persist247Service.set(guild_id, {
          channelId: voiceChannel.id,
          textChannelId: "",
          enabled: true,
        });

        await musicManager.joinVoice(voiceChannel, null);
        return res.json({
          success: true,
          message: `Đã BẬT Treo 24/7 trong phòng #${voiceChannel.name}!`,
        });
      } else {
        Persist247Service.remove(guild_id);
        const queue = musicManager.getQueue(guild_id);
        if (queue && !queue.isPlaying) {
          musicManager.destroyQueue(guild_id);
        }
        return res.json({
          success: true,
          message: "Đã TẮT chế độ Treo 24/7 cho server này.",
        });
      }
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ========================================================
  // 6. RICH EMBED DISPATCHER TO DISCORD CHANNELS
  // ========================================================
  app.post("/api/embed/send", async (req, res) => {
    try {
      const {
        channel_id,
        title,
        description,
        color,
        author_name,
        author_icon,
        thumbnail_url,
        image_url,
        footer_text,
        footer_icon,
        button_label,
        button_url,
        button_emoji,
      } = req.body;

      if (!channel_id) {
        return res.status(400).json({ success: false, error: "Vui lòng chọn kênh Discord nhận Embed!" });
      }

      const channel = await client.channels.fetch(channel_id).catch(() => null);
      if (!channel || !channel.isTextBased()) {
        return res.status(404).json({
          success: false,
          error: "Không tìm thấy kênh Discord hoặc bot không có quyền gửi tin!",
        });
      }

      // Build Embed
      const embed = new EmbedBuilder();

      if (title && title.trim()) embed.setTitle(title.trim());
      if (description && description.trim()) embed.setDescription(description.trim());

      // Parse color (hex or decimal)
      let parsedColor = 0x5865f2;
      if (color) {
        const hex = color.replace("#", "");
        const num = parseInt(hex, 16);
        if (!isNaN(num)) parsedColor = num;
      }
      embed.setColor(parsedColor);

      if (author_name && author_name.trim()) {
        embed.setAuthor({
          name: author_name.trim(),
          iconURL: author_icon && author_icon.trim() ? author_icon.trim() : undefined,
        });
      }

      if (thumbnail_url && thumbnail_url.trim().startsWith("http")) {
        embed.setThumbnail(thumbnail_url.trim());
      }

      if (image_url && image_url.trim().startsWith("http")) {
        embed.setImage(image_url.trim());
      }

      if (footer_text && footer_text.trim()) {
        embed.setFooter({
          text: footer_text.trim(),
          iconURL: footer_icon && footer_icon.trim() ? footer_icon.trim() : undefined,
        });
      }

      embed.setTimestamp();

      // Build Action Row Button if specified
      const components = [];
      if (button_label && button_label.trim() && button_url && button_url.trim().startsWith("http")) {
        const btn = new ButtonBuilder()
          .setLabel(button_label.trim())
          .setStyle(ButtonStyle.Link)
          .setURL(button_url.trim());

        if (button_emoji && button_emoji.trim()) {
          btn.setEmoji(button_emoji.trim());
        }

        const row = new ActionRowBuilder().addComponents(btn);
        components.push(row);
      }

      const sent = await channel.send({
        embeds: [embed],
        components,
      });

      res.json({
        success: true,
        message: `Đã gửi Embed thành công vào kênh #${channel.name}!`,
        messageId: sent.id,
      });
    } catch (err) {
      console.error("[API EMBED SEND ERROR]:", err);
      res.status(500).json({ success: false, error: err.message || "Lỗi khi gửi Embed" });
    }
  });

  function start() {
    if (!config.webEnabled) {
      console.log("[WEB] Web server đã tắt bởi cấu hình WEB_ENABLED.");
      return null;
    }

    const server = app.listen(config.webPort, config.webHost, () => {
      console.log(`[WEB] 🌐 Dashboard & Bot Control Center đang chạy tại http://${config.webHost}:${config.webPort}`);
    });

    server.on("error", (error) => {
      if (error && error.code === "EADDRINUSE") {
        console.warn(
          `[WEB] Cổng ${config.webPort} đang bận. Bỏ qua Web Dashboard, bot nhạc vẫn chạy bình thường.`
        );
      } else {
        console.error("[WEB] Lỗi máy chủ web:", error);
      }
    });

    return server;
  }

  return {
    app,
    start,
  };
}

module.exports = {
  createWebServer,
};
