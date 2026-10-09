const { SlashCommandBuilder } = require("discord.js");
const Persist247Service = require("../core/persist247");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("247")
    .setDescription("Bật hoặc tắt chế độ treo phòng voice 24/7 cho server này")
    .addStringOption((option) =>
      option
        .setName("trang_thai")
        .setDescription("Chọn trạng thái Bật hoặc Tắt")
        .setRequired(true)
        .addChoices(
          { name: "🟢 Bật Treo 24/7", value: "on" },
          { name: "🔴 Tắt Treo 24/7", value: "off" }
        )
    ),

  async execute(interaction, musicManager) {
    const status = interaction.options.getString("trang_thai");
    const memberVoiceChannel = interaction.member?.voice?.channel;

    if (status === "on") {
      if (!memberVoiceChannel) {
        return interaction.reply({
          content: "❌ Bạn cần vào một kênh voice trước khi bật chế độ 24/7!",
          ephemeral: true,
        });
      }

      await interaction.deferReply();

      try {
        // Persist the 24/7 state BEFORE joining so the auto-leave-on-empty
        // handler already sees this guild as 24/7 while the voice state update
        // is still in flight.
        Persist247Service.set(interaction.guildId, {
          channelId: memberVoiceChannel.id,
          textChannelId: interaction.channelId,
          enabled: true,
        });

        await musicManager.joinVoice(memberVoiceChannel, interaction.channel);

        await interaction.editReply(
          `🟢 **Đã BẬT chế độ Treo 24/7!**\n` +
          `Bot sẽ ở lại vĩnh viễn trong kênh voice **#${memberVoiceChannel.name}** ngay cả khi không có ai nghe hoặc bot khởi động lại.`
        );
      } catch (err) {
        // Roll back the persisted state if we never managed to join.
        Persist247Service.remove(interaction.guildId);
        await interaction.editReply({
          content: `❌ Không thể tham gia kênh voice: \`${err.message}\``,
        });
      }
    } else {
      Persist247Service.remove(interaction.guildId);
      await interaction.reply(
        "🔴 **Đã TẮT chế độ Treo 24/7.**\n" +
        "Bot sẽ tự động rời phòng voice sau khi hết nhạc hoặc khi phòng trống."
      );
    }
  },
};
