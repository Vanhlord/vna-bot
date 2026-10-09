const {
  discordErrorReporter,
  getErrorMessage,
  getInteractionAgeMs,
  getInteractionLabel,
  isDiscordNetworkError,
  isUnknownInteractionError,
} = require("../utils/discordErrors");

const INITIAL_RESPONSE_SAFETY_LIMIT_MS = 2_500;

async function handleInteractionError(interaction, error, createErrorEmbed) {
  const ageMs = getInteractionAgeMs(interaction);
  const label = getInteractionLabel(interaction);
  discordErrorReporter.report("INTERACTION", error, { ageMs, label });

  // Code 10062 means Discord has already invalidated the token. Retrying the
  // same interaction only creates another identical error and noisy logs.
  if (isUnknownInteractionError(error) || !interaction?.isRepliable?.()) return false;

  const acknowledged = Boolean(interaction.replied || interaction.deferred);

  // Discord only permits roughly three seconds for the first acknowledgement.
  // Leave some safety margin instead of issuing a request that is guaranteed to
  // become "Unknown interaction" while it is in flight.
  if (!acknowledged && ageMs !== null && ageMs >= INITIAL_RESPONSE_SAFETY_LIMIT_MS) {
    return false;
  }

  const publicMessage = isDiscordNetworkError(error)
    ? "Kết nối tới Discord vừa bị gián đoạn. Vui lòng thử lại lệnh sau vài giây."
    : `Có lỗi xảy ra khi thực thi: \`${getErrorMessage(error) || "Lỗi không xác định"}\``;
  const payload = {
    embeds: [createErrorEmbed(publicMessage)],
    ephemeral: true,
  };

  try {
    if (!acknowledged) {
      await interaction.reply(payload);
    } else if (interaction.deferred) {
      // editReply does not accept the ephemeral flag; it was decided at defer time.
      const { ephemeral: _, ...editPayload } = payload;
      await interaction.editReply(editPayload);
    } else {
      await interaction.followUp(payload);
    }
    return true;
  } catch (responseError) {
    discordErrorReporter.report("INTERACTION-RESPONSE", responseError, {
      ageMs: getInteractionAgeMs(interaction),
      label,
    });
    return false;
  }
}

module.exports = {
  INITIAL_RESPONSE_SAFETY_LIMIT_MS,
  handleInteractionError,
};
