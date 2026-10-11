const { MessageFlags } = require('discord.js');
const { getQueue, destroyQueue } = require('./player');
const { PREFIX } = require('./panelView');
const embeds = require('../../utils/embeds');


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

  if (action === 'skip') {
    queue.skip(); // the next track posts a fresh panel and retires this one
    return interaction.deferUpdate();
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

  return interaction.reply(ephemeral('Неизвестная кнопка.'));
}

module.exports = { isMusicButton, handleMusicButton };
