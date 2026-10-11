const { MessageFlags } = require('discord.js');
const { getQueue, destroyQueue } = require('./player');
const { PREFIX } = require('./panelView');
const embeds = require('../../utils/embeds');


const VOLUME_STEP = 0.1;
const VOLUME_MAX = 1.5;

function ephemeral(text) {
  return { embeds: [embeds.error(text)], flags: MessageFlags.Ephemeral };
}

/** True when this interaction belongs to the music panel. */
function isMusicButton(interaction) {
  return interaction.isButton?.() && String(interaction.customId).startsWith(`${PREFIX}:`);
}

async function handleMusicButton(interaction) {
  const action = String(interaction.customId).split(':')[1];
  const queue = getQueue(interaction.guildId);

  if (!queue) {
    // The session is over; clear the dead buttons from this old message.
    return interaction.update({ components: [] }).catch(() => interaction.reply(ephemeral('Музыка уже не играет.')));
  }

  const userChannel = interaction.member?.voice?.channelId;
  if (userChannel !== queue.voiceChannel.id) {
    return interaction.reply(ephemeral(`Управлять музыкой можно из голосового канала **${queue.voiceChannel.name}**.`));
  }

  // Old panels (from earlier tracks) have their buttons removed, but guard against races anyway.
  if (queue.panelMessage && interaction.message && queue.panelMessage.id !== interaction.message.id) {
    return interaction.update({ components: [] }).catch(() => {});
  }

  if (action === 'toggle') {
    if (queue.paused) queue.resume();
    else queue.pause();
    return interaction.update(queue.renderPanel());
  }

  if (action === 'skip' || action === 'prev') {
    const before = queue.playing;
    if (action === 'prev' && !queue.history.length) {
      return interaction.reply(ephemeral('Предыдущих треков нет.'));
    }
    await interaction.deferUpdate();
    if (action === 'prev') queue.back();
    else queue.skip(); // the next track posts a fresh panel and retires this one
    // Make sure the clicked panel always ends up showing the new track, even when the bot
    // cannot edit/post messages by itself (editing through this interaction needs no channel rights).
    for (let i = 0; i < 40 && queue.playing === before; i++) await new Promise((r) => setTimeout(r, 250));
    if (queue.panelMessage && queue.panelMessage.id !== interaction.message?.id) return; // a fresh panel was posted
    return interaction.editReply(queue.renderPanel()).catch(() => {});
  }

  if (action === 'queue') {
    const embed = embeds.baseEmbed().setTitle('Очередь');
    if (queue.playing) embed.addFields({ name: 'Сейчас играет', value: queue.playing.title.slice(0, 1000) });
    if (queue.tracks.length) {
      const lines = queue.tracks.slice(0, 15).map((t, i) => `${i + 1}. ${t.title.slice(0, 80)}`);
      if (queue.tracks.length > 15) lines.push(`…и ещё ${queue.tracks.length - 15}.`);
      embed.addFields({ name: 'Далее', value: lines.join('\n') });
    } else {
      embed.setDescription('Дальше в очереди ничего нет. Добавьте трек через `/music play`.');
    }
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  if (action === 'stop') {
    destroyQueue(interaction.guildId); // retires the panel with a "stopped" note
    return interaction.deferUpdate();
  }

  if (action === 'voldown' || action === 'volup') {
    const delta = action === 'volup' ? VOLUME_STEP : -VOLUME_STEP;
    const next = Math.max(0, Math.min(VOLUME_MAX, Math.round((queue.volume + delta) * 100) / 100));
    queue.setVolume(next);
    return interaction.update(queue.renderPanel());
  }

  return interaction.reply(ephemeral('Неизвестная кнопка.'));
}

module.exports = { isMusicButton, handleMusicButton };
