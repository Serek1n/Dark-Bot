const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const EMBER = 0xe3a857;
const PREFIX = 'music';

function button(action, emoji, label, style = ButtonStyle.Secondary, disabled = false) {
  const b = new ButtonBuilder().setCustomId(`${PREFIX}:${action}`).setEmoji(emoji).setStyle(style).setDisabled(disabled);
  if (label) b.setLabel(label);
  return b;
}

function volumeBar(volume) {
  const pct = Math.round(volume * 100);
  const filled = Math.max(0, Math.min(10, Math.round(Math.min(volume, 1) * 10)));
  return `${'▰'.repeat(filled)}${'▱'.repeat(10 - filled)} ${pct}%`;
}

/**
 * Message payload for the player panel: the "now playing" embed plus control buttons.
 * @param {{ playing: any, tracks: any[], volume: number, paused: boolean }} state
 */
function renderPanel(state) {
  const track = state.playing;
  const embed = new EmbedBuilder().setColor(EMBER);

  if (!track) {
    embed.setDescription('Очередь закончилась. Добавьте трек через `/music play`.');
    return { embeds: [embed], components: [] };
  }

  embed
    .setAuthor({ name: state.paused ? '⏸ Пауза' : '▶ Сейчас играет' })
    .setTitle(track.title)
    .setURL(track.url)
    .addFields(
      { name: 'Длительность', value: track.duration || '—', inline: true },
      { name: 'Заказал', value: `<@${track.requestedBy}>`, inline: true },
      { name: 'Громкость', value: `\`${volumeBar(state.volume)}\``, inline: true }
    );
  if (track.thumbnail) embed.setThumbnail(track.thumbnail);

  if (state.tracks.length) {
    const lines = state.tracks.slice(0, 3).map((t, i) => `${i + 1}. ${t.title.length > 70 ? `${t.title.slice(0, 70)}…` : t.title}`);
    if (state.tracks.length > 3) lines.push(`…и ещё ${state.tracks.length - 3}`);
    embed.addFields({ name: 'Далее', value: lines.join('\n') });
  }

  const row = new ActionRowBuilder().addComponents(
    button('toggle', state.paused ? '▶️' : '⏸️', state.paused ? 'Играть' : 'Пауза', ButtonStyle.Primary),
    button('skip', '⏭️', 'Дальше'),
    button('stop', '⏹️', 'Стоп', ButtonStyle.Danger),
    button('voldown', '🔉', null),
    button('volup', '🔊', null)
  );
  return { embeds: [embed], components: [row] };
}

/** Panel text for a finished session (buttons removed). */
function renderEnded(text) {
  return { embeds: [new EmbedBuilder().setColor(0x2b2d31).setDescription(text)], components: [] };
}

module.exports = { renderPanel, renderEnded, PREFIX };
