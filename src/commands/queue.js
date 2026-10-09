const { SlashCommandBuilder } = require("discord.js");
const EmbedBuilderUtil = require("../utils/embedBuilder");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("queue")
    .setDescription("Xem danh sách các bài hát đang chờ phát")
    .addIntegerOption((option) =>
      option
        .setName("trang")
        .setDescription("Số trang hàng đợi muốn xem")
        .setMinValue(1)
    ),

  async execute(interaction, musicManager) {
    const queue = musicManager.getQueue(interaction.guildId);
    if (!queue || (!queue.isPlaying && queue.tracks.length === 0)) {
      return interaction.reply({
        content: "❌ Hiện tại không có bài hát nào trong hàng đợi.",
        ephemeral: true,
      });
    }

    const page = interaction.options.getInteger("trang") || 1;
    const embed = EmbedBuilderUtil.createQueueEmbed(queue, page);
    await interaction.reply({ embeds: [embed] });
  },
};
