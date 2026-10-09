const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

function getTrackDescription(track) {
  const title = track?.title || "Không xác định";
  return track?.url ? `**[${title}](${track.url})**` : `**${title}**`;
}

function addTrackThumbnail(embed, track) {
  if (track?.thumbnail && track.thumbnail.startsWith("http")) {
    embed.setThumbnail(track.thumbnail);
  }
  return embed;
}

function getLoopLabel(mode) {
  if (mode === "track") return "Lặp một bài";
  if (mode === "queue") return "Lặp hàng đợi";
  return "Tắt";
}

class EmbedBuilderUtil {
  /**
   * Embed Now Playing with Live Progress & Metadata
   */
  static createNowPlayingEmbed(queue) {
    const track = queue.currentTrack;
    if (!track) {
      return new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("🎵 Không có bài hát nào đang phát")
        .setDescription("Dùng lệnh `/play <tên bài>` để mở bài hát mới!");
    }

    const progressLine = queue.getProgressBar(16);

    const embed = new EmbedBuilder()
      .setColor(0x1db954)
      .setTitle("🎵 Đang Phát")
      .setDescription(`${getTrackDescription(track)}\n${progressLine}`)
      .addFields(
        { name: "Tác giả", value: track.author || "Không xác định", inline: true },
        { name: "Thời lượng", value: track.duration || "Live", inline: true },
        { name: "Người yêu cầu", value: track.requestedBy || "Unknown", inline: true },
        { name: "Lặp", value: getLoopLabel(queue.loopMode), inline: true },
        { name: "Đang chờ", value: `${queue.tracks.length} bài`, inline: true }
      )
      .setFooter({ text: "AB-VNA Music • Gõ /help để biết chi tiết" })
      .setTimestamp();

    if (track.thumbnail) {
      embed.setThumbnail(track.thumbnail);
    }

    return embed;
  }

  /**
   * Embed shown immediately when /play is invoked to start searching
   */
  static createSearchingEmbed(query, requestedBy = "Unknown") {
    return new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("🔍 Đang Bắt Đầu Tìm Kiếm Bài Hát")
      .setDescription(`Đang tìm kiếm bài hát theo yêu cầu: **${query}**\n\`▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱\`  \`Đang nạp dữ liệu...\``)
      .addFields(
        { name: "Từ khóa / Link", value: `\`${String(query).slice(0, 100)}\``, inline: true },
        { name: "Người yêu cầu", value: requestedBy, inline: true },
        { name: "Trạng thái", value: "Đang tìm nạp dữ liệu từ YouTube / Spotify / SoundCloud...", inline: false }
      )
      .setFooter({ text: "AB-VNA Music • Đang tìm kiếm" })
      .setTimestamp();
  }

  /**
   * Embed shown while preparing the initial track to play (not a transition).
   */
  static createPreparingEmbed(track, queue = null) {
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("🎵 Đang Chuẩn Bị Phát Nhạc")
      .setDescription(getTrackDescription(track))
      .addFields(
        { name: "Tác giả", value: track?.author || "Không xác định", inline: true },
        { name: "Thời lượng", value: track?.duration || "Live", inline: true },
        { name: "Người yêu cầu", value: track?.requestedBy || "Unknown", inline: true },
        { name: "Trạng thái", value: "Đang tải luồng âm thanh và chuẩn bị phát...", inline: false }
      )
      .setFooter({ text: "AB-VNA Music • Chuẩn bị phát" })
      .setTimestamp();

    return addTrackThumbnail(embed, track);
  }

  /**
   * A fresh message shown while the next track is being prepared.
   */
  static createTransitionEmbed(track, queue) {
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("⏭️ Đang Chuyển Sang Bài Tiếp Theo")
      .setDescription(getTrackDescription(track))
      .addFields(
        { name: "Tác giả", value: track?.author || "Không xác định", inline: true },
        { name: "Thời lượng", value: track?.duration || "Live", inline: true },
        { name: "Người yêu cầu", value: track?.requestedBy || "Unknown", inline: true },
        { name: "Còn trong hàng đợi", value: `${queue?.tracks?.length || 0} bài`, inline: true },
        { name: "Trạng thái", value: "Đang tải luồng âm thanh và chuẩn bị phát...", inline: false }
      )
      .setFooter({ text: "AB-VNA Music • Transition" })
      .setTimestamp();

    return addTrackThumbnail(embed, track);
  }

  /**
   * Processing Embed
   */
  static createProcessingEmbed(track) {
    const title = track?.title || "Không xác định";
    const url = track?.url;
    const description = url ? `**[${title}](${url})**` : `**${title}**`;

    const embed = new EmbedBuilder()
      .setColor(0xf59e0b)
      .setTitle("⏳ Đang Xử Lý")
      .setDescription(`${description}\n\`▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱\`  \`00:00 / --:--\``)
      .addFields(
        { name: "Người yêu cầu", value: track?.requestedBy || "Unknown", inline: true },
        { name: "Trạng thái", value: "Đang tải dữ liệu và chuẩn bị phát...", inline: true }
      )
      .setFooter({ text: "AB-VNA Music • Processing" })
      .setTimestamp();

    if (track?.thumbnail) {
      embed.setThumbnail(track.thumbnail);
    }

    return embed;
  }

  /**
   * Ended Track Embed
   */
  static createTrackEndedEmbed(track, options = {}) {
    const { nextTrack = null } = options;
    const embed = new EmbedBuilder()
      .setColor(0xf59e0b)
      .setTitle(nextTrack ? "✅ Bài Hát Đã Kết Thúc" : "🏁 Hàng Đợi Đã Phát Xong")
      .setDescription(getTrackDescription(track))
      .addFields(
        { name: "Thời lượng", value: track?.duration || "Live", inline: true },
        { name: "Người yêu cầu", value: track?.requestedBy || "Unknown", inline: true },
        {
          name: "Trạng thái",
          value: nextTrack ? `Đang chuyển sang: **${nextTrack.title || "Bài tiếp theo"}**` : "Không còn bài hát nào trong hàng đợi.",
          inline: false,
        }
      )
      .setFooter({ text: "AB-VNA Music • Ended" })
      .setTimestamp();

    return addTrackThumbnail(embed, track);
  }

  static createStoppedEmbed(track, options = {}) {
    const { stoppedBy = "Không xác định", clearedCount = 0 } = options;
    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle("⏹️ Nhạc Đã Được Dừng")
      .setDescription(getTrackDescription(track))
      .addFields(
        { name: "Người yêu cầu", value: track?.requestedBy || "Unknown", inline: true },
        { name: "Người đã dừng", value: stoppedBy, inline: true },
        { name: "Đã xóa khỏi hàng đợi", value: `${clearedCount} bài`, inline: true }
      )
      .setFooter({ text: `AB-VNA Music • Đã dừng bởi ${stoppedBy}` })
      .setTimestamp();

    return addTrackThumbnail(embed, track);
  }

  static createSkippedEmbed(track, options = {}) {
    const { skippedBy = "Không xác định", nextTrack = null } = options;
    const embed = new EmbedBuilder()
      .setColor(0xfee75c)
      .setTitle("⏭️ Bài Hát Đã Bị Bỏ Qua")
      .setDescription(getTrackDescription(track))
      .addFields(
        { name: "Người yêu cầu", value: track?.requestedBy || "Unknown", inline: true },
        { name: "Người thực hiện", value: skippedBy, inline: true },
        { name: "Bài tiếp theo", value: nextTrack?.title || "Không còn bài nào", inline: false }
      )
      .setFooter({ text: "AB-VNA Music • Skipped" })
      .setTimestamp();

    return addTrackThumbnail(embed, track);
  }

  static createPlaybackErrorEmbed(track, errorMessage) {
    const safeMessage = String(errorMessage || "Không thể tải luồng âm thanh.").slice(0, 900);
    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle("⚠️ Không Thể Phát Bài Hát")
      .setDescription(getTrackDescription(track))
      .addFields(
        { name: "Người yêu cầu", value: track?.requestedBy || "Unknown", inline: true },
        { name: "Thời lượng", value: track?.duration || "Không xác định", inline: true },
        { name: "Chi tiết", value: `\`${safeMessage}\``, inline: false },
        { name: "Xử lý", value: "Bài này đã được bỏ qua. Bot sẽ thử bài tiếp theo nếu hàng đợi vẫn còn.", inline: false }
      )
      .setFooter({ text: "AB-VNA Music • Playback Error" })
      .setTimestamp();

    return addTrackThumbnail(embed, track);
  }

  static createOffEmbed(track) {
    return this.createTrackEndedEmbed(track);
  }

  /**
   * Temporary Extraction Error Embed (Báo lỗi trích xuất âm thanh tạm thời)
   * @param {Object|string} trackOrQuery - Track object or search query string
   * @param {string} [errorMessage] - Error details
   * @param {string} [requestedBy] - User tag
   */
  static createExtractionErrorEmbed(trackOrQuery, errorMessage = "Không thể trích xuất luồng âm thanh.", requestedBy = "Unknown") {
    const isTrackObj = typeof trackOrQuery === "object" && trackOrQuery !== null;
    const title = isTrackObj ? (trackOrQuery.title || "Không xác định") : String(trackOrQuery || "Không xác định");
    const url = isTrackObj ? trackOrQuery.url : null;
    const user = isTrackObj ? (trackOrQuery.requestedBy || requestedBy || "Unknown") : (requestedBy || "Unknown");
    const thumbnail = isTrackObj ? trackOrQuery.thumbnail : null;
    const duration = isTrackObj ? (trackOrQuery.duration || "--:--") : "--:--";

    const trackLink = url && url.startsWith("http") ? `**[${title}](${url})**` : `**${title}**`;

    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle("⚠️ Lỗi Trích Xuất Âm Thanh (Tạm Thời)")
      .setDescription(
        `Không thể tải hoặc trích xuất luồng phát cho bài hát:\n${trackLink}\n\n` +
        `> 💬 **Chi tiết lỗi:** \`${errorMessage}\``
      )
      .addFields(
        { name: "👤 Người yêu cầu", value: user, inline: true },
        { name: "⏱️ Thời lượng", value: duration, inline: true },
        { name: "📊 Trạng thái", value: "🔴 Lỗi tạm thời (Đã bỏ qua / dừng)", inline: true },
        {
          name: "💡 Gợi ý khắc phục",
          value:
            "• Thử lại sau ít phút nếu YouTube/Spotify đang quá tải hoặc nghẽn mạng.\n" +
            "• Tìm kiếm bằng tên bài hát thay vì dán trực tiếp đường link URL.\n" +
            "• Kiểm tra video có bị giới hạn vùng miền, bản quyền hoặc độ tuổi không.",
          inline: false,
        }
      )
      .setFooter({ text: "AB-VNA Music • Báo Lỗi Tạm Thời" })
      .setTimestamp();

    if (thumbnail && thumbnail.startsWith("http")) {
      embed.setThumbnail(thumbnail);
    }

    return embed;
  }

  /**
   * General Error Embed
   */
  static createErrorEmbed(message, title = "❌ Thông Báo") {
    return new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle(title)
      .setDescription(message || "Đã xảy ra sự cố trong quá trình xử lý.")
      .setFooter({ text: "AB-VNA Music • Thông Báo" })
      .setTimestamp();
  }

  /**
   * Queue list Embed
   */
  static createQueueEmbed(queue, page = 1) {
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("🎶 Danh Sách Hàng Đợi")
      .setFooter({ text: "AB-VNA Music" })
      .setTimestamp();

    if (queue.currentTrack) {
      embed.addFields({
        name: "▶️ Đang phát:",
        value: `**[${queue.currentTrack.title}](${queue.currentTrack.url || "#"})** | \`${queue.currentTrack.duration || "Live"}\` (Yêu cầu bởi: ${queue.currentTrack.requestedBy || "Unknown"})`,
        inline: false,
      });
    }

    const pageSize = 10;
    const totalPages = Math.ceil(queue.tracks.length / pageSize) || 1;
    const currentPage = Math.max(1, Math.min(page, totalPages));
    const startIdx = (currentPage - 1) * pageSize;
    const pagedTracks = queue.tracks.slice(startIdx, startIdx + pageSize);

    if (pagedTracks.length === 0) {
      embed.setDescription(queue.currentTrack ? "Không còn bài hát nào tiếp theo trong hàng đợi." : "Hàng đợi đang trống.");
    } else {
      const trackList = pagedTracks
        .map((t, idx) => `**${startIdx + idx + 1}.** [${t.title}](${t.url || "#"}) | \`${t.duration || "Live"}\` (Yêu cầu: ${t.requestedBy || "Unknown"})`)
        .join("\n");
      embed.setDescription(`**Các bài tiếp theo (Trang ${currentPage}/${totalPages}):**\n${trackList}`);
    }

    return embed;
  }

  /**
   * Controller row for the currently playing track.
   * Includes Stop, Skip, Add Track (Popup Modal), and View Queue.
   */
  static createControllerRow(queue = null) {
    const stopBtn = new ButtonBuilder()
      .setCustomId("music_stop")
      .setLabel("Tắt nhạc")
      .setEmoji("⏹️")
      .setStyle(ButtonStyle.Danger);

    const skipBtn = new ButtonBuilder()
      .setCustomId("music_skip")
      .setLabel("Bài tiếp")
      .setEmoji("⏭️")
      .setStyle(ButtonStyle.Secondary);

    const addQueueBtn = new ButtonBuilder()
      .setCustomId("music_btn_open_modal")
      .setLabel("Thêm bài")
      .setEmoji("➕")
      .setStyle(ButtonStyle.Success);

    const viewQueueBtn = new ButtonBuilder()
      .setCustomId("music_btn_view_queue")
      .setLabel("Hàng đợi")
      .setEmoji("📜")
      .setStyle(ButtonStyle.Primary);

    return new ActionRowBuilder().addComponents(stopBtn, skipBtn, addQueueBtn, viewQueueBtn);
  }

  /**
   * Main Standby Controller Embed shown when bot is in voice waiting for music
   */
  static createMainControllerEmbed(voiceChannel = null) {
    return new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("🎵 Trạm Điều Khiển Âm Nhạc • AB-VNA")
      .setDescription(
        "Chào mừng bạn đến với phòng nghe nhạc!\n" +
        "Bấm các nút bên dưới để mở bài hát, chọn playlist hoặc thêm nhạc vào danh sách mà không cần gõ lệnh."
      )
      .addFields(
        { name: "Trạng thái", value: "🟢 Đang chờ phát nhạc", inline: true },
        { name: "Kênh thoại", value: voiceChannel ? `🔊 <#${voiceChannel.id}>` : "Chưa kết nối", inline: true },
        { name: "Nguồn hỗ trợ", value: "YouTube • Spotify • SoundCloud", inline: true }
      )
      .setFooter({ text: "AB-VNA Music • Điều khiển 1 chạm bằng nút bấm & popup" })
      .setTimestamp();
  }

  /**
   * Action Row for Standby Controller: Mở bài hát, Chọn playlist, Thêm vào playlist
   */
  static createMainControllerRow() {
    const openModalBtn = new ButtonBuilder()
      .setCustomId("music_btn_open_modal")
      .setLabel("Mở Bài Hát")
      .setEmoji("🎵")
      .setStyle(ButtonStyle.Success);

    const selectPlBtn = new ButtonBuilder()
      .setCustomId("music_btn_select_playlist")
      .setLabel("Chọn Playlist")
      .setEmoji("📑")
      .setStyle(ButtonStyle.Primary);

    const addPlBtn = new ButtonBuilder()
      .setCustomId("music_btn_add_to_playlist")
      .setLabel("Thêm Vào Playlist")
      .setEmoji("➕")
      .setStyle(ButtonStyle.Secondary);

    return new ActionRowBuilder().addComponents(openModalBtn, selectPlBtn, addPlBtn);
  }

  /**
   * Secondary Row
   */
  static createSecondaryRow() {
    const stopBtn = new ButtonBuilder()
      .setCustomId("music_stop")
      .setLabel("Dừng Phát")
      .setEmoji("⏹️")
      .setStyle(ButtonStyle.Danger);

    return new ActionRowBuilder().addComponents(stopBtn);
  }
}

module.exports = EmbedBuilderUtil;
