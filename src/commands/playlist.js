const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const PlaylistService = require("../core/playlistService");
const AudioResolver = require("../core/audioResolver");
const EmbedBuilderUtil = require("../utils/embedBuilder");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("playlist")
    .setDescription("Quản lý và phát danh sách nhạc cá nhân từ thư mục musiclist")
    // 1. /playlist play <name> [mode]
    .addSubcommand((sub) =>
      sub
        .setName("play")
        .setDescription("Phát danh sách nhạc từ file trong thư mục musiclist")
        .addStringOption((opt) =>
          opt
            .setName("name")
            .setDescription("Tên danh sách nhạc cần phát")
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption((opt) =>
          opt
            .setName("mode")
            .setDescription("Chế độ phát: 'dis' (xáo trộn) hoặc 'ord' (theo thứ tự)")
            .setRequired(false)
            .addChoices(
              { name: "🎲 Xáo trộn ngẫu nhiên (dis)", value: "dis" },
              { name: "📜 Theo đúng thứ tự (ord)", value: "ord" }
            )
        )
    )
    // 2. /playlist list
    .addSubcommand((sub) =>
      sub.setName("list").setDescription("Xem tất cả các danh sách nhạc đang có")
    )
    // 3. /playlist view <name> [page]
    .addSubcommand((sub) =>
      sub
        .setName("view")
        .setDescription("Xem chi tiết các bài hát trong một danh sách")
        .addStringOption((opt) =>
          opt
            .setName("name")
            .setDescription("Tên danh sách nhạc cần xem")
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addIntegerOption((opt) =>
          opt
            .setName("page")
            .setDescription("Trang cần xem (10 bài/trang)")
            .setRequired(false)
            .setMinValue(1)
        )
    )
    // 4. /playlist add <name> <song>
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Thêm bài hát hoặc link vào danh sách nhạc")
        .addStringOption((opt) =>
          opt
            .setName("name")
            .setDescription("Tên danh sách nhạc")
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption((opt) =>
          opt
            .setName("song")
            .setDescription("Tên bài hát hoặc link YouTube cần thêm")
            .setRequired(true)
        )
    )
    // 6. /playlist remove <name> <track>
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription("Xóa một bài hát khỏi danh sách theo số thứ tự")
        .addStringOption((opt) =>
          opt
            .setName("name")
            .setDescription("Tên danh sách nhạc")
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption((opt) =>
          opt
            .setName("track")
            .setDescription("Số thứ tự bài hát (dùng /playlist view để xem STT)")
            .setRequired(true)
        )
    )
    // 7. /playlist delete <name>
    .addSubcommand((sub) =>
      sub
        .setName("delete")
        .setDescription("Xóa vĩnh viễn một danh sách nhạc")
        .addStringOption((opt) =>
          opt
            .setName("name")
            .setDescription("Tên danh sách nhạc cần xóa")
            .setRequired(true)
            .setAutocomplete(true)
        )
    ),

  /**
   * Autocomplete suggestion for playlist name
   */
  async autocomplete(interaction) {
    const focusedValue = interaction.options.getFocused().toLowerCase();
    const lists = PlaylistService.listPlaylists();
    const filtered = lists
      .filter((l) => l.name.toLowerCase().includes(focusedValue))
      .slice(0, 25)
      .map((l) => ({
        name: `${l.name} (${l.trackCount} bài)`,
        value: l.name,
      }));

    return interaction.respond(filtered);
  },

  /**
   * Execute command handler
   */
  async execute(interaction, musicManager) {
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case "play":
        return this.handlePlay(interaction, musicManager);
      case "list":
        return this.handleList(interaction);
      case "view":
        return this.handleView(interaction);
      case "create":
        return this.handleCreate(interaction);
      case "add":
        return this.handleAdd(interaction);
      case "remove":
        return this.handleRemove(interaction);
      case "delete":
        return this.handleDelete(interaction);
      default:
        return interaction.reply({ content: "Lệnh không hợp lệ!", ephemeral: true });
    }
  },

  /**
   * /playlist play
   */
  async handlePlay(interaction, musicManager) {
    const memberVoiceChannel = interaction.member?.voice?.channel;
    if (!memberVoiceChannel) {
      const errorEmbed = EmbedBuilderUtil.createErrorEmbed(
        "Bạn cần tham gia một kênh voice trước khi phát playlist!",
        "❌ Chưa Tham Gia Voice"
      );
      return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
    }

    const name = interaction.options.getString("name", true).trim();
    const mode = interaction.options.getString("mode") || "ord";

    const rawTracks = PlaylistService.getPlaylistTracks(name);
    if (rawTracks.length === 0) {
      return interaction.reply({
        content: `❌ Danh sách **${name}** không có bài nào hoặc không tồn tại!`,
        ephemeral: true,
      });
    }

    await interaction.deferReply();

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

      initialEmbed.setDescription(`✅ Đang phát bài đầu tiên: **${firstTrack.title}**\nĐang nạp các bài tiếp theo vào hàng đợi...`);
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
              initialEmbed.setDescription(`🎉 Đã nạp thành công **${loaded}/${orderedTracks.length} bài hát** từ playlist **${name}**!`);
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
      console.error(`[/PLAYLIST PLAY ERROR]: ${err.message}`);
      await interaction.editReply({
        content: `❌ Lỗi khi khởi chạy playlist: \`${err.message}\``,
        embeds: [],
      });
    }
  },

  /**
   * /playlist list
   */
  async handleList(interaction) {
    const lists = PlaylistService.listPlaylists();
    if (lists.length === 0) {
      return interaction.reply({
        content: "📂 Thư mục `musiclist/` hiện chưa có playlist nào! Hãy mở **Web Dashboard** của bot để tạo danh sách đầu tiên dễ dàng.",
      });
    }

    const description = lists
      .map((l, index) => `**${index + 1}.** 🎵 **${l.name}** — \`${l.trackCount} bài\``)
      .join("\n");

    const embed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle("📚 Danh Sách Playlist Có Sẵn")
      .setDescription(description)
      .setFooter({ text: "Dùng /playlist play <tên> để phát • /playlist view <tên> để xem chi tiết" })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  },

  /**
   * /playlist view
   */
  async handleView(interaction) {
    const name = interaction.options.getString("name", true).trim();
    const page = interaction.options.getInteger("page") || 1;

    const details = PlaylistService.getPlaylistDetails(name);
    if (!details) {
      return interaction.reply({
        content: `❌ Danh sách **${name}** không tồn tại!`,
        ephemeral: true,
      });
    }

    if (details.totalTracks === 0) {
      return interaction.reply({
        content: `📂 Danh sách **${details.name}** hiện chưa có bài hát nào! Dùng \`/playlist add ${details.name} <link>\` để thêm bài.`,
      });
    }

    const pageSize = 10;
    const totalPages = Math.ceil(details.totalTracks / pageSize);
    const currentPage = Math.min(Math.max(1, page), totalPages);
    const startIndex = (currentPage - 1) * pageSize;
    const currentTracks = details.tracks.slice(startIndex, startIndex + pageSize);

    const trackLines = currentTracks.map((t) => `\`#${t.index}\` ${t.query}`);

    const embed = new EmbedBuilder()
      .setColor(0x3b82f6)
      .setTitle(`📜 Danh Sách: ${details.name}`)
      .setDescription(trackLines.join("\n\n"))
      .addFields(
        { name: "Tổng số bài", value: `${details.totalTracks} bài`, inline: true },
        { name: "Ngày tạo", value: details.createdAt, inline: true },
        { name: "Trang", value: `${currentPage}/${totalPages}`, inline: true }
      )
      .setFooter({ text: "Dùng /playlist remove <tên> <STT> để xóa bài • /playlist play để phát" })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  },

  /**
   * /playlist create (Redirect to Web)
   */
  async handleCreate(interaction) {
    return interaction.reply({
      content:
        "🌐 **Tạo danh sách phát nay đã chuyển sang giao diện Web Dashboard!**\n" +
        "Vui lòng truy cập trang Web của bot để tạo mới, dán danh sách bài hát hàng loạt và quản lý playlist trực quan, thuận tiện hơn.",
      ephemeral: true,
    });
  },

  /**
   * /playlist add
   */
  async handleAdd(interaction) {
    const name = interaction.options.getString("name", true).trim();
    const song = interaction.options.getString("song", true).trim();

    const result = PlaylistService.addTrackToPlaylist(name, song);
    if (result.ok) {
      return interaction.reply({
        content: `✅ **${result.message}**\n🎶 Bài hát vừa thêm: \`${song}\``,
      });
    }

    return interaction.reply({
      content: `❌ ${result.error}`,
      ephemeral: true,
    });
  },

  /**
   * /playlist remove
   */
  async handleRemove(interaction) {
    const name = interaction.options.getString("name", true).trim();
    const track = interaction.options.getString("track", true).trim();

    const result = PlaylistService.removeTrackFromPlaylist(name, track);
    if (result.ok) {
      return interaction.reply({
        content: `✅ **${result.message}**`,
      });
    }

    return interaction.reply({
      content: `❌ ${result.error}`,
      ephemeral: true,
    });
  },

  /**
   * /playlist delete
   */
  async handleDelete(interaction) {
    const name = interaction.options.getString("name", true).trim();
    const result = PlaylistService.deletePlaylist(name);

    if (result.ok) {
      return interaction.reply({
        content: `🗑️ **${result.message}**`,
      });
    }

    return interaction.reply({
      content: `❌ ${result.error}`,
      ephemeral: true,
    });
  },
};
