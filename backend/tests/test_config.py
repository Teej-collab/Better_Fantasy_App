import pytest

from app.config import _require


def test_require_raises_when_missing(monkeypatch):
    monkeypatch.delenv("SOME_TOTALLY_UNSET_VAR", raising=False)
    with pytest.raises(RuntimeError, match="SOME_TOTALLY_UNSET_VAR"):
        _require("SOME_TOTALLY_UNSET_VAR")


def test_require_returns_value_when_present(monkeypatch):
    monkeypatch.setenv("SOME_VAR", "value123")
    assert _require("SOME_VAR") == "value123"
