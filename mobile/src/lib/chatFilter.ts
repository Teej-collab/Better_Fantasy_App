// The chat filter on the phone (2026-10) — the same rules as the server's
// app/moderation.py (keep the two lists the same). Only for text that never
// reaches our server: the Lounge's live-room chat, which goes phone to
// phone over LiveKit. Everything else is filtered when it's saved.
const BUILT_IN = [
  'nigger', 'nigga', 'nig', 'jigaboo', 'porchmonkey', 'sambo',
  'chink', 'gook', 'zipperhead',
  'spic', 'spick', 'wetback', 'beaner',
  'kike', 'heeb',
  'raghead', 'towelhead', 'sandnigger', 'cameljockey',
  'faggot', 'fag', 'dyke', 'tranny', 'shemale',
  'retard', 'retarded',
];

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '!': 'i', '|': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', $: 's', '7': 't', '9': 'g' };
const WORD = /[A-Za-z0-9@$!|]+/g;
const ENDINGS = ['s', 'z'];

const key = (w: string) => Array.from(w.toLowerCase(), (c) => LEET[c] ?? c).join('');
const squeeze = (w: string) => w.replace(/(.)\1+/g, '$1');

const KEYS = new Set(BUILT_IN.map(key));
const SQUEEZED = new Set([...KEYS].map(squeeze));

function blocked(token: string): boolean {
  const k = key(token);
  const forms = [k, k.replace(/(.)\1{2,}/g, '$1$1')];
  if (!forms.every((f) => /^[a-z]+$/.test(f))) return false;
  const stretched = /(.)\1{2,}/.test(k);
  const candidates = stretched ? [...forms, ...forms.map(squeeze)] : forms;
  const hit = (c: string) => KEYS.has(c) || (stretched && SQUEEZED.has(c));
  return candidates.some((c) => hit(c) || ENDINGS.some((end) => c.endsWith(end) && hit(c.slice(0, -end.length))));
}

export function cleanChat(text: string): string {
  return text.replace(WORD, (word) => (blocked(word) ? '*'.repeat(word.length) : word));
}
