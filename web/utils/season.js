// Seasonal looks of the site: a temporary design switched on by the date. While a season runs, every page gets
// <meta name="dark-season" content="..."> and js/theme.js puts it on <html data-season="...">; the rules live in
// web/styles/98-season.css. SITE_SEASON in .env overrides the calendar: "off" turns seasons off, a season's name forces it.
const SEASONS = [
  // "Vice Nights": neon sunset, palms and pink-teal glow. Until the end of 30 November 2026, Moscow time (UTC+3).
  { name: 'vice', until: Date.parse('2026-11-30T21:00:00Z') }
];

/** The name of the season running at `now`, or null. */
function currentSeason(now = Date.now(), env = process.env.SITE_SEASON) {
  const forced = String(env || '').trim().toLowerCase();
  if (forced === 'off' || forced === 'none') return null;
  if (forced && SEASONS.some((s) => s.name === forced)) return forced;
  const s = SEASONS.find((x) => now < x.until && (!x.from || now >= x.from));
  return s ? s.name : null;
}

module.exports = { currentSeason, SEASONS };
