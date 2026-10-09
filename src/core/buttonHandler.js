const EmbedBuilderUtil = require("../utils/embedBuilder");

/**
 * Handles Button Interactions from Music Controller Embed
 */
async function handleMusicButton(interaction, musicManager) {
  if (!interaction.isButton()) return;
  const { customId, guildId, member } = interaction;

  // Check if button belongs to music system
  if (!customId.startsWith("music_")) return;

  // Ensure member is in a voice channel
  const memberVoiceChannel = member?.voice?.channel;
  if (!memberVoiceChannel) {
    return interaction.reply({
      content: "❌ Bạn cần tham gia phòng voice trước khi sử dụng nút này!",
      ephemeral: true,
    });
  }

  const queue = musicManager.getQueue(guildId);
  if (!queue || !queue.connection) {
    return interaction.reply({
      content: "❌ Hiện tại không có bài hát nào đang phát trong server này.",
      ephemeral: true,
    });
  }

  // Ensure member is in the same voice channel as the bot
  if (memberVoiceChannel.id !== queue.voiceChannel?.id) {
    return interaction.reply({
      content: `❌ Bạn phải ở cùng kênh voice **#${queue.voiceChannel?.name}** với bot để điều khiển!`,
      ephemeral: true,
    });
  }

  // Acknowledge before stop/skip because these operations may update messages,
  // rotate tracks, or resolve the next audio stream.
  await interaction.deferReply({ ephemeral: true });

  if (customId === "music_stop") {
    const success = await musicManager.stop(guildId, {
      stoppedBy: `${interaction.user} (${interaction.user.tag})`,
    });
    return interaction.editReply({
      content: success ? "⏹️ Đã dừng phát nhạc." : "❌ Không có bài hát nào để dừng.",
    });
  }

  if (customId === "music_skip") {
    if (!queue.currentTrack || queue.tracks.length === 0) {
      return interaction.editReply({
        content: "❌ Không còn bài nào trong hàng đợi để chuyển tiếp.",
      });
    }

    const skippedTrack = await musicManager.skip(guildId, {
      skippedBy: `${interaction.user} (${interaction.user.tag})`,
    });
    return interaction.editReply({
      content: skippedTrack ? "⏭️ Đã chuyển sang bài tiếp theo." : "❌ Không thể chuyển bài lúc này.",
    });
  }
}

module.exports = {
  handleMusicButton,
};
