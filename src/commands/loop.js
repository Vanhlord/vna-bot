const { SlashCommandBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("loop")
    .setDescription("Thay đổi chế độ lặp bài hát hoặc hàng đợi")
    .addStringOption((option) =>
      option
        .setName("che_do")
        .setDescription("Chọn chế độ lặp")
        .setRequired(true)
        .addChoices(
          { name: "❌ Tắt lặp", value: "off" },
          { name: "🔂 Lặp 1 bài hiện tại", value: "track" },
          { name: "🔁 Lặp cả danh sách hàng đợi", value: "queue" }
        )
    ),

  async execute(interaction, musicManager) {
    const mode = interaction.options.getString("che_do");
    const newMode = musicManager.setLoop(interaction.guildId, mode);

    if (!newMode) {
      return interaction.reply({
        content: "❌ Không có bài hát nào đang phát trong server này.",
        ephemeral: true,
      });
    }

    const modeLabels = {
      off: "❌ Tắt lặp",
      track: "🔂 Lặp bài hiện tại",
      queue: "🔁 Lặp toàn bộ danh sách chờ",
    };

    await interaction.reply(`🔁 Đã chuyển chế độ lặp thành: **${modeLabels[newMode]}**`);
  },
};
