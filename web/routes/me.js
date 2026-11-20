// /me — «Мои данные»: what the bot keeps about the signed-in person, the file with all of it, turning off optional private
// messages, and deleting his own data (bot/modules/userData.js says what goes and what stays).
const express = require('express');
const { signedIn } = require('../middleware/ensureAuth');
const { rateLimit } = require('../middleware/rateLimit');

const router = express.Router();
const ud = () => require('../../bot/modules/userData');
const limit = rateLimit({ windowMs: 60 * 1000, max: 6, message: 'Слишком много запросов. Подождите минуту.' });

// names of the tables in words
const NAMES = {
  MemberProfile: 'Уровни, опыт и монеты на серверах', MemberAchievement: 'Полученные достижения', MemberSnapshot: 'Роли для возврата при перезаходе',
  EconomyTx: 'Операции с монетами серверов', EconomyEarn: 'Заработок (работа, награды)', EconomyBadge: 'Значки экономики', EconomyGoalContrib: 'Вклады в цели сервера',
  EconomyDeal: 'Сделки с участниками', EconomyHold: 'Удержания по сделкам', EconomyGift: 'Подарочные коды', Purchase: 'Покупки в магазинах серверов',
  TempRole: 'Временные роли', GiveawayEntry: 'Участие в розыгрышах', Giveaway: 'Розыгрыши, которые вы проводили', Reminder: 'Напоминания', Playlist: 'Плейлисты',
  VoiceRoomPref: 'Настройки ваших голосовых комнат', TempVoiceChannel: 'Ваши голосовые комнаты сейчас', VoiceRoomLog: 'Журнал голосовых комнат',
  StarboardEntry: 'Ваши сообщения на доске звёзд', Ticket: 'Тикеты', Warning: 'Предупреждения', ModLog: 'Журнал модерации', Report: 'Жалобы (ваши и на вас)',
  Appeal: 'Апелляции', AppealNote: 'Заметки к апелляциям', Community: 'Сообщества в каталоге (как владелец)', CommunityReview: 'Отзывы в каталоге',
  CommunityReviewReport: 'Ваши жалобы на отзывы', CommunityVote: 'Голоса в каталоге', CommunityFavorite: 'Избранное в каталоге', CommunityReport: 'Ваши жалобы на сообщества',
  CommunityJoin: 'Переходы на серверы из каталога', CommunityPromotion: 'Купленное продвижение', DarkWallet: 'Кошелёк DARK Coins', DarkCoinTx: 'Операции DARK Coins',
  DarkCoinPending: 'Ожидающие награды DARK Coins', DarkDaily: 'Ежедневный бонус DARK Coins', DarkCoinOrder: 'Заказы DARK Coins в Telegram',
  CustomCommand: 'Свои команды, созданные вами', Achievement: 'Достижения, созданные вами', SavedMessage: 'Сохранённые сообщения', ScheduledMessage: 'Отложенные сообщения',
  InteractiveMessage: 'Интерактивные сообщения', UserPref: 'Ваши настройки'
};

router.get('/', signedIn, async (req, res) => {
  const [counts, dmOn] = await Promise.all([ud().summary(req.user.id), ud().dmAllowed(req.user.id)]);
  res.render('me/index', {
    title: 'Мои данные', counts, NAMES, ERASE: ud().ERASE, KEPT: ud().KEPT, dmOn,
    done: String(req.query.done || ''), error: req.query.err ? String(req.query.err).slice(0, 300) : null
  });
});

router.get('/export', signedIn, limit, async (req, res) => {
  const data = await ud().exportData(req.user.id);
  res.set('Content-Type', 'application/json; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="dark-my-data-${req.user.id}.json"`);
  res.set('Cache-Control', 'no-store');
  res.send(JSON.stringify(data, (k, v) => (typeof v === 'bigint' ? String(v) : v), 2));
});

router.post('/dm', signedIn, limit, express.urlencoded({ extended: false }), async (req, res) => {
  await ud().setDmOff(req.user.id, req.body.dm === 'off');
  res.redirect(`/me?done=${req.body.dm === 'off' ? 'dmoff' : 'dmon'}`);
});

router.post('/delete', signedIn, limit, express.urlencoded({ extended: false }), async (req, res) => {
  if (!['УДАЛИТЬ', 'DELETE'].includes(String(req.body.confirm || '').trim().toUpperCase())) // the word in either language of the panel
    return res.redirect(`/me?err=${encodeURIComponent('Чтобы удалить данные, впишите слово УДАЛИТЬ.')}`);
  await ud().erase(req.user.id);
  res.redirect('/me?done=deleted');
});

module.exports = router;
