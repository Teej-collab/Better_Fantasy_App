"""
The chat filter (2026-10, App Store Guideline 1.2: an app with chat needs
a way to filter objectionable content, beside report and block).

Masks slurs and hate speech with asterisks wherever members' words are
shown to each other — chat and DMs, draft-room chat, display and team
names, Punishment Wheel entries. Everyday swearing is left alone on
purpose: trash talk is the point of a league chat. A commissioner can add
their own words for their league (league_chat_filter_words), which are
masked the same way.

Matching is per word, case-insensitive, and sees through the usual
disguises: digits/symbols for letters (n1gg3r, $pic), stretched letters
(faaaggot), and plurals. A blocked word inside a longer, different word
isn't touched (no "Scunthorpe" problem): "spicy" and "Niger" stay.
"""
import re

# Slurs only — the categories App Review means by objectionable: racial and
# ethnic slurs, anti-LGBTQ slurs, and the ableist one. Left out on purpose,
# for their everyday meanings: "coon" (raccoon hunting), and the collapsed
# spelling "niger" (the country). Lowercase, spelled normally.
_BUILT_IN = (
    "nigger", "nigga", "nig", "jigaboo", "porchmonkey", "sambo",
    "chink", "gook", "zipperhead",
    "spic", "spick", "wetback", "beaner",
    "kike", "heeb",
    "raghead", "towelhead", "sandnigger", "cameljockey",
    "faggot", "fag", "dyke", "tranny", "shemale",
    "retard", "retarded",
)

_LEET = str.maketrans({"0": "o", "1": "i", "!": "i", "|": "i", "3": "e", "4": "a", "@": "a", "5": "s", "$": "s", "7": "t", "9": "g"})
_WORD = re.compile(r"[A-Za-z0-9@$!|]+")
# Plurals only: -ed/-ing/-y/-es endings turned "spicy", "spices" and
# "spiced" into slurs. Other forms that are slurs are listed whole.
_ENDINGS = ("s", "z")


def _key(word: str) -> str:
    """lowercase, symbols → letters."""
    return word.lower().translate(_LEET)


def _forms(word: str) -> set[str]:
    """The word as typed, plus stretched letters squeezed back: runs of 3+
    to 2 ("niggger" → "nigger") and every run to 1 ("faaaggot" → "fagot",
    matched against the list squeezed the same way)."""
    k = _key(word)
    return {k, re.sub(r"(.)\1{2,}", r"\1\1", k)}


def _squeezed(word: str) -> str:
    return re.sub(r"(.)\1+", r"\1", word)


BUILT_IN_KEYS = frozenset(_key(w) for w in _BUILT_IN)


def _blocked(token: str, keys: frozenset[str]) -> bool:
    forms = _forms(token)
    if not all(f.isalpha() for f in forms):
        return False
    candidates = set(forms)
    lookup = set(keys)
    # Squeezed comparison only for a word someone actually stretched (a
    # letter 3+ times): "Niger" squeezes to the same letters as a slur.
    if re.search(r"(.)\1{2,}", _key(token)):
        candidates |= {_squeezed(f) for f in forms}
        lookup |= {_squeezed(k) for k in keys}
    return any(c in lookup or any(c.endswith(end) and c[: -len(end)] in lookup for end in _ENDINGS) for c in candidates)


def clean(text: str | None, extra_words: frozenset[str] = frozenset()) -> str | None:
    """The text with every blocked word replaced by asterisks of its length."""
    if not text:
        return text
    keys = BUILT_IN_KEYS | extra_words
    return _WORD.sub(lambda m: "*" * len(m.group(0)) if _blocked(m.group(0), keys) else m.group(0), text)


def keys_for(words: list[str] | None) -> frozenset[str]:
    """A league's own words, in matching form."""
    return frozenset(_key(w) for w in (words or []) if w and w.strip())


async def league_keys(conn, league_id: int | None) -> frozenset[str]:
    if league_id is None:
        return frozenset()
    words = await conn.fetchval("SELECT words FROM league_chat_filter_words WHERE league_id = $1", league_id)
    return keys_for(words)


async def clean_for_league(conn, league_id: int | None, text: str | None) -> str | None:
    return clean(text, await league_keys(conn, league_id))
