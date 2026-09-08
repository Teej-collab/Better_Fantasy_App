from types import SimpleNamespace

from app.providers import anthropic_narrative


def _fake_response(blocks):
    return SimpleNamespace(content=blocks)


def test_generate_narrative_finds_text_block_after_a_thinking_block(monkeypatch):
    """Real production bug (2026-09): the model can emit a ThinkingBlock
    (no .text attribute) before the actual TextBlock — content[0] isn't
    reliably the text block."""
    monkeypatch.setattr(anthropic_narrative, "config", SimpleNamespace(ANTHROPIC_API_KEY="fake-key"))
    blocks = [
        SimpleNamespace(type="thinking", thinking="internal reasoning, no .text here"),
        SimpleNamespace(type="text", text="  The real recap.  "),
    ]
    fake_client = SimpleNamespace(messages=SimpleNamespace(create=lambda **kwargs: _fake_response(blocks)))
    monkeypatch.setattr(anthropic_narrative, "_client", fake_client)

    result = anthropic_narrative.generate_narrative("system prompt", "facts")
    assert result == "The real recap."


def test_generate_narrative_works_when_text_block_is_first(monkeypatch):
    monkeypatch.setattr(anthropic_narrative, "config", SimpleNamespace(ANTHROPIC_API_KEY="fake-key"))
    blocks = [SimpleNamespace(type="text", text="Just the recap.")]
    fake_client = SimpleNamespace(messages=SimpleNamespace(create=lambda **kwargs: _fake_response(blocks)))
    monkeypatch.setattr(anthropic_narrative, "_client", fake_client)

    result = anthropic_narrative.generate_narrative("system prompt", "facts")
    assert result == "Just the recap."


def test_generate_narrative_raises_when_no_text_block_present(monkeypatch):
    monkeypatch.setattr(anthropic_narrative, "config", SimpleNamespace(ANTHROPIC_API_KEY="fake-key"))
    blocks = [SimpleNamespace(type="thinking", thinking="only thinking, no answer")]
    fake_client = SimpleNamespace(messages=SimpleNamespace(create=lambda **kwargs: _fake_response(blocks)))
    monkeypatch.setattr(anthropic_narrative, "_client", fake_client)

    try:
        anthropic_narrative.generate_narrative("system prompt", "facts")
        assert False, "expected a RuntimeError"
    except RuntimeError:
        pass
