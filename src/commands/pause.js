const { SlashCommandBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("pause")
    .setDescription("Tạm dừng bài hát đang phát"),

  async execute(interaction, musicManager) {
    const success = musicManager.pause(interaction.guildId);
    if (success) {
      await interaction.reply("⏸️ Đã tạm dừng phát nhạc!");
    } else {
      await interaction.reply({
        content: "❌ Không có bài hát nào đang phát hoặc bài hát đã bị tạm dừng trước đó.",
        ephemeral: true,
      });
    }
  },
};
