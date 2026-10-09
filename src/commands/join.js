const { SlashCommandBuilder, ChannelType } = require("discord.js");
const Persist247Service = require("../core/persist247");
const EmbedBuilderUtil = require("../utils/embedBuilder");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("join")
    .setDescription("Cho bot tham gia và treo 24/7 trong kênh voice")
    .addChannelOption((option) =>
      option
        .setName("kenh_voice")
        .setDescription("Chọn kênh voice muốn bot tham gia (để trống để chọn kênh bạn đang đứng)")
        .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
    ),

  async execute(interaction, musicManager) {
    let targetChannel = interaction.options.getChannel("kenh_voice");
    if (!targetChannel) {
      targetChannel = interaction.member?.voice?.channel;
    }

    if (!targetChannel) {
      const errorEmbed = EmbedBuilderUtil.createErrorEmbed(
        "Bạn cần tham gia một kênh voice trước hoặc chọn kênh voice trong tùy chọn lệnh!",
        "❌ Chưa Chọn Kênh Voice"
      );
      return interaction.reply({
        embeds: [errorEmbed],
        ephemeral: true,
      });
    }

    const permissions = targetChannel.permissionsFor(interaction.client.user);
    if (!permissions || !permissions.has("Connect") || !permissions.has("Speak")) {
      const errorEmbed = EmbedBuilderUtil.createErrorEmbed(
        `Bot không có quyền \`Kết nối\` hoặc \`Nói\` trong kênh voice **#${targetChannel.name}**!`,
        "❌ Thiếu Quyền Voice"
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
        channelId: targetChannel.id,
        textChannelId: interaction.channelId,
        enabled: true,
      });

      await musicManager.joinVoice(targetChannel, interaction.channel);

      await interaction.editReply(
        `✅ Đã tham gia và kích hoạt chế độ **Treo 24/7** trong kênh **#${targetChannel.name}**!\n` +
        `💡 *Bot sẽ luôn ở trong phòng voice này và sẵn sàng nhận lệnh \`/play\` bất cứ lúc nào.*`
      );
    } catch (error) {
      // Roll back the persisted state if we never managed to join.
      Persist247Service.remove(interaction.guildId);
      const errorEmbed = EmbedBuilderUtil.createErrorEmbed(
        `Lỗi khi tham gia kênh voice: \`${error.message}\``,
        "❌ Lỗi Tham Gia Voice"
      );
      await interaction.editReply({
        embeds: [errorEmbed],
      });
    }
  },
};
