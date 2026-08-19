from app.providers.espn.config import ESPNConfig


def test_dry_run_defaults_to_true_when_unset(monkeypatch):
    monkeypatch.setenv("ESPN_LEAGUE_ID", "12345")
    monkeypatch.setenv("ESPN_S2", "fake")
    monkeypatch.setenv("ESPN_SWID", "fake")
    monkeypatch.setenv("ACTIVE_SEASON", "2024")
    monkeypatch.delenv("ESPN_DRY_RUN", raising=False)

    assert ESPNConfig().dry_run is True


def test_dry_run_false_only_when_explicitly_set(monkeypatch):
    monkeypatch.setenv("ESPN_LEAGUE_ID", "12345")
    monkeypatch.setenv("ESPN_S2", "fake")
    monkeypatch.setenv("ESPN_SWID", "fake")
    monkeypatch.setenv("ACTIVE_SEASON", "2024")
    monkeypatch.setenv("ESPN_DRY_RUN", "false")

    assert ESPNConfig().dry_run is False


def test_dry_run_true_for_any_non_false_value(monkeypatch):
    monkeypatch.setenv("ESPN_LEAGUE_ID", "12345")
    monkeypatch.setenv("ESPN_S2", "fake")
    monkeypatch.setenv("ESPN_SWID", "fake")
    monkeypatch.setenv("ACTIVE_SEASON", "2024")
    monkeypatch.setenv("ESPN_DRY_RUN", "true")

    assert ESPNConfig().dry_run is True
