"""
Thin wrapper around the Anthropic Messages API for weekly matchup
write-ups — the only place in this app that calls an LLM. Adapted from
Fantasy_Helper's bot/narrative_engine/llm_client.py (same shape: one
system prompt + a facts string as the user message, low max_tokens),
using the current Claude model rather than that repo's now-stale one.

ANTHROPIC_API_KEY (app/config.py) is empty until the owner supplies a
real one — generate_narrative fails loud with a clear message rather
than a cryptic auth error if it's missing, since this is the one
feature in the app that costs real money per call and shouldn't run
silently misconfigured. app/domain/narrative_engine.py checks the key
is present *before* ever calling this, so in practice this error only
fires if that check is ever bypassed.
"""
import logging

from anthropic import Anthropic

from app import config

logger = logging.getLogger(__name__)

MODEL = "claude-sonnet-5"

_client: Anthropic | None = None


def _get_client() -> Anthropic:
    global _client
    if not config.ANTHROPIC_API_KEY:
        raise RuntimeError(
            "ANTHROPIC_API_KEY is not set — the weekly write-up feature needs a real key "
            "(backend/.env) before it can generate anything."
        )
    if _client is None:
        _client = Anthropic(api_key=config.ANTHROPIC_API_KEY)
    return _client


def generate_narrative(system_prompt: str, facts: str, max_tokens: int = 500) -> str:
    """One matchup write-up (preview or recap — the caller picks the
    system prompt for which). `facts` is the only real-world content in
    the request — every number/name in it is already verified data
    (see app/domain/narrative_engine.py's payload builder), so the
    model is never asked to invent anything, only phrase what's true."""
    client = _get_client()
    response = client.messages.create(
        model=MODEL,
        max_tokens=max_tokens,
        system=system_prompt,
        messages=[{"role": "user", "content": facts}],
    )
    # 2026-09-15 fix, real report: a real weekly recap shipped cut off
    # mid-sentence because it hit max_tokens — the API returns whatever
    # it managed to generate with no error, so that failure was
    # completely silent until a real user saw the broken text. Logging
    # it here (rather than only raising max_tokens further, see
    # narrative_engine.WEEKLY_MAX_TOKENS's own comment) means the NEXT
    # time this happens it's a log line to investigate, not another
    # user-reported broken recap.
    if getattr(response, "stop_reason", None) == "max_tokens":
        logger.warning(
            "Anthropic narrative hit max_tokens (%d) and was truncated — consider raising it", max_tokens
        )

    # response.content[0] isn't reliably the text block — the model can
    # emit a ThinkingBlock (no .text attribute) ahead of the real
    # TextBlock, and did in production (2026-09, AttributeError on a
    # real draft-narrative regeneration). Find the actual text block by
    # type instead of assuming position 0.
    for block in response.content:
        if getattr(block, "type", None) == "text":
            return block.text.strip()
    raise RuntimeError("Anthropic response contained no text block")
