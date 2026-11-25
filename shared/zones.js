// The time zones offered in the panel (the server's own zone in «Базовые настройки», the schedule of messages).
const ZONES = ['Europe/Kaliningrad', 'Europe/Moscow', 'Europe/Samara', 'Asia/Yekaterinburg', 'Asia/Omsk', 'Asia/Novosibirsk', 'Asia/Krasnoyarsk', 'Asia/Irkutsk', 'Asia/Yakutsk', 'Asia/Vladivostok', 'Asia/Magadan', 'Asia/Kamchatka', 'Europe/Minsk', 'Europe/Kyiv', 'Asia/Almaty', 'Asia/Tashkent', 'Asia/Tbilisi', 'Asia/Yerevan', 'Asia/Baku', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'UTC'];
const DEFAULT_ZONE = 'Europe/Moscow';
/** The server's zone: its own when set and known, else Moscow. */
const zoneOf = (settings) => (settings && ZONES.includes(settings.timezone) ? settings.timezone : DEFAULT_ZONE);
module.exports = { ZONES, DEFAULT_ZONE, zoneOf };
