const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const AudioResolver = require("../core/audioResolver");
const PlaylistService = require("../core/playlistService");
const EmbedBuilderUtil = require("../utils/embedBuilder");
const {
  discordErrorReporter,
  getInteractionAgeMs,
  getInteractionLabel,
  isUnknownInteractionError,
} = require("../utils/discordErrors");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("play")
    .setDescription("Phát bài hát hoặc playlist (VD: /play anhconzzz dis hoặc /play anhconzzz ord)")
    .addStringOption((option) =>
      option
        .setName("bai_hat")
        .setDescription("Tên bài hát, link YouTube/Spotify, hoặc <tên playlist> [dis/ord]")
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption((option) =>
      option
        .setName("che_do")
        .setDescription("Chế độ nếu phát playlist: 'dis' (xáo trộn) hoặc 'ord' (theo thứ tự)")
        .setRequired(false)
        .addChoices(
          { name: "🎲 Xáo trộn ngẫu nhiên (dis)", value: "dis" },
          { name: "📜 Theo đúng thứ tự (ord)", value: "ord" }
        )
    ),

  /**
   * Autocomplete live suggestion
   */
  async autocomplete(interaction) {
    const focusedValue = interaction.options.getFocused();
    const query = (focusedValue || "").trim();

    try {
      const allPlaylists = PlaylistService.listPlaylists();
      const playlistChoices = [];

      if (query) {
        const qLower = query.toLowerCase();
        for (const pl of allPlaylists) {
          if (pl.name.toLowerCase().includes(qLower)) {
            playlistChoices.push({
              name: `📂 Playlist: ${pl.name} (🎲 Xáo trộn - dis)`,
              value: `${pl.name} dis`,
            });
            playlistChoices.push({
              name: `📂 Playlist: ${pl.name} (📜 Theo thứ tự - ord)`,
              value: `${pl.name} ord`,
            });
          }
        }
      } else {
        for (const pl of allPlaylists.slice(0, 5)) {
          playlistChoices.push({
            name: `📂 Playlist: ${pl.name} (🎲 dis)`,
            value: `${pl.name} dis`,
          });
          playlistChoices.push({
            name: `📂 Playlist: ${pl.name} (📜 ord)`,
            value: `${pl.name} ord`,
          });
        }
      }

      let searchChoices = [];
      if (query && !query.startsWith("http")) {
        try {
          searchChoices = await AudioResolver.searchAutocomplete(query, 5);
        } catch (_) {}
      }

      const combined = [...playlistChoices, ...searchChoices].slice(0, 25);
      await interaction.respond(combined);
    } catch (error) {
      if (isUnknownInteractionError(error)) {
        discordErrorReporter.report("AUTOCOMPLETE", error, {
          ageMs: getInteractionAgeMs(interaction),
          label: getInteractionLabel(interaction),
        });
        return;
      }

      try {
        await interaction.respond([]);
      } catch (responseError) {
        discordErrorReporter.report("AUTOCOMPLETE", responseError, {
          ageMs: getInteractionAgeMs(interaction),
          label: getInteractionLabel(interaction),
        });
      }
    }
  },

  /**
   * Execute /play command
   */
  async execute(interaction, musicManager) {
    const memberVoiceChannel = interaction.member?.voice?.channel;
    if (!memberVoiceChannel) {
      const errorEmbed = EmbedBuilderUtil.createErrorEmbed(
        "Bạn cần tham gia một kênh voice trước khi dùng lệnh `/play`!",
        "❌ Chưa Tham Gia Voice"
      );
      return interaction.reply({
        embeds: [errorEmbed],
        ephemeral: true,
      });
    }

    const permissions = memberVoiceChannel.permissionsFor(interaction.client.user);
    if (!permissions || !permissions.has("Connect") || !permissions.has("Speak")) {
      const errorEmbed = EmbedBuilderUtil.createErrorEmbed(
        "Bot không có quyền `Kết nối` hoặc `Nói` trong kênh voice của bạn!",
        "❌ Thiếu Quyền Voice"
      );
      return interaction.reply({
        embeds: [errorEmbed],
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    const rawQuery = (interaction.options.getString("bai_hat") || "").trim();
    const explicitMode = interaction.options.getString("che_do");
    const requestedBy = interaction.user.tag;

    // 1. Phân tích cú pháp xem có phải gọi phát Playlist dạng "/play <tên list> dis/ord" không
    let isPlaylist = false;
    let playlistName = "";
    let playlistMode = explicitMode || "ord";

    // Kiểm tra hậu tố " dis", " ord", " or"
    const suffixMatch = rawQuery.match(/^(.+?)\s+(dis|ord|or)$/i);
    if (suffixMatch) {
      const candidateName = suffixMatch[1].trim();
      const rawMode = suffixMatch[2].toLowerCase();
      const tracks = PlaylistService.getPlaylistTracks(candidateName);
      if (tracks && tracks.length > 0) {
        isPlaylist = true;
        playlistName = PlaylistService.findActualPlaylistName(candidateName) || candidateName;
        playlistMode = rawMode === "dis" ? "dis" : "ord";
      }
    }

    // Kiểm tra nếu tên khớp trực tiếp với một playlist có sẵn
    if (!isPlaylist) {
      const directTracks = PlaylistService.getPlaylistTracks(rawQuery);
      if (directTracks && directTracks.length > 0) {
        isPlaylist = true;
        playlistName = PlaylistService.findActualPlaylistName(rawQuery) || rawQuery;
        playlistMode = explicitMode === "dis" ? "dis" : "ord";
      }
    }

    // Nếu nhận diện là Playlist -> Phát theo cơ chế Playlist Engine (hỗ trợ dis/ord)
    if (isPlaylist) {
      return this.playLocalPlaylist(
        interaction,
        musicManager,
        memberVoiceChannel,
        playlistName,
        playlistMode
      );
    }

    // 2. Nếu là bài hát đơn lẻ hoặc link YouTube / Spotify / SoundCloud bình thường
    try {
      const searchingEmbed = EmbedBuilderUtil.createSearchingEmbed(rawQuery, requestedBy);
      await interaction.editReply({ embeds: [searchingEmbed] }).catch(() => {});

      const progressivePlaylist = await AudioResolver.startYoutubePlaylist(rawQuery, requestedBy);
      if (progressivePlaylist) {
        return this.playYoutubePlaylistProgressively(
          interaction,
          musicManager,
          memberVoiceChannel,
          progressivePlaylist
        );
      }

      const resolveResult = await AudioResolver.resolve(rawQuery, requestedBy);
      const queue = await musicManager.joinVoice(memberVoiceChannel, interaction.channel);

      if (resolveResult.type === "playlist") {
        queue.addTracks(resolveResult.tracks);
        if (!queue.currentTrack && !queue.isTransitioning) {
          queue.lastInteraction = interaction;
          await musicManager.playNext(interaction.guildId, { isInitial: true });
        } else {
          await musicManager.refreshNowPlayingMessage(interaction.guildId);
          await interaction.editReply({
            content: `📂 Đã thêm **${resolveResult.tracks.length}** bài hát vào hàng đợi!`,
            embeds: [],
          });
        }
      } else {
        const track = resolveResult.tracks[0];
        const position = queue.addTrack(track);

        if (!queue.currentTrack && !queue.isTransitioning) {
          queue.lastInteraction = interaction;
          await musicManager.playNext(interaction.guildId, { isInitial: true });
        } else {
          await musicManager.refreshNowPlayingMessage(interaction.guildId);
          await interaction.editReply({
            content: `✅ Đã thêm vào hàng đợi vị trí #${position}: **${track.title}**`,
            embeds: [],
          });
        }
      }
    } catch (err) {
      console.error(`[/PLAY ERROR]: ${err.message}`);
      const extractionErrorEmbed = EmbedBuilderUtil.createExtractionErrorEmbed(
        { title: rawQuery, requestedBy },
        err.message
      );
      await interaction.editReply({
        content: null,
        embeds: [extractionErrorEmbed],
      });
    }
  },

  /**
   * Phát danh sách nhạc cá nhân (.txt) với tùy chọn xáo trộn (dis) hoặc thứ tự (ord)
   */
  async playLocalPlaylist(interaction, musicManager, memberVoiceChannel, name, mode) {
    const rawTracks = PlaylistService.getPlaylistTracks(name);
    if (!rawTracks || rawTracks.length === 0) {
      return interaction.editReply({
        content: `❌ Danh sách **${name}** không có bài nào hoặc không tồn tại!`,
        embeds: [],
      });
    }

    const isShuffle = mode === "dis";
    const orderedTracks = isShuffle ? PlaylistService.shuffleArray(rawTracks) : [...rawTracks];
    const modeLabel = isShuffle ? "🎲 Xáo Trộn Ngẫu Nhiên (dis)" : "📜 Theo Đúng Thứ Tự (ord)";

    const initialEmbed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle(`🎶 Khởi Chạy Danh Sách: ${name}`)
      .setDescription(`Đang nạp bài đầu tiên và chuẩn bị **${orderedTracks.length} bài hát**...`)
      .addFields(
        { name: "Chế độ phát", value: modeLabel, inline: true },
        { name: "Tổng số bài", value: `${orderedTracks.length} bài`, inline: true },
        { name: "Yêu cầu bởi", value: interaction.user.tag, inline: true }
      )
      .setFooter({ text: "VNA Music • Progressive Playlist Engine" })
      .setTimestamp();

    await interaction.editReply({ embeds: [initialEmbed] });

    try {
      const queue = await musicManager.joinVoice(memberVoiceChannel, interaction.channel);
      const requestedBy = `${interaction.user.tag} (${name})`;

      // 1. Resolve first track and play immediately
      const firstResult = await AudioResolver.resolve(orderedTracks[0], requestedBy);
      const firstTrack = firstResult.tracks[0];
      if (!firstTrack) {
        throw new Error("Không thể trích xuất bài hát đầu tiên trong playlist.");
      }

      queue.addTrack(firstTrack);

      if (!queue.currentTrack && !queue.isTransitioning) {
        queue.lastInteraction = interaction;
        await musicManager.playNext(interaction.guildId, { isInitial: true });
      }

      initialEmbed.setDescription(
        `✅ Đang phát bài đầu tiên: **${firstTrack.title}**\nĐang nạp các bài tiếp theo vào hàng đợi...`
      );
      await interaction.editReply({ embeds: [initialEmbed] }).catch(() => null);

      // 2. Progressive background loader for remaining tracks
      if (orderedTracks.length > 1) {
        queue.activePlaylistLoads = (queue.activePlaylistLoads || 0) + 1;
        void (async () => {
          let loaded = 1;
          try {
            for (let i = 1; i < orderedTracks.length; i++) {
              if (musicManager.getQueue(interaction.guildId) !== queue) {
                break;
              }
              try {
                const res = await AudioResolver.resolve(orderedTracks[i], requestedBy);
                if (musicManager.getQueue(interaction.guildId) !== queue) {
                  break;
                }
                if (res.tracks && res.tracks.length > 0) {
                  queue.addTrack(res.tracks[0]);
                  loaded++;
                }
              } catch (_) {
                // Ignore single track errors in background
              }
            }

            if (musicManager.getQueue(interaction.guildId) === queue) {
              initialEmbed.setDescription(
                `🎉 Đã nạp thành công **${loaded}/${orderedTracks.length} bài hát** từ playlist **${name}** (${modeLabel})!`
              );
              await interaction.editReply({ embeds: [initialEmbed] }).catch(() => null);
            }
          } finally {
            if (musicManager.getQueue(interaction.guildId) === queue) {
              queue.activePlaylistLoads = Math.max(0, (queue.activePlaylistLoads || 1) - 1);
              if (!queue.currentTrack && !queue.isTransitioning) {
                await musicManager.playNext(interaction.guildId);
              }
            }
          }
        })();
      }
    } catch (err) {
      console.error(`[/PLAY LOCAL PLAYLIST ERROR]: ${err.message}`);
      await interaction.editReply({
        content: `❌ Lỗi khi khởi chạy playlist: \`${err.message}\``,
        embeds: [],
      });
    }
  },

  createPlaylistProgressEmbed(playlistTitle, loaded, totalTracks, completed = false) {
    const count = totalTracks ? `${Math.min(loaded, totalTracks)}/${totalTracks}` : `${loaded}/?`;
    return new EmbedBuilder()
      .setColor(completed ? 0x57f287 : 0x5865f2)
      .setTitle(completed ? "✅ Đã Nạp Xong Playlist" : "📥 Đang Nạp Playlist")
      .setDescription(`**${playlistTitle}**`)
      .addFields({
        name: completed ? "Đã thêm vào hàng đợi" : "Đã lấy bài hát",
        value: `**${count} bài**`,
        inline: true,
      })
      .setFooter({ text: completed ? "Bot đang phát nhạc từ playlist" : "Bài đầu tiên đã được phát; các bài còn lại đang nạp nền" })
      .setTimestamp();
  },

  async playYoutubePlaylistProgressively(interaction, musicManager, voiceChannel, playlist) {
    const queue = await musicManager.joinVoice(voiceChannel, interaction.channel);
    const guildId = interaction.guildId;
    queue.activePlaylistLoads += 1;
    queue.addTrack(playlist.firstTrack);

    if (!queue.currentTrack && !queue.isTransitioning) {
      queue.lastInteraction = interaction;
      musicManager.playNext(guildId, { isInitial: true }).catch((error) => {
        console.error(`[PLAYLIST START ERROR]: ${error.message}`);
      });
    } else {
      await musicManager.refreshNowPlayingMessage(guildId);
      await interaction.editReply({
        content: `📂 Đang thêm playlist **${playlist.playlistTitle}** vào hàng đợi...`,
        embeds: [],
      });
    }

    const progressMessage = await interaction.channel?.send({
      embeds: [this.createPlaylistProgressEmbed(playlist.playlistTitle, 1, playlist.totalTracks)],
    }).catch(() => null);

    let lastShownLoaded = 1;
    const updateProgress = async (loaded, completed = false) => {
      if (!progressMessage) return;
      if (!completed && loaded === lastShownLoaded) return;
      lastShownLoaded = loaded;
      await progressMessage.edit({
        embeds: [this.createPlaylistProgressEmbed(playlist.playlistTitle, loaded, playlist.totalTracks, completed)],
      }).catch(() => {});
    };

    void playlist.loadRemaining(async (tracks, progress) => {
      if (musicManager.getQueue(guildId) !== queue) return false;
      queue.addTracks(tracks);
      await musicManager.refreshNowPlayingMessage(guildId);
      await updateProgress(progress.loaded);

      if (!queue.currentTrack && !queue.isTransitioning) {
        await musicManager.playNext(guildId);
      }
      return true;
    }).then(async (result) => {
      if (musicManager.getQueue(guildId) !== queue) return;
      queue.activePlaylistLoads = Math.max(0, queue.activePlaylistLoads - 1);
      await updateProgress(result.loaded, !result.cancelled);

      if (!queue.currentTrack && !queue.isTransitioning) {
        await musicManager.playNext(guildId);
      }
    }).catch(async (error) => {
      console.error(`[PLAYLIST LOAD ERROR]: ${error.message}`);
      if (musicManager.getQueue(guildId) !== queue) return;
      queue.activePlaylistLoads = Math.max(0, queue.activePlaylistLoads - 1);
      await updateProgress(lastShownLoaded, true);
      if (!queue.currentTrack && !queue.isTransitioning) {
        await musicManager.playNext(guildId);
      }
    });
  },
};
