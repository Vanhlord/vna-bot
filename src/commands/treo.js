const { SlashCommandBuilder } = require("discord.js");
const Persist247Service = require("../core/persist247");
const EmbedBuilderUtil = require("../utils/embedBuilder");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("treo")
    .setDescription("Bật hoặc tắt chế độ treo phòng voice 24/7 cho server")
    .addStringOption((option) =>
      option
        .setName("trang_thai")
        .setDescription("Chọn Bật hoặc Tắt treo phòng 24/7")
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
        const errorEmbed = EmbedBuilderUtil.createErrorEmbed(
          "Bạn cần tham gia một kênh voice trước khi bật chế độ treo 24/7!",
          "❌ Chưa Tham Gia Voice"
        );
        return interaction.reply({
          embeds: [errorEmbed],
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
          `🟢 **Đã BẬT chế độ Treo 24/7!**\nBot sẽ luôn ở lại trong kênh **#${memberVoiceChannel.name}** và sẵn sàng nhận lệnh \`/play\` bất cứ lúc nào.`
        );
      } catch (err) {
        // Roll back the persisted state if we never managed to join.
        Persist247Service.remove(interaction.guildId);
        const errorEmbed = EmbedBuilderUtil.createErrorEmbed(
          `Không thể tham gia kênh voice: \`${err.message}\``,
          "❌ Lỗi Kết Nối"
        );
        await interaction.editReply({
          embeds: [errorEmbed],
        });
      }
    } else {
      Persist247Service.remove(interaction.guildId);
      await interaction.reply(
        "🔴 **Đã TẮT chế độ Treo 24/7.**\nBot sẽ tự động rời phòng sau khi hết bài hát."
      );
    }
  },
};
