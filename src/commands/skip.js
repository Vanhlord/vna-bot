const { SlashCommandBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("skip")
    .setDescription("Bỏ qua bài hát hiện tại và phát bài tiếp theo"),

  async execute(interaction, musicManager) {
    const skipped = await musicManager.skip(interaction.guildId, {
      skippedBy: `${interaction.user} (${interaction.user.tag})`,
    });
    if (skipped) {
      await interaction.reply(`⏭️ Đã chuyển qua bài tiếp theo (Bỏ qua: **${skipped.title}**)`);
    } else {
      await interaction.reply({
        content: "❌ Không có bài hát nào đang phát để chuyển bài.",
        ephemeral: true,
      });
    }
  },
};
