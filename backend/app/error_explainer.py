"""
Plain-English versions of the errors in app_errors, for the admin push
alert and the Errors pages. A raw error ("Minified React error #418;
visit https://react.dev/errors/418?args[]=HTML…") says nothing to
someone who didn't write the code, so each known kind gets:

- headline: a few words, the push title ("Page didn't match the server");
- what: what actually happened, in a sentence or two;
- impact: what the person using the app most likely saw;
- next_step: whether to do anything about it, and what;
- severity: "low" (harmless or not our bug), "medium", or "high"
  (someone hit a broken screen or a failed save).

Anything unrecognized still gets a readable fallback built from the
error's type and the page it happened on, with the raw message kept
on the detail page for debugging.
"""
import re

# First path segment → the page's name as people know it.
_PAGE_NAMES = {
    "": "the home page",
    "chug": "the Chug Board",
    "punishment-wheel": "the Punishment Wheel",
    "matchups": "a matchup",
    "matchup": "a matchup",
    "team": "My Team",
    "teams": "Teams",
    "standings": "Standings",
    "power-rankings": "Power Rankings",
    "rivalries": "Rivalries",
    "players": "a player page",
    "free-agents": "Free Agents",
    "trades": "Trades",
    "activity": "Activity",
    "bets": "Bets",
    "chat": "Chat",
    "lounge": "the Lounge",
    "gamecast": "Gamecast",
    "draft": "the Draft",
    "keepers": "Keepers",
    "war-room": "the War Room",
    "history": "History",
    "seasons": "Seasons",
    "bracket": "the Bracket",
    "awards": "Awards",
    "settings": "Settings",
    "commissioner": "the Commissioner tools",
    "admin": "the admin pages",
    "login": "the sign-in page",
    "leagues": "Leagues",
    "league": "the League page",
    "scoring": "Scoring",
    "rules": "Rules",
    "more": "More",
    "weekend": "the Weekend page",
    "brain": "the Brain",
    "auth": "sign-in",
    "me": "your account",
    "nfl": "NFL scores",
    "push": "notifications",
}

# React production errors arrive as "Minified React error #N" with the
# real message stripped. The ones worth knowing by number.
_REACT = {
    418: ("Page didn't match the server",
          "The website's server built {page} one way and the phone drew it slightly differently (usually a time, "
          "date or something that depends on the device), so the browser threw the server's version away and "
          "redrew it.",
          "Most likely nothing, or a quick flicker as the page redrew.",
          "Low priority. Worth fixing only if it keeps happening on the same page.",
          "low"),
    419: ("Server couldn't finish part of a page",
          "The website's server failed partway through building {page}, so the phone built that part itself.",
          "The page loaded, maybe a beat slower.",
          "Low priority unless it repeats.",
          "low"),
    421: ("Page updated before it finished loading",
          "Something on {page} changed before the page had finished loading, so part of it was rebuilt from scratch.",
          "Most likely nothing, or a quick flicker.",
          "Low priority.",
          "low"),
    422: ("Page loaded with a hiccup",
          "Part of {page} failed while loading, and React rebuilt that part on the phone instead.",
          "The page loaded, maybe with a flicker.",
          "Low priority unless it repeats.",
          "low"),
    423: ("Page loaded with a hiccup",
          "{Page} failed while loading, and React rebuilt the whole page on the phone instead.",
          "A flicker or a slower load.",
          "Low priority unless it repeats.",
          "low"),
    425: ("Page text didn't match the server",
          "Some text on {page} came out different on the phone than on the website's server (usually a time or "
          "date), so it was redrawn.",
          "Most likely nothing, or text changing as the page loaded.",
          "Low priority.",
          "low"),
    441: ("Website server crashed building a page",
          "The website's server hit an error while building {page}. Most often that's the backend restarting for "
          "a deploy (about 15–20 seconds of downtime); otherwise the real reason is in the website's logs on Vercel.",
          "Probably the error screen instead of the page; a refresh likely fixed it.",
          "If a deploy went out at that moment, nothing to fix. If not, check Vercel's logs around this time.",
          "medium"),
    185: ("Page got stuck in a loop",
          "{Page} kept updating itself over and over until React stopped it.",
          "A frozen or broken page.",
          "Needs a fix — this is a bug in the page's code.",
          "high"),
    300: ("Page code bug",
          "{Page} drew a different set of parts than the time before, which React doesn't allow.",
          "Probably the error screen.",
          "Needs a fix.",
          "high"),
    310: ("Page code bug",
          "{Page} drew a different set of parts than the time before, which React doesn't allow.",
          "Probably the error screen.",
          "Needs a fix.",
          "high"),
    31: ("Page tried to show raw data",
         "{Page} tried to put a piece of data straight on screen instead of turning it into text first.",
         "Probably the error screen.",
         "Needs a fix — usually an API response shaped differently than expected.",
         "high"),
    130: ("Page code bug",
          "{Page} tried to show a component that didn't exist (usually a bad import).",
          "Probably the error screen.",
          "Needs a fix.",
          "high"),
}

_NETWORK = re.compile(
    r"network ?error|network request failed|failed to fetch|load failed|the network connection was lost|"
    r"internet connection appears to be offline|ERR_INTERNET_DISCONNECTED|ERR_NETWORK",
    re.IGNORECASE,
)
_ABORTED = re.compile(r"AbortError|operation was aborted|aborted|cancelled", re.IGNORECASE)
_STALE_BUILD = re.compile(
    r"ChunkLoadError|Loading chunk .* failed|Loading CSS chunk|dynamically imported module|"
    r"error loading dynamically imported|Failed to find Server Action",
    re.IGNORECASE,
)
_MISSING_FIELD = [
    re.compile(r"Cannot read propert(?:y|ies) of (?:undefined|null) \(reading '([^']+)'\)"),
    re.compile(r"undefined is not an object \(evaluating '[^']*?\.?([\w$]+)'\)"),
    re.compile(r"null is not an object \(evaluating '[^']*?\.?([\w$]+)'\)"),
    re.compile(r"Cannot read property '([^']+)' of (?:undefined|null)"),
]
_NOT_A_FUNCTION = re.compile(r"([\w$.]+) is not a function")
_NOT_DEFINED = re.compile(r"Can't find variable: ([\w$]+)|([\w$]+) is not defined")
_BAD_JSON = re.compile(r"JSON Parse error|Unexpected token .* in JSON|is not valid JSON|Unexpected end of JSON", re.IGNORECASE)
_STATUS_RESPONSE = re.compile(r"^(\d{3}) response from (\w+) (\S+)")

_SERVICES = [
    (re.compile(r"espn", re.IGNORECASE), "ESPN"),
    (re.compile(r"sleeper", re.IGNORECASE), "Sleeper"),
    (re.compile(r"sportradar", re.IGNORECASE), "Sportradar"),
    (re.compile(r"anthropic|claude", re.IGNORECASE), "Claude (the AI writer)"),
    (re.compile(r"apns|fcm|webpush|pywebpush|expo", re.IGNORECASE), "the push notification service"),
]


def page_name(route: str | None) -> str:
    """The most specific page name in a route: /matchups/123 → "a
    matchup", /leagues/{league_id}/standings → "Standings"."""
    if route is None:
        return "an unknown page"
    segments = [seg for seg in route.split("?")[0].strip("/").split("/") if seg and not seg.startswith("{")]
    for seg in reversed(segments or [""]):
        if seg in _PAGE_NAMES and seg not in ("leagues", "me", "admin"):
            return _PAGE_NAMES[seg]
    if segments and segments[0] in _PAGE_NAMES:
        return _PAGE_NAMES[segments[0]]
    return route


def _result(headline, what, impact, next_step, severity, page) -> dict:
    def fill(text: str) -> str:
        return text.replace("{page}", page).replace("{Page}", page[:1].upper() + page[1:])

    return {
        "headline": headline,
        "what": fill(what),
        "impact": fill(impact),
        "next_step": fill(next_step),
        "severity": severity,
    }


def _service(text: str) -> str | None:
    for pattern, name in _SERVICES:
        if pattern.search(text):
            return name
    return None


def explain(source: str, message: str, route: str | None = None, stack: str | None = None,
            method: str | None = None) -> dict:
    message = (message or "").strip()
    page = page_name(route)
    if source == "server":
        return _explain_server(message, stack or "", method, page)
    return _explain_client(message, page)


def _explain_client(message: str, page: str) -> dict:
    react = re.search(r"Minified React error #(\d+)", message)
    if react:
        code = int(react.group(1))
        if code in _REACT:
            return _result(*_REACT[code], page)
        return _result(
            "Page code error",
            f"React (the code that draws the screen) hit error #{code} on {{page}}.",
            "Possibly the error screen.",
            f"Look it up at react.dev/errors/{code}.",
            "medium", page,
        )
    if re.search(r"hydrat", message, re.IGNORECASE):
        return _result(*_REACT[418], page)
    if _NETWORK.search(message):
        return _result(
            "Phone lost connection",
            "A request from {page} never reached the server — the phone's signal or Wi-Fi dropped mid-load.",
            "Something didn't load until they retried or refreshed.",
            "Nothing to fix; it's their connection. Only worth a look if lots of people hit it at once "
            "(then the server may have been down).",
            "low", page,
        )
    if _STALE_BUILD.search(message):
        return _result(
            "Old version of the site",
            "{Page} was open from before the last update, and it went looking for a file the update replaced.",
            "A broken or blank page until they refreshed.",
            "Nothing to fix — a refresh gets them the new version.",
            "low", page,
        )
    if _ABORTED.search(message):
        return _result(
            "Request cancelled",
            "A request on {page} was cancelled, usually because they left the page before it finished.",
            "Nothing.",
            "Nothing to fix.",
            "low", page,
        )
    for pattern in _MISSING_FIELD:
        match = pattern.search(message)
        if match:
            return _result(
                "Missing data crashed a page",
                f"{{Page}} tried to use \"{match.group(1)}\" on something that was empty — data it expected "
                "wasn't there (not loaded yet, or missing for this team/player).",
                "Probably the error screen, or part of the page didn't show.",
                "Needs a fix — open the occurrence below to see which part of the code it was.",
                "high", page,
            )
    if _BAD_JSON.search(message):
        return _result(
            "Server sent back an error page",
            "{Page} asked the server for data and got something that wasn't data — usually an error page "
            "because the server was down, restarting, or failed.",
            "Part of the page didn't load.",
            "Check whether there was a deploy or server error at the same time.",
            "medium", page,
        )
    match = _NOT_A_FUNCTION.search(message)
    if match:
        return _result(
            "Page code bug",
            f"{{Page}} tried to run \"{match.group(1)}\" but it wasn't something that can be run — often data "
            "shaped differently than the code expected.",
            "Probably the error screen.",
            "Needs a fix.",
            "high", page,
        )
    if message.startswith("ReferenceError") or "Can't find variable" in message:
        match = _NOT_DEFINED.search(message)
        name = (match.group(1) or match.group(2)) if match else "something"
        return _result(
            "Page code bug",
            f"{{Page}} used \"{name}\", which doesn't exist on this device or browser.",
            "Probably the error screen.",
            "Needs a fix — often a feature older phones/browsers don't have.",
            "high", page,
        )
    if "Maximum call stack" in message or "too much recursion" in message:
        return _result(
            "Page got stuck in a loop",
            "{Page} kept calling itself until the phone gave up.",
            "A frozen or broken page.",
            "Needs a fix.",
            "high", page,
        )
    if "QuotaExceeded" in message:
        return _result(
            "Phone storage full",
            "{Page} tried to save something on the phone and the browser's storage was full.",
            "Probably nothing visible; a setting may not have stuck.",
            "Low priority.",
            "low", page,
        )
    if "NotAllowedError" in message:
        return _result(
            "Phone blocked an action",
            "{Page} tried to do something the phone wants a tap or permission for first (play sound, "
            "camera, notifications, copy to clipboard).",
            "A sound, permission prompt or copy didn't happen.",
            "Usually harmless.",
            "low", page,
        )
    return _fallback("App error", message, page, "on their device")


def _explain_server(message: str, stack: str, method: str | None, page: str) -> dict:
    # "loading Standings" / "saving on My Team", for the sentences below.
    where = f"saving on {page}" if method and method not in ("GET", "HEAD") else f"loading {page}"
    status = _STATUS_RESPONSE.match(message)
    if status:
        code = int(status.group(1))
        if code in (502, 503, 504):
            return _result(
                "Server was down or too slow",
                f"The server didn't answer in time while {where} (a {code}) — usually a deploy restarting it, or it "
                "was overloaded.",
                "That screen failed to load or save; a retry probably worked.",
                "Check whether a deploy was going out then. If not, look at Railway's metrics.",
                "medium", page,
            )
        return _result(
            "Server request failed",
            f"The server sent back an error ({code}) instead of the data while {where}.",
            "That screen failed to load or save.",
            "Needs a look — open the occurrence for details.",
            "high", page,
        )

    kind = message.split(":", 1)[0].strip()
    detail = message.split(":", 1)[1].strip() if ":" in message else ""
    service = _service(f"{message}\n{stack[-1500:]}")

    if re.search(r"Timeout|TimedOut|timed out", kind + detail, re.IGNORECASE):
        if service:
            return _result(
                f"{service} was too slow",
                f"The server asked {service} for something while {where} and gave up waiting.",
                "That screen failed to load or update; it usually works on the next try.",
                f"Nothing to fix unless it keeps happening — {service} was slow, not us.",
                "medium", page,
            )
        return _result(
            "Server request took too long",
            f"The server took too long while {where} and was stopped.",
            "That screen failed to load or save.",
            "Worth a look if it repeats — something is slow.",
            "medium", page,
        )
    if re.search(r"HTTPStatusError|ConnectError|RemoteProtocolError|ReadError", kind) and service:
        return _result(
            f"{service} had a problem",
            f"The server asked {service} for something while {where} and {service} returned an error.",
            "That part of the app didn't update.",
            f"Usually {service}'s problem, not ours. Check again if it repeats.",
            "medium", page,
        )
    if service and re.search(r"RateLimit|Overloaded|APIStatusError|APIConnectionError", kind):
        return _result(
            f"{service} turned us away",
            f"{service} refused a request while {where} (too busy or too many requests).",
            "Whatever that service writes (recaps, slips, scores) didn't come through this time.",
            "Usually temporary.",
            "medium", page,
        )
    if re.search(r"UniqueViolation", kind):
        return _result(
            "Tried to save something twice",
            f"While {where}, the server tried to save a row that already exists (often a double-tap or two requests at once).",
            "The save may have failed with an error.",
            "Needs a fix if it repeats — the code should handle the duplicate.",
            "medium", page,
        )
    if re.search(r"ForeignKeyViolation", kind):
        return _result(
            "Saved something that points at nothing",
            f"While {where}, the server tried to save something linked to a team, player or user that doesn't exist (anymore).",
            "The save failed.",
            "Needs a look.",
            "high", page,
        )
    if re.search(r"NotNullViolation|DataError|InvalidTextRepresentation|NumericValueOutOfRange", kind):
        return _result(
            "Bad data in a save",
            f"While {where}, the server tried to save a value the database won't accept (missing or the wrong type).",
            "The save failed.",
            "Needs a fix.",
            "high", page,
        )
    if re.search(r"UndefinedColumn|UndefinedTable|UndefinedFunction", kind):
        return _result(
            "Database is missing a change",
            f"While {where}, the server used a database column or table that doesn't exist — usually a migration that "
            "hasn't been run on production yet.",
            "That screen fails every time.",
            "Run the pending migration on production.",
            "high", page,
        )
    if re.search(r"Connection|TooManyConnections|InterfaceError|CannotConnectNow", kind):
        return _result(
            "Lost the database connection",
            f"The server lost its connection to the database while {where} (often during a deploy or restart).",
            "That screen failed to load or save; a retry probably worked.",
            "Nothing to fix unless it repeats.",
            "medium", page,
        )
    if kind == "KeyError":
        return _result(
            "Expected data was missing",
            f"While {where}, the server looked for \"{detail.strip(chr(39))}\" in some data and it wasn't there"
            + (f" (probably from {service})." if service else "."),
            "That screen failed to load or save.",
            "Needs a fix.",
            "high", page,
        )
    if kind == "TypeError" and "NoneType" in detail:
        return _result(
            "Missing data broke a request",
            f"While {where}, the server tried to use something that was empty (None) — data it expected wasn't there.",
            "That screen failed to load or save.",
            "Needs a fix.",
            "high", page,
        )
    if kind == "ZeroDivisionError":
        return _result(
            "Divided by zero",
            f"While {where}, the server did math with a zero it didn't expect (e.g. a percentage with no games played yet).",
            "That screen failed to load.",
            "Needs a fix.",
            "high", page,
        )
    return _fallback("Server error", message, page, f"on the server while {where}", service)


def _fallback(label: str, message: str, page: str, where: str, service: str | None = None) -> dict:
    kind = message.split(":", 1)[0].strip() if ":" in message else ""
    kind = kind if re.fullmatch(r"[A-Za-z_.]+", kind or "") else ""
    detail = message.split(":", 1)[1].strip() if kind else message
    detail = detail[:140] + ("…" if len(detail) > 140 else "")
    service_note = f" It looks related to {service}." if service else ""
    return _result(
        f"{label} on {page}" if page != "an unknown page" else label,
        f"Something went wrong {where}: \"{detail}\".{service_note}",
        "Possibly an error screen or a part of the page that didn't load.",
        "Not a known kind yet — open the occurrence for the full details.",
        "medium", page,
    )
