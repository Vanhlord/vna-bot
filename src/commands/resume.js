const { SlashCommandBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("resume")
    .setDescription("Tiếp tục phát bài hát đang tạm dừng"),

  async execute(interaction, musicManager) {
    const success = musicManager.resume(interaction.guildId);
    if (success) {
      await interaction.reply("▶️ Đã tiếp tục phát nhạc!");
    } else {
      await interaction.reply({
        content: "❌ Bài hát không ở trạng thái tạm dừng hoặc không có bài hát nào đang phát.",
        ephemeral: true,
      });
    }
  },
};
