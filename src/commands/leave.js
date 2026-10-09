const { SlashCommandBuilder } = require("discord.js");
const Persist247Service = require("../core/persist247");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("leave")
    .setDescription("Cho bot rời khỏi kênh voice và tắt chế độ treo 24/7"),

  async execute(interaction, musicManager) {
    const queue = musicManager.getQueue(interaction.guildId);

    // Disable 24/7 state
    Persist247Service.remove(interaction.guildId);

    if (queue && queue.connection) {
      musicManager.destroyQueue(interaction.guildId);
      await interaction.reply("👋 Đã rời khỏi kênh voice và tắt chế độ treo 24/7.");
    } else {
      await interaction.reply({
        content: "❌ Bot hiện tại không có trong kênh voice nào của server này.",
        ephemeral: true,
      });
    }
  },
};
