const { SlashCommandBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("shuffle")
    .setDescription("Xáo trộn ngẫu nhiên thứ tự các bài hát trong hàng đợi"),

  async execute(interaction, musicManager) {
    const queue = musicManager.getQueue(interaction.guildId);
    if (!queue || queue.tracks.length <= 1) {
      return interaction.reply({
        content: "⚠️ Cần ít nhất 2 bài hát trong danh sách chờ để xáo trộn.",
        ephemeral: true,
      });
    }

    musicManager.shuffle(interaction.guildId);
    await interaction.reply(`🔀 Đã xáo trộn ngẫu nhiên **${queue.tracks.length}** bài hát trong hàng đợi!`);
  },
};
