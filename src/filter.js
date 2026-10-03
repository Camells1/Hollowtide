// Camel Studios word filter, shared by the client, the website and every game.
// clean(text) stars out bad words in chat; ok(name) says whether a name or tag is allowed.
// It sees through simple tricks (l33t letters, repeated letters, dots between letters).
const STEMS = ['fuck', 'fuk', 'shit', 'bitch', 'cunt', 'nigg', 'nigra', 'fag', 'retard', 'rape', 'rapist', 'whore', 'slut', 'dick', 'cock', 'pussy', 'penis', 'vagina', 'porn',
  'nazi', 'hitler', 'bastard', 'twat', 'wank', 'pedo', 'paedo', 'molest', 'tranny', 'chink', 'kike', 'dyke', 'hentai', 'asshole', 'arsehole', 'jizz', 'blowjob', 'handjob', 'dildo', 'kys'];
// Short or ambiguous words only count on their own (so "class" and "Essex" stay fine)
const WHOLE = ['ass', 'arse', 'cum', 'sex', 'sexy', 'tit', 'tits', 'hoe', 'spic', 'coon', 'homo', 'anal', 'anus', 'damn', 'piss', 'crap', 'prick', 'thot', 'simp'];
// Ordinary words that happen to contain one of the stems
const ALLOW = ['grape', 'grapes', 'drape', 'drapes', 'scrape', 'scrapes', 'scraped', 'scraper', 'therapist', 'therapists', 'cockpit', 'peacock', 'cocktail', 'cockatoo', 'hitchcock', 'dickens', 'snigger', 'niggle', 'shiitake', 'retardant', 'skyscraper', 'grapefruit'];
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i', '+': 't' };
const norm = s => String(s).toLowerCase().replace(/[0134578@$!+]/g, c => LEET[c]).replace(/[^a-z]/g, '').replace(/(.)\1{2,}/g, '$1$1');
const squash = s => s.replace(/(.)\1+/g, '$1');
function bad(word) {
  const n = norm(word); if (!n) return false;
  const s = squash(n);
  if (ALLOW.includes(n)) return false;
  return WHOLE.includes(n) || WHOLE.includes(s) || STEMS.some(x => n.includes(x) || s.includes(squash(x)));
}
// Chat: replace each bad word with stars, keep everything else as typed
export function clean(text) {
  text = String(text ?? '');
  // letters spaced or dotted out (f.u.c.k / f u c k) count as one word
  text = text.replace(/\b(?:[A-Za-z0-9@$!+][\s._*-]){2,}[A-Za-z0-9@$!+]\b/g, m => (bad(m) ? '*'.repeat(m.replace(/[\s._*-]/g, '').length) : m));
  return text.replace(/[A-Za-z0-9@$!+']+/g, w => (bad(w) ? '*'.repeat(w.length) : w));
}
// Names and tags: not allowed at all if they contain a bad word
export const ok = name => clean(name) === String(name ?? '') && !bad(String(name ?? '').replace(/[\s._-]/g, ''));
export default { clean, ok };
