const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');
const logger = require('../../utils/logger');
const pl = require('../../modules/music/playlists');
const { getQueue, resolveQuery } = require('../../modules/music/player');

// /playlist — personal playlists: they belong to you and play on any server with the bot.
const nameOpt = (desc = 'Название плейлиста') => (o) => o.setName('name').setDescription(desc).setRequired(true).setMaxLength(60).setAutocomplete(true);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('playlist')
    .setDescription('Ваши плейлисты: создать, наполнить, включить, поделиться')
    .addSubcommand((s) => s.setName('list').setDescription('Мои плейлисты'))
    .addSubcommand((s) => s.setName('show').setDescription('Треки плейлиста').addStringOption(nameOpt()).addIntegerOption((o) => o.setName('page').setDescription('Страница').setMinValue(1)))
    .addSubcommand((s) => s.setName('create').setDescription('Создать плейлист').addStringOption((o) => o.setName('name').setDescription('Название').setRequired(true).setMaxLength(60)))
    .addSubcommand((s) => s.setName('rename').setDescription('Переименовать плейлист').addStringOption(nameOpt()).addStringOption((o) => o.setName('new_name').setDescription('Новое название').setRequired(true).setMaxLength(60)))
    .addSubcommand((s) => s.setName('delete').setDescription('Удалить плейлист').addStringOption(nameOpt()))
    .addSubcommand((s) => s.setName('add').setDescription('Добавить трек: ссылка или название; пусто — то, что играет сейчас').addStringOption(nameOpt()).addStringOption((o) => o.setName('query').setDescription('Ссылка (YouTube, SoundCloud, Spotify, Apple Music) или название').setMaxLength(300)))
    .addSubcommand((s) => s.setName('remove').setDescription('Убрать трек по номеру').addStringOption(nameOpt()).addIntegerOption((o) => o.setName('number').setDescription('Номер трека из /playlist show').setRequired(true).setMinValue(1)))
    .addSubcommand((s) => s.setName('move').setDescription('Переставить трек').addStringOption(nameOpt()).addIntegerOption((o) => o.setName('from').setDescription('Какой номер').setRequired(true).setMinValue(1)).addIntegerOption((o) => o.setName('to').setDescription('На какое место').setRequired(true).setMinValue(1)))
    .addSubcommand((s) => s.setName('play').setDescription('Включить плейлист (свой или по коду)').addStringOption(nameOpt('Название или код чужого плейлиста')).addBooleanOption((o) => o.setName('shuffle').setDescription('В случайном порядке')))
    .addSubcommand((s) => s.setName('save').setDescription('Сохранить текущую очередь в новый плейлист').addStringOption((o) => o.setName('name').setDescription('Название').setRequired(true).setMaxLength(60)))
    .addSubcommand((s) => s.setName('import').setDescription('Импорт: плейлист или альбом YouTube, SoundCloud, Spotify, Apple Music').addStringOption((o) => o.setName('url').setDescription('Ссылка').setRequired(true).setMaxLength(300)).addStringOption((o) => o.setName('name').setDescription('Название (по умолчанию — как в источнике)').setMaxLength(60)))
    .addSubcommand((s) => s.setName('share').setDescription('Поделиться: код, по которому плейлист могут включить и скопировать').addStringOption(nameOpt()).addBooleanOption((o) => o.setName('off').setDescription('Закрыть доступ')))
    .addSubcommand((s) => s.setName('copy').setDescription('Скопировать чужой плейлист по коду себе').addStringOption((o) => o.setName('code').setDescription('Код из 8 символов').setRequired(true).setMinLength(8).setMaxLength(8)).addStringOption((o) => o.setName('name').setDescription('Название для копии').setMaxLength(60))),

  async autocomplete(interaction) {
    const typed = String(interaction.options.getFocused() || '').toLowerCase();
    const mine = await pl.listOf(interaction.user.id).catch(() => []);
    return interaction.respond(mine.filter((p) => p.name.toLowerCase().includes(typed)).slice(0, 25).map((p) => ({ name: `${p.name} · ${p.count}`.slice(0, 100), value: p.name })));
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const me = interaction.user.id;
    const say = (e, pub = false) => (interaction.deferred || interaction.replied ? interaction.editReply({ embeds: [e] }) : interaction.reply({ embeds: [e], ...(pub ? {} : { flags: MessageFlags.Ephemeral }) }));
    try {
      if (sub === 'list') {
        const mine = await pl.listOf(me);
        if (!mine.length) return say(embeds.info('У вас пока нет плейлистов. Создайте: `/playlist create`, импортируйте: `/playlist import` или сохраните очередь: `/playlist save`.'));
        return say(embeds.baseEmbed().setTitle('Мои плейлисты').setDescription(mine.map((p) => `**${p.name}** · ${p.count} тр.${p.shareCode ? ` · код \`${p.shareCode}\`` : ''}${p.plays ? ` · включали ${p.plays} раз` : ''}`).join('\n')).setFooter({ text: `${mine.length} из ${pl.MAX_PLAYLISTS}` }));
      }
      if (sub === 'show') {
        const p = await pl.playable(me, interaction.options.getString('name'));
        const rows = await pl.tracksOf(p.id);
        const page = Math.max(1, interaction.options.getInteger('page') || 1); const per = 20;
        const pages = Math.max(1, Math.ceil(rows.length / per));
        const part = rows.slice((Math.min(page, pages) - 1) * per, Math.min(page, pages) * per);
        const { formatSeconds } = require('../../modules/music/player');
        const lines = part.map((r, i) => `\`${(Math.min(page, pages) - 1) * per + i + 1}.\` ${r.title.slice(0, 80)}${r.durationSec ? ` · ${formatSeconds(r.durationSec)}` : ''}`);
        return say(embeds.baseEmbed().setTitle(`${p.name} · ${rows.length} тр.`).setDescription(lines.join('\n') || 'Пусто. Добавьте: `/playlist add`').setFooter({ text: `Страница ${Math.min(page, pages)} из ${pages}${p.ownerId !== me ? ' · чужой плейлист' : ''}` }));
      }
      if (sub === 'create') {
        const p = await pl.create(me, interaction.options.getString('name'));
        return say(embeds.success(`Плейлист **${p.name}** создан. Добавьте треки: \`/playlist add\`.`));
      }
      if (sub === 'rename') {
        const p = await pl.rename(me, interaction.options.getString('name'), interaction.options.getString('new_name'));
        return say(embeds.success(`Теперь плейлист называется **${p.name}**.`));
      }
      if (sub === 'delete') {
        const p = await pl.remove(me, interaction.options.getString('name'));
        return say(embeds.success(`Плейлист **${p.name}** удалён.`));
      }
      if (sub === 'remove') {
        const t = await pl.removeTrack(me, interaction.options.getString('name'), interaction.options.getInteger('number'));
        return say(embeds.success(`Убрано: **${t.title}**.`));
      }
      if (sub === 'move') {
        const t = await pl.moveTrack(me, interaction.options.getString('name'), interaction.options.getInteger('from'), interaction.options.getInteger('to'));
        return say(embeds.success(`**${t.title}** теперь на месте №${interaction.options.getInteger('to')}.`));
      }
      if (sub === 'share') {
        const off = interaction.options.getBoolean('off');
        const code = await pl.share(me, interaction.options.getString('name'), !off);
        return say(off ? embeds.success('Доступ по коду закрыт.') : embeds.success(`Код плейлиста: \`${code}\`\nПо нему его можно включить (\`/playlist play name:${code}\`) и скопировать себе (\`/playlist copy code:${code}\`).`));
      }
      if (sub === 'copy') {
        const r = await pl.copyShared(me, interaction.options.getString('code'), interaction.options.getString('name'));
        return say(embeds.success(`Скопировано: **${r.playlist.name}** · ${r.count} тр.`));
      }
      if (sub === 'save') {
        const q = getQueue(interaction.guild.id);
        const tracks = q ? [q.playing, ...q.tracks].filter(Boolean) : [];
        if (!tracks.length) return say(embeds.error('Сейчас ничего не играет — сохранять нечего.'));
        const p = await pl.create(me, interaction.options.getString('name'));
        const r = await pl.addTracks(me, p.id, tracks);
        return say(embeds.success(`Очередь сохранена в **${p.name}**: ${r.added} тр.${r.cut ? ` (${r.cut} не поместились)` : ''}`));
      }
      if (sub === 'add' || sub === 'import') {
        const music = require('./music');
        const wait = music.searchRefusal(interaction.guild.id, me);
        if (wait) return say(embeds.error(wait));
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        let tracks = []; let failText = null;
        try {
          const query = sub === 'add' ? interaction.options.getString('query') : interaction.options.getString('url');
          if (!query) {
            const q = getQueue(interaction.guild.id);
            if (q?.playing) tracks = [q.playing];
            else failText = 'Укажите ссылку или название — сейчас ничего не играет.';
          } else {
            if (sub === 'import' && !/^https?:\/\//i.test(query) && !/^spotify:/i.test(query)) failText = 'Для импорта нужна ссылка на плейлист или альбом.';
            else tracks = await resolveQuery(query, me).catch((err) => { logger.warn?.(`playlist ${sub}: ${err.message}`); failText = err?.userText || null; return []; });
          }
        } finally { music.searchDone(interaction.guild.id); }
        if (!tracks.length) return say(embeds.error(failText || 'Ничего не найдено по запросу.'));
        if (sub === 'add') {
          const r = await pl.addTracks(me, interaction.options.getString('name'), sub === 'add' && tracks.length > 1 && !/playlist|album|sets\//i.test(interaction.options.getString('query') || '') ? tracks.slice(0, 1) : tracks);
          return say(embeds.success(`${r.added > 1 ? `Добавлено треков: ${r.added}` : `Добавлено: **${tracks[0].title}**`} → **${r.playlist.name}**.${r.cut ? ` Не поместилось: ${r.cut}.` : ''}`));
        }
        const name = interaction.options.getString('name') || tracks.meta?.name || 'Импорт';
        const p = await pl.create(me, name, { source: interaction.options.getString('url').slice(0, 250) });
        const r = await pl.addTracks(me, p.id, tracks);
        return say(embeds.success(`Импортировано в **${p.name}**: ${r.added} тр.${tracks.meta?.skipped ? ` Недоступных пропущено: ${tracks.meta.skipped}.` : ''}${tracks.meta?.cut || r.cut ? ` Не поместилось: ${(tracks.meta?.cut || 0) + r.cut}.` : ''}`));
      }
      if (sub === 'play') {
        const music = require('./music');
        const gate = await music.voiceGate(interaction);
        if (gate) return gate;
        const shuffle = Boolean(interaction.options.getBoolean('shuffle'));
        const { playlist, tracks } = await pl.forPlaying(me, interaction.options.getString('name'), { shuffle });
        await interaction.deferReply();
        return music.enqueueAndPlay(interaction, tracks, { playlist, note: `Плейлист «${playlist.name}»${shuffle ? ' в случайном порядке' : ''}. Повторить его целиком — кнопка 🔁 на панели.` });
      }
    } catch (err) {
      if (err instanceof pl.PlaylistError) return say(embeds.error(err.message));
      throw err;
    }
    return say(embeds.error('Неизвестная команда.'));
  }
};
