const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const EmbedBuilderUtil = require("../utils/embedBuilder");
const PlaylistService = require("./playlistService");
const AudioResolver = require("./audioResolver");

/**
 * Kiểm tra quyền truy cập voice của thành viên trước khi thực hiện thao tác
 */
function checkVoiceAccess(interaction, musicManager, options = {}) {
  const memberVoiceChannel = interaction.member?.voice?.channel;
  if (!memberVoiceChannel) {
    return {
      ok: false,
      error: "❌ Bạn cần tham gia một phòng voice trước khi sử dụng tính năng này!",
    };
  }

  const queue = musicManager.getQueue(interaction.guildId);
  if (options.requirePlaying) {
    if (!queue || !queue.connection || !queue.currentTrack) {
      return {
        ok: false,
        error: "❌ Hiện tại không có bài hát nào đang phát trong server này.",
      };
    }
  }

  if (queue?.voiceChannel && memberVoiceChannel.id !== queue.voiceChannel.id) {
    return {
      ok: false,
      error: `❌ Bạn phải ở cùng kênh voice **#${queue.voiceChannel.name}** với bot để điều khiển!`,
    };
  }

  return { ok: true, channel: memberVoiceChannel, queue };
}

/**
 * Xử lý nạp và phát bài hát từ Modal input (hỗ trợ cả link, tên bài lẻ và playlist)
 */
async function handlePlayQuery(interaction, musicManager, memberVoiceChannel, query) {
  const requestedBy = interaction.user.tag;
  const playCommand = require("../commands/play");

  // 1. Kiểm tra nếu query trùng tên một playlist máy chủ có sẵn
  const directTracks = PlaylistService.getPlaylistTracks(query);
  if (directTracks && directTracks.length > 0) {
    const playlistName = PlaylistService.findActualPlaylistName(query) || query;
    return playCommand.playLocalPlaylist(
      interaction,
      musicManager,
      memberVoiceChannel,
      playlistName,
      "ord"
    );
  }

  // 2. Nếu là bài hát đơn lẻ hoặc link YouTube / Spotify / SoundCloud
  try {
    const searchingEmbed = EmbedBuilderUtil.createSearchingEmbed(query, requestedBy);
    await interaction.editReply({ embeds: [searchingEmbed] }).catch(() => {});

    const progressivePlaylist = await AudioResolver.startYoutubePlaylist(query, requestedBy);
    if (progressivePlaylist) {
      return playCommand.playYoutubePlaylistProgressively(
        interaction,
        musicManager,
        memberVoiceChannel,
        progressivePlaylist
      );
    }

    const resolveResult = await AudioResolver.resolve(query, requestedBy);
    const queue = await musicManager.joinVoice(memberVoiceChannel, interaction.channel);

    if (resolveResult.type === "playlist") {
      queue.addTracks(resolveResult.tracks);
      if (!queue.currentTrack && !queue.isTransitioning) {
        queue.lastInteraction = interaction;
        await musicManager.playNext(interaction.guildId, { isInitial: true });
        await interaction.editReply({
          content: `📂 Đang bắt đầu phát playlist: **${resolveResult.tracks.length} bài hát**!`,
          embeds: [],
        });
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
        await interaction.editReply({
          content: `🎵 Đang bắt đầu phát: **${track.title}**!`,
          embeds: [],
        });
      } else {
        await musicManager.refreshNowPlayingMessage(interaction.guildId);
        await interaction.editReply({
          content: `✅ Đã thêm vào hàng đợi (vị trí #${position}): **${track.title}**`,
          embeds: [],
        });
      }
    }
  } catch (err) {
    console.error(`[PLAY MODAL ERROR]: ${err.message}`);
    const errorEmbed = EmbedBuilderUtil.createExtractionErrorEmbed(
      { title: query, requestedBy },
      err.message
    );
    await interaction.editReply({
      content: null,
      embeds: [errorEmbed],
    });
  }
}

/**
 * Bộ xử lý tương tác toàn diện từ Embed (Buttons, Select Menus, Modals)
 */
async function handleMusicInteraction(interaction, musicManager) {
  const customId = interaction.customId || "";
  if (!customId.startsWith("music_")) return;

  const { guildId } = interaction;

  // ==========================================
  // 1. BUTTON INTERACTIONS
  // ==========================================
  if (interaction.isButton()) {
    // 1.1. Mở popup Modal nhập bài hát (Dùng chung cho cả Trạm Chờ lẫn Nút Thêm Bài lúc đang phát)
    if (customId === "music_btn_open_modal") {
      const check = checkVoiceAccess(interaction, musicManager);
      if (!check.ok) {
        return interaction.reply({ content: check.error, ephemeral: true });
      }

      const modal = new ModalBuilder()
        .setCustomId("music_modal_play_track")
        .setTitle("🎵 Mở Nhạc / Thêm Hàng Chờ");

      const queryInput = new TextInputBuilder()
        .setCustomId("music_input_query")
        .setLabel("Tên bài hát hoặc Link YouTube / Spotify")
        .setPlaceholder("Ví dụ: nang tho, hoặc dán link https://...")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(queryInput));
      return interaction.showModal(modal);
    }

    // 1.2. Mở Menu chọn Playlist để phát
    if (customId === "music_btn_select_playlist") {
      const check = checkVoiceAccess(interaction, musicManager);
      if (!check.ok) {
        return interaction.reply({ content: check.error, ephemeral: true });
      }

      const playlists = PlaylistService.listPlaylists();
      if (!playlists || playlists.length === 0) {
        return interaction.reply({
          content: "❌ Chưa có danh sách nhạc nào trên máy chủ. Bạn có thể tạo playlist qua Web Dashboard hoặc lệnh `/playlist create`!",
          ephemeral: true,
        });
      }

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId("music_select_playlist_to_play")
        .setPlaceholder("📂 Chọn một playlist để phát...")
        .addOptions(
          playlists.slice(0, 25).map((pl) => {
            const count = Number(pl.trackCount ?? pl.count ?? pl.totalTracks ?? (Array.isArray(pl.tracks) ? pl.tracks.length : 0));
            return {
              label: pl.name.slice(0, 100),
              description: `${count} bài hát`,
              value: pl.name,
              emoji: "📂",
            };
          })
        );

      return interaction.reply({
        content: "🎧 **Danh Sách Playlist:** Vui lòng chọn một danh sách phát bên dưới:",
        components: [new ActionRowBuilder().addComponents(selectMenu)],
        ephemeral: true,
      });
    }

    // 1.3. Chọn chế độ phát Playlist (dis: xáo trộn | ord: thứ tự)
    if (customId.startsWith("music_play_pl_dis:") || customId.startsWith("music_play_pl_ord:")) {
      const check = checkVoiceAccess(interaction, musicManager);
      if (!check.ok) {
        return interaction.reply({ content: check.error, ephemeral: true });
      }

      const isDis = customId.startsWith("music_play_pl_dis:");
      const mode = isDis ? "dis" : "ord";
      const playlistName = customId.split(":").slice(1).join(":");

      await interaction.deferUpdate();
      const playCommand = require("../commands/play");
      return playCommand.playLocalPlaylist(
        interaction,
        musicManager,
        check.channel,
        playlistName,
        mode
      );
    }

    // 1.4. Mở Menu chọn Playlist để THÊM nhạc vào
    if (customId === "music_btn_add_to_playlist") {
      const allPlaylists = PlaylistService.listPlaylists();
      const adminIds = (process.env.ADMIN_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
      const isAdmin = adminIds.includes(interaction.user.id);

      // Chỉ hiển thị playlist của chính người dùng (hoặc tất cả nếu là admin)
      const userPlaylists = allPlaylists.filter(
        (pl) => isAdmin || (pl.creatorId && String(pl.creatorId) === String(interaction.user.id))
      );

      if (userPlaylists.length === 0) {
        return interaction.reply({
          content: "❌ Bạn chưa có danh sách nhạc nào của riêng mình trên máy chủ.\n💡 Hãy truy cập trang web `/voice` để tạo playlist của bạn trước nhé!",
          ephemeral: true,
        });
      }

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId("music_select_playlist_to_add")
        .setPlaceholder("➕ Chọn playlist của bạn để thêm bài hát...")
        .addOptions(
          userPlaylists.slice(0, 25).map((pl) => {
            const count = Number(pl.trackCount ?? pl.count ?? pl.totalTracks ?? (Array.isArray(pl.tracks) ? pl.tracks.length : 0));
            return {
              label: pl.name.slice(0, 100),
              description: `Của bạn • ${count} bài hát`,
              value: pl.name,
              emoji: "➕",
            };
          })
        );

      return interaction.reply({
        content: "📝 **Thêm Bài Hát Vào Playlist Cá Nhân:** Chọn danh sách của bạn muốn thêm bài:",
        components: [new ActionRowBuilder().addComponents(selectMenu)],
        ephemeral: true,
      });
    }

    // 1.5. Nút Tắt/Dừng Nhạc
    if (customId === "music_stop") {
      const check = checkVoiceAccess(interaction, musicManager, { requirePlaying: true });
      if (!check.ok) {
        return interaction.reply({ content: check.error, ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: true });
      const success = await musicManager.stop(guildId, {
        stoppedBy: `${interaction.user} (${interaction.user.tag})`,
      });
      return interaction.editReply({
        content: success ? "⏹️ Đã dừng phát nhạc và dọn sạch hàng đợi." : "❌ Không có bài hát nào để dừng.",
      });
    }

    // 1.6. Nút Bỏ Qua Bài Tiếp Theo
    if (customId === "music_skip") {
      const check = checkVoiceAccess(interaction, musicManager, { requirePlaying: true });
      if (!check.ok) {
        return interaction.reply({ content: check.error, ephemeral: true });
      }

      if (!check.queue.currentTrack || check.queue.tracks.length === 0) {
        return interaction.reply({
          content: "❌ Không còn bài nào trong hàng đợi để chuyển tiếp.",
          ephemeral: true,
        });
      }

      await interaction.deferReply({ ephemeral: true });
      const skippedTrack = await musicManager.skip(guildId, {
        skippedBy: `${interaction.user} (${interaction.user.tag})`,
      });
      return interaction.editReply({
        content: skippedTrack ? "⏭️ Đã chuyển sang bài tiếp theo." : "❌ Không thể chuyển bài lúc này.",
      });
    }

    // 1.7. Nút Xem Hàng Đợi (Queue)
    if (customId === "music_btn_view_queue") {
      const queue = musicManager.getQueue(guildId);
      if (!queue || !queue.currentTrack) {
        return interaction.reply({
          content: "❌ Hiện không có bài hát nào đang phát.",
          ephemeral: true,
        });
      }

      const queueEmbed = EmbedBuilderUtil.createQueueEmbed(queue, 1);
      return interaction.reply({ embeds: [queueEmbed], ephemeral: true });
    }
  }

  // ==========================================
  // 2. STRING SELECT MENU INTERACTIONS
  // ==========================================
  if (interaction.isStringSelectMenu()) {
    // 2.1. Đã chọn Playlist để phát -> Hiện 2 nút chọn xáo trộn / thứ tự
    if (customId === "music_select_playlist_to_play") {
      const playlistName = interaction.values[0];

      const disBtn = new ButtonBuilder()
        .setCustomId(`music_play_pl_dis:${playlistName}`)
        .setLabel("Xáo Trộn Ngẫu Nhiên (dis)")
        .setEmoji("🎲")
        .setStyle(ButtonStyle.Primary);

      const ordBtn = new ButtonBuilder()
        .setCustomId(`music_play_pl_ord:${playlistName}`)
        .setLabel("Theo Đúng Thứ Tự (ord)")
        .setEmoji("🔢")
        .setStyle(ButtonStyle.Secondary);

      return interaction.update({
        content: `📂 Bạn đã chọn playlist **${playlistName}**!\nVui lòng chọn phong cách phát mong muốn:`,
        components: [new ActionRowBuilder().addComponents(disBtn, ordBtn)],
      });
    }

    // 2.2. Đã chọn Playlist để thêm bài -> Bung Modal nhập link/bài hát
    if (customId === "music_select_playlist_to_add") {
      const playlistName = interaction.values[0];

      const modal = new ModalBuilder()
        .setCustomId(`music_modal_add_pl:${playlistName}`)
        .setTitle(`Thêm vào: ${playlistName}`.slice(0, 45));

      const linkInput = new TextInputBuilder()
        .setCustomId("music_input_add_link")
        .setLabel("Link YouTube / Spotify hoặc tên bài hát")
        .setPlaceholder("Dán link bài hát hoặc gõ tên bài...")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(linkInput));
      return interaction.showModal(modal);
    }
  }

  // ==========================================
  // 3. MODAL SUBMIT INTERACTIONS
  // ==========================================
  if (interaction.isModalSubmit()) {
    // 3.1. Submit bài hát cần mở từ Popup
    if (customId === "music_modal_play_track") {
      const check = checkVoiceAccess(interaction, musicManager);
      if (!check.ok) {
        return interaction.reply({ content: check.error, ephemeral: true });
      }

      const query = (interaction.fields.getTextInputValue("music_input_query") || "").trim();
      if (!query) {
        return interaction.reply({
          content: "❌ Tên bài hát hoặc link không được để trống.",
          ephemeral: true,
        });
      }

      await interaction.deferReply({ ephemeral: true });
      return handlePlayQuery(interaction, musicManager, check.channel, query);
    }

    // 3.2. Submit thêm link vào Playlist đã chọn
    if (customId.startsWith("music_modal_add_pl:")) {
      const playlistName = customId.split(":").slice(1).join(":");
      const link = (interaction.fields.getTextInputValue("music_input_add_link") || "").trim();
      if (!link) {
        return interaction.reply({
          content: "❌ Link bài hát không được để trống.",
          ephemeral: true,
        });
      }

      await interaction.deferReply({ ephemeral: true });

      const adminIds = (process.env.ADMIN_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
      const isAdmin = adminIds.includes(interaction.user.id);
      const perm = PlaylistService.checkPlaylistPermission(playlistName, interaction.user.id, isAdmin);
      if (!perm.ok) {
        return interaction.editReply({
          content: `❌ ${perm.error}`,
        });
      }

      const result = PlaylistService.addTrackToPlaylist(playlistName, link);
      if (result.ok) {
        return interaction.editReply({
          content: `✅ Đã thêm bài hát vào danh sách **${playlistName}** thành công! (Hiện có ${result.totalTracks} bài)\n🔗 Bài: \`${link}\``,
        });
      } else {
        return interaction.editReply({
          content: `❌ Thêm bài thất bại: ${result.error}`,
        });
      }
    }
  }
}

module.exports = {
  handleMusicInteraction,
  handleMusicButton: handleMusicInteraction,
};
