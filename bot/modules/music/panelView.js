const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const EMBER = 0xe3a857;
const PREFIX = 'music';

function volumeBar(volume) {
  const pct = Math.round(volume * 100);
  const filled = Math.max(0, Math.min(10, Math.round(Math.min(volume, 1) * 10)));
  return `${'▰'.repeat(filled)}${'▱'.repeat(10 - filled)} ${pct}%`;
}

function button(action, emoji, label, style = ButtonStyle.Secondary, disabled = false) {
  const b = new ButtonBuilder().setCustomId(`${PREFIX}:${action}`).setEmoji(emoji).setStyle(style).setDisabled(disabled);
  if (label) b.setLabel(label);
  return b;
}

const LOOP_VIEW = {
  off: { emoji: '🔁', label: 'Повтор выкл.', text: 'выключен' },
  track: { emoji: '🔂', label: 'Трек', text: 'текущий трек' },
  queue: { emoji: '🔁', label: 'Очередь', text: 'вся очередь' },
  playlist: { emoji: '🔁', label: 'Плейлист', text: 'плейлист' }
};
const SOURCE = { youtube: 'YouTube', soundcloud: 'SoundCloud', spotify: 'Spotify → YouTube', apple: 'Apple Music → YouTube', other: 'Ссылка' };

const fmt = (sec) => { const s2 = Math.max(0, Math.round(sec)); const h = Math.floor(s2 / 3600); const m = Math.floor((s2 % 3600) / 60); const r = String(s2 % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`; };
const toSec = (d) => String(d || '').split(':').map(Number).reduce((a, n) => (Number.isFinite(n) ? a * 60 + n : NaN), 0);

/** ▬▬▬▬●▬▬▬▬▬▬ 1:23 / 3:45 — the length may be unknown (a live stream): then just the time played. */
function progressLine(position, track) {
  const total = Number(track.durationSec) || toSec(track.duration) || 0;
  if (!(total > 0)) return `\`${fmt(position)}\``;
  const pos = Math.min(position, total);
  const at = Math.min(13, Math.floor((pos / total) * 14));
  return `\`${fmt(pos)}\` ${'▬'.repeat(at)}●${'▬'.repeat(13 - at)} \`${fmt(total)}\``;
}

/**
 * Message payload for the player panel: the "now playing" embed with the cover, the progress, the repeat mode and the
 * next tracks, plus the control buttons (every one of them works: see panel.js).
 * @param {{ playing: any, tracks: any[], volume: number, paused: boolean, canBack?: boolean, loop?: string, playlist?: any, position?: number }} state
 */
function renderPanel(state) {
  const track = state.playing;
  const embed = new EmbedBuilder().setColor(EMBER);

  if (!track) {
    embed.setDescription('Очередь закончилась. Добавьте трек через `/play`.');
    return { embeds: [embed], components: [] };
  }
  const loop = LOOP_VIEW[state.loop] || LOOP_VIEW.off;
  embed
    .setAuthor({ name: state.paused ? '⏸ Пауза' : '▶ Сейчас играет' })
    .setTitle(track.title.length > 250 ? `${track.title.slice(0, 250)}…` : track.title)
    .setDescription(progressLine(state.position || 0, track))
    .addFields(
      { name: 'Заказал', value: `<@${track.requestedBy}>`, inline: true },
      { name: 'Громкость', value: `\`${volumeBar(state.volume)}\``, inline: true },
      { name: 'Повтор', value: loop.text, inline: true }
    );
  if (track.url && /^https?:/.test(track.url)) embed.setURL(track.url);
  if (track.thumbnail) embed.setThumbnail(track.thumbnail);

  if (state.tracks.length) {
    const lines = state.tracks.slice(0, 4).map((t, i) => `\`${i + 1}.\` ${t.title.length > 60 ? `${t.title.slice(0, 60)}…` : t.title}${t.duration && t.duration !== '—' ? ` · ${t.duration}` : ''}`);
    if (state.tracks.length > 4) lines.push(`…и ещё ${state.tracks.length - 4}`);
    embed.addFields({ name: `Далее · ${state.tracks.length}`, value: lines.join('\n') });
  }
  const footer = [SOURCE[track.from] || SOURCE[track.source] || null, state.playlist ? `Плейлист «${state.playlist.name}»` : null].filter(Boolean).join(' · ');
  if (footer) embed.setFooter({ text: footer });

  // Discord allows at most 5 buttons per row.
  const row = new ActionRowBuilder().addComponents(
    button('prev', '⏮️', null, ButtonStyle.Secondary, !state.canBack),
    button('toggle', state.paused ? '▶️' : '⏸️', null, ButtonStyle.Primary),
    button('skip', '⏭️', null),
    button('queue', '📜', null),
    button('stop', '⏹️', null, ButtonStyle.Danger)
  );
  const row2 = new ActionRowBuilder().addComponents(
    button('voldown', '🔉', null),
    button('volup', '🔊', null),
    button('shuffle', '🔀', null, ButtonStyle.Secondary, state.tracks.length < 2),
    button('loop', loop.emoji, loop.label, state.loop && state.loop !== 'off' ? ButtonStyle.Success : ButtonStyle.Secondary),
    button('save', '💾', null)
  );
  return { embeds: [embed], components: [row, row2] };
}

/** Panel text for a finished session (buttons removed). */
function renderEnded(text) {
  return { embeds: [new EmbedBuilder().setColor(0x2b2d31).setDescription(text)], components: [] };
}

module.exports = { renderPanel, renderEnded, PREFIX, progressLine, LOOP_VIEW };
