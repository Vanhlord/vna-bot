const { SlashCommandBuilder } = require("discord.js");
const EmbedBuilderUtil = require("../utils/embedBuilder");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("nowplaying")
    .setDescription("Xem thông tin bài hát đang phát và mở bảng điều khiển"),

  async execute(interaction, musicManager) {
    const queue = musicManager.getQueue(interaction.guildId);
    if (!queue || !queue.currentTrack) {
      return interaction.reply({
        content: "❌ Không có bài hát nào đang phát trong server này.",
        ephemeral: true,
      });
    }

    const embed = EmbedBuilderUtil.createNowPlayingEmbed(queue);
    const row1 = EmbedBuilderUtil.createControllerRow(queue);
    const row2 = EmbedBuilderUtil.createSecondaryRow();

    await interaction.reply({
      embeds: [embed],
      components: [row1, row2],
    });
  },
};
