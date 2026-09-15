from types import SimpleNamespace

from app.providers import anthropic_narrative


def _fake_response(blocks, stop_reason="end_turn"):
    return SimpleNamespace(content=blocks, stop_reason=stop_reason)


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


def test_generate_narrative_logs_a_warning_when_truncated_by_max_tokens(monkeypatch, caplog):
    # 2026-09-15 fix, real report: a real weekly recap shipped cut off
    # mid-sentence because it silently hit max_tokens — this is the
    # regression test for the fix, which logs a warning instead of
    # staying silent so a truncated generation is at least visible.
    monkeypatch.setattr(anthropic_narrative, "config", SimpleNamespace(ANTHROPIC_API_KEY="fake-key"))
    blocks = [SimpleNamespace(type="text", text="Cut off mid-")]
    fake_client = SimpleNamespace(
        messages=SimpleNamespace(create=lambda **kwargs: _fake_response(blocks, stop_reason="max_tokens"))
    )
    monkeypatch.setattr(anthropic_narrative, "_client", fake_client)

    with caplog.at_level("WARNING"):
        result = anthropic_narrative.generate_narrative("system prompt", "facts", max_tokens=900)

    assert result == "Cut off mid-"
    assert any("max_tokens" in record.message for record in caplog.records)


def test_generate_narrative_does_not_warn_on_a_normal_completion(monkeypatch, caplog):
    monkeypatch.setattr(anthropic_narrative, "config", SimpleNamespace(ANTHROPIC_API_KEY="fake-key"))
    blocks = [SimpleNamespace(type="text", text="A complete recap.")]
    fake_client = SimpleNamespace(
        messages=SimpleNamespace(create=lambda **kwargs: _fake_response(blocks, stop_reason="end_turn"))
    )
    monkeypatch.setattr(anthropic_narrative, "_client", fake_client)

    with caplog.at_level("WARNING"):
        anthropic_narrative.generate_narrative("system prompt", "facts")

    assert len(caplog.records) == 0
