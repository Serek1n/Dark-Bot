// The built-in filter of obscene words (Russian and English) for automod, plus the Zalgo check.
// Words are matched from the START of a word, so ordinary words that merely contain a piece of
// a bad one ("хлеб", "требует", "class") are left alone.

// Letters of other alphabets that look like Cyrillic ones: "хyй" with a Latin y is still caught.
const LOOKALIKES = { a: 'а', e: 'е', o: 'о', p: 'р', c: 'с', x: 'х', y: 'у', k: 'к', m: 'м', t: 'т', h: 'н', b: 'в' };

const START = '(?<![\\p{L}\\p{N}])';
const RU_PREFIX = '(?:за|вы|съ|у|по|на|об|от|до|раз|рас|под|при|пере|вз|с|вс|не|ни|о)?';
const RU = [
  RU_PREFIX + '(?:ху[йяе]|хуи(?!н)|пизд)', 'бля(?:д|т|х)',
  RU_PREFIX + '(?:еба[нтл]|ебну|ебис|ебуч|ебыр|ебл[оа]|ебош|ебак|ебан)',
  '[её]бан', 'уеб(?:ок|ан|ищ)', 'пид[оа]р', 'пидр(?:ил|ы)', 'гандон', 'гондон', 'залуп', 'мудак', 'мудил', 'мудач', 'шлюх',
  'су(?:ка|ки|ке|ку|чк|чар|кин)', 'дроч(?:и|е|у)', 'долбо[её]б', 'членосос', 'хуесос'
].map((p) => new RegExp(`${START}${p}`, 'iu'));

const EN = [
  'f+u+c+k', 'sh[i1]+t(?!ake)', 'b[i1]tch', 'cunt', 'asshole', 'dickhead', 'motherf', 'nigg(?:er|a)', 'fagg?ot', 'whore', 'slut', 'bastard'
].map((p) => new RegExp(`${START}${p}`, 'iu'));

const INVISIBLE = /[​-‏⁠­﻿]/g;
// Combining marks (diacritics) that Zalgo text piles on top of one another.
const MARKS = '\\u0300-\\u036F\\u0483-\\u0489\\u0591-\\u05BD\\u1AB0-\\u1AFF\\u1DC0-\\u1DFF\\u20D0-\\u20FF\\uFE20-\\uFE2F';
const ZALGO = new RegExp(`[${MARKS}]{3,}`);

function foldToCyrillic(text) {
  return text.replace(/[a-z]/g, (ch) => LOOKALIKES[ch] || ch);
}

/** True when the text has an obscene word. Spaces/dots between letters ("х у й") are not guessed. */
function containsProfanity(text) {
  const clean = String(text || '').replace(INVISIBLE, '').replace(new RegExp(`[${MARKS}]`, 'g'), '').toLowerCase();
  if (!clean) return false;
  if (EN.some((re) => re.test(clean))) return true;
  const ru = foldToCyrillic(clean).replace(/ё/g, 'е');
  return RU.some((re) => re.test(ru) || re.test(clean));
}

/** Three combining marks in a row, or a mark on most letters, never happen in normal writing. */
function isZalgo(text) {
  const nfd = String(text || '').normalize('NFD');
  if (ZALGO.test(nfd)) return true;
  // The light kind: one mark on almost every letter ("з̷а̸л̶г̵о̷").
  const marks = (nfd.match(new RegExp(`[${MARKS}]`, 'g')) || []).length;
  const letters = (nfd.match(/\p{L}/gu) || []).length;
  return marks >= 5 && marks / Math.max(letters, 1) >= 0.6;
}

module.exports = { containsProfanity, isZalgo };
