const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("Xem danh sách các lệnh nghe nhạc cơ bản (chỉ bạn thấy)"),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("📖 Hướng Dẫn & Lệnh Phát Nhạc Cơ Bản")
      .setDescription(
        "Chào mừng bạn đến với **VNA Music Bot**! Dưới đây là các lệnh cơ bản để nghe nhạc trong kênh thoại.\n" +
        "*(Tin nhắn này ở chế độ riêng tư, chỉ mình bạn nhìn thấy)*"
      )
      .addFields(
        {
          name: "🎶 `/play <tên bài hoặc link>`",
          value: "Tìm và phát nhạc từ YouTube, Spotify, SoundCloud hoặc từ khóa (có tự động gợi ý khi gõ).",
          inline: false,
        },
        {
          name: "⏸️ `/pause` & ▶️ `/resume`",
          value: "Tạm dừng hoặc tiếp tục phát bài hát đang nghe.",
          inline: false,
        },
        {
          name: "⏭️ `/skip`",
          value: "Bỏ qua bài hát hiện tại để chuyển sang bài tiếp theo trong hàng đợi.",
          inline: false,
        },
        {
          name: "📜 `/queue`",
          value: "Xem danh sách các bài hát đang chờ phát.",
          inline: false,
        },
        {
          name: "📁 `/playlist`",
          value: "Xem và phát danh sách nhạc yêu thích (`/playlist play <tên>`). Tạo và quản lý danh sách dễ dàng trên **Web Dashboard**!",
          inline: false,
        },
        {
          name: "📌 `/treo` (hoặc `/247`)",
          value: "Bật/tắt chế độ bot ở lại kênh voice 24/7 không bị tự động ngắt kết nối.",
          inline: false,
        },
        {
          name: "👋 `/leave`",
          value: "Dừng phát nhạc và cho bot rời khỏi kênh voice.",
          inline: false,
        },
        {
          name: "🌐 Hướng Dẫn Chi Tiết Trên Web",
          value: "Xem hướng dẫn đầy đủ kèm minh họa tại: [vnasss.com/huongdan/bot-music](https://vnasss.com/huongdan/bot-music)",
          inline: false,
        }
      )
      .setFooter({ text: "AB-VNA Music • Hướng Dẫn Sử Dụng" })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel("📖 Xem Hướng Dẫn Chi Tiết")
        .setStyle(ButtonStyle.Link)
        .setURL("https://vnasss.com/huongdan/bot-music")
        .setEmoji("🌐")
    );

    await interaction.reply({
      embeds: [embed],
      components: [row],
      ephemeral: true,
    });
  },
};
