// «Оформление»: the theme of the bot's pictures and messages, and for each kind of message whether it is a picture card,
// a text, or both (bot/modules/appearance.js). Tabs: Тема, Уровни, Достижения, Мини-игры, Голосовые комнаты. The previews
// are the real cards, drawn by the bot's own code with sample data.
const express = require('express');
const { ensureGuildAccess } = require('../../middleware/ensureGuildAccess');
const { getGuild } = require('../../discordApi');
const { saved, getSettings } = require('../../utils/common');

const router = express.Router();
const ap = () => require('../../../bot/modules/appearance');

// tab -> the kinds of messages on it
const TABS = {
  appearance: [],
  'appearance-levels': ['levelUp', 'profile', 'top'],
  'appearance-achievements': ['achievement'],
  'appearance-fun': ['fun'],
  'appearance-voice': ['voicePanel']
};

for (const [page, keys] of Object.entries(TABS)) {
  router.get(`/:guildId/${page}`, ensureGuildAccess, async (req, res) => {
    const { guildId } = req.params;
    const [guild, settings] = await Promise.all([getGuild(guildId), getSettings(guildId)]);
    const look = ap().read(settings);
    res.render('dashboard/appearance', {
      guild, settings, look, AP: ap(), keys, page, active: page,
      features: require('../../../bot/utils/features'),
      voiceSections: page === 'appearance-voice' ? require('../../../bot/modules/voiceRoom').SECTIONS : null
    });
  });

  router.post(`/:guildId/${page}`, ensureGuildAccess, async (req, res) => {
    const { guildId } = req.params;
    const settings = await getSettings(guildId);
    const look = ap().applyForm(settings, req.body, page === 'appearance' ? [] : keys);
    await settings.save();
    ap().forget(guildId);
    let flag = 'saved';
    // the room panel already posted on the server takes the new look at once
    if (page === 'appearance-voice' || page === 'appearance') {
      const i18n = require('../../../i18n');
      const payload = require('../../../bot/modules/voiceRoom').panelPayload({ lang: i18n.langOf(guildId), look });
      const edited = await require('../../../services/panelMessages').editPanel(settings, payload, { channel: 'tempVoicePanelChannelId', message: 'tempVoicePanelMessageId' },
        (b) => i18n.translatePayload(b, i18n.langOf(guildId))).catch(() => false);
      if (edited && page === 'appearance-voice') flag = 'lookpanel';
    }
    res.redirect(saved(guildId, page, flag));
  });
}

// ---- previews: the real cards with sample data, in the theme of the form (?theme=&accent=) or the saved one ----
const SAMPLE = { level: 12, xpIntoLevel: 340, xpNeeded: 900, balance: 1520, crystals: 7, messageCount: 812, voiceSeconds: 41000, chatXp: 5040, voiceXp: 3010, rank: 3, totalMembers: 120 };
router.get('/:guildId/appearance/preview/:kind.png', ensureGuildAccess, async (req, res) => {
  const { guildId, kind } = req.params;
  const settings = await getSettings(guildId);
  const look = ap().read(settings);
  if (ap().THEMES[req.query.theme]) look.theme = req.query.theme;
  if ('accent' in req.query) look.accent = /^#?[0-9a-f]{6}$/i.test(String(req.query.accent)) ? `#${String(req.query.accent).replace('#', '').toLowerCase()}` : null;
  const headline = String(req.query.headline || '').slice(0, 60) || null;
  const fmtOf = (key) => (['classic', 'wide'].includes(req.query.format) ? req.query.format : look.targets[key].format);
  const colors = ap().palette(look);
  const name = req.user?.global_name || req.user?.username || 'Участник';
  const avatarURL = req.user?.avatar ? `https://cdn.discordapp.com/avatars/${req.user.id}/${req.user.avatar}.png?size=256` : null;
  const cards = require('../../../bot/modules/lookCards');
  const rank = require('../../../bot/modules/rankCard');
  let png;
  try {
    if (kind === 'levelup') png = await cards.renderLevelUpCard({ username: name, avatarURL, level: 12, oldLevel: 11, reward: `+3 ${settings.crystalName || 'кристаллы'} · роль Активист`, server: 'Ваш сервер', headline: headline || look.targets.levelUp.headline, format: fmtOf('levelUp'), colors });
    else if (kind === 'profile') png = await rank.renderRankCard({ ...SAMPLE, username: name, avatarURL, currencyName: settings.currencyName || 'монеты', crystalName: settings.crystalName || 'кристаллы', colors });
    else if (kind === 'top') png = await rank.renderLeaderboard({ heading: 'Таблица лидеров', title: 'Ваш сервер', page: 1, pages: 3, colors,
      rows: [[name, 31, 18400], ['Лиса', 27, 14100], ['Ник', 24, 11800], ['Макс', 19, 7600], ['Аня', 15, 5200]].map(([n, level, xp], i) => ({ rank: i + 1, name: n, level, xp, avatarURL: i === 0 ? avatarURL : null })) });
    else if (kind === 'achievement') png = await require('../../../bot/modules/achievements').renderCard({ achievement: { name: 'Болтун', description: 'Написать 1 000 сообщений на сервере', rarity: 'rare', category: 'messages' }, userName: name, avatarUrl: avatarURL, colors, headline: headline || look.targets.achievement.headline, format: fmtOf('achievement') });
    else if (kind === 'dice') png = await cards.renderGameCard({ game: 'dice', rolls: [3, 6, 2], sides: 6, player: name, colors });
    else if (kind === 'coin') png = await cards.renderGameCard({ game: 'coinflip', heads: true, player: name, colors });
    else if (kind === '8ball') png = await cards.renderGameCard({ game: '8ball', question: 'Повезёт ли мне сегодня?', answer: 'Знаки говорят: да.', mood: 'good', player: name, colors });
    else if (kind === 'rps') png = await cards.renderGameCard({ game: 'rps', you: 'paper', bot: 'rock', result: 'win', player: name, colors });
    else return res.status(404).end();
  } catch (err) {
    return res.status(500).end();
  }
  res.set('Content-Type', 'image/png').set('Cache-Control', 'private, max-age=60').send(png);
});

module.exports = router;
