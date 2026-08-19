from datetime import datetime, timedelta, timezone

from app.providers.espn.lineup_client import ESPNLineupClient
from app.providers.espn.lineup_exceptions import (
    AmbiguousDisplacementError,
    InvalidSlotError,
    LineupLockedError,
    PlayerNotFoundError,
    SlotIneligibleError,
    TeamNotFoundError,
)
from tests.fakes_espn import FakeLeague, make_fake_lineup_player, make_fake_team

FUTURE = datetime.now(timezone.utc) + timedelta(days=1)
PAST = datetime.now(timezone.utc) - timedelta(hours=1)


def _team_with_roster(team_id, roster, position_slot_counts=None):
    team = make_fake_team(team_id, "Test Team", "test-member-1", "Alice", "Smith", roster=roster)
    league = FakeLeague(
        teams=[team],
        current_week=5,
        position_slot_counts=position_slot_counts
        or {"QB": 1, "RB": 2, "WR": 2, "TE": 1, "RB/WR/TE": 1, "D/ST": 1, "K": 1, "BE": 6, "IR": 1},
    )
    return league


def _patch(monkeypatch, league):
    monkeypatch.setattr("app.providers.espn.lineup_client.League", lambda **kwargs: league)


def test_get_roster_resolves_bench_and_flex_labels_correctly(espn_config, monkeypatch):
    roster = [
        make_fake_lineup_player(1, "Bench Guy", "BE", ["RB", "BE", "IR"]),
        make_fake_lineup_player(2, "Flex Guy", "RB/WR/TE", ["RB", "RB/WR/TE", "BE", "IR"]),
    ]
    _patch(monkeypatch, _team_with_roster(1, roster))

    client = ESPNLineupClient(espn_config)
    entries = {e.player_name: e for e in client.get_roster(1)}

    assert entries["Bench Guy"].lineup_slot_id == 20
    assert entries["Flex Guy"].lineup_slot_id == 23


def test_get_team_not_found_raises(espn_config, monkeypatch):
    _patch(monkeypatch, _team_with_roster(1, []))
    client = ESPNLineupClient(espn_config)
    try:
        client.get_team(999)
        assert False, "expected TeamNotFoundError"
    except TeamNotFoundError:
        pass


def test_get_player_not_found_raises(espn_config, monkeypatch):
    _patch(monkeypatch, _team_with_roster(1, [make_fake_lineup_player(1, "Real Player", "BE", ["RB", "BE"])]))
    client = ESPNLineupClient(espn_config)
    try:
        client.get_player(1, "Nobody")
        assert False, "expected PlayerNotFoundError"
    except PlayerNotFoundError:
        pass


def test_get_player_lookup_is_case_insensitive(espn_config, monkeypatch):
    _patch(monkeypatch, _team_with_roster(1, [make_fake_lineup_player(1, "Real Player", "BE", ["RB", "BE"])]))
    client = ESPNLineupClient(espn_config)
    assert client.get_player(1, "real player").player_id == 1


def test_plan_lineup_change_valid_open_slot(espn_config, monkeypatch):
    roster = [make_fake_lineup_player(1, "Bench RB", "BE", ["RB", "BE", "IR"])]
    _patch(monkeypatch, _team_with_roster(1, roster))
    client = ESPNLineupClient(espn_config)

    plan = client.plan_lineup_change(1, "Bench RB", "RB")
    assert plan.to_slot_id == 2
    assert plan.displaced_player is None


def test_plan_lineup_change_invalid_slot_label(espn_config, monkeypatch):
    roster = [make_fake_lineup_player(1, "Bench RB", "BE", ["RB", "BE"])]
    _patch(monkeypatch, _team_with_roster(1, roster))
    client = ESPNLineupClient(espn_config)
    try:
        client.plan_lineup_change(1, "Bench RB", "NOT_A_SLOT")
        assert False, "expected InvalidSlotError"
    except InvalidSlotError:
        pass


def test_plan_lineup_change_ineligible_slot(espn_config, monkeypatch):
    roster = [make_fake_lineup_player(1, "Kicker Only", "BE", ["K", "BE"])]
    _patch(monkeypatch, _team_with_roster(1, roster))
    client = ESPNLineupClient(espn_config)
    try:
        client.plan_lineup_change(1, "Kicker Only", "RB")
        assert False, "expected SlotIneligibleError"
    except SlotIneligibleError:
        pass


def test_plan_lineup_change_locked_player(espn_config, monkeypatch):
    roster = [
        make_fake_lineup_player(
            1, "Locked RB", "BE", ["RB", "BE"], schedule={5: {"team": "KC", "date": PAST}}
        )
    ]
    _patch(monkeypatch, _team_with_roster(1, roster))
    client = ESPNLineupClient(espn_config)
    try:
        client.plan_lineup_change(1, "Locked RB", "RB")
        assert False, "expected LineupLockedError"
    except LineupLockedError:
        pass


def test_plan_lineup_change_future_game_is_not_locked(espn_config, monkeypatch):
    roster = [
        make_fake_lineup_player(
            1, "Not Locked RB", "BE", ["RB", "BE"], schedule={5: {"team": "KC", "date": FUTURE}}
        )
    ]
    _patch(monkeypatch, _team_with_roster(1, roster))
    client = ESPNLineupClient(espn_config)
    plan = client.plan_lineup_change(1, "Not Locked RB", "RB")
    assert plan.to_slot_id == 2


def test_plan_lineup_change_displaces_sole_occupant(espn_config, monkeypatch):
    roster = [
        make_fake_lineup_player(1, "Starting QB", "QB", ["QB", "BE"]),
        make_fake_lineup_player(2, "Bench QB", "BE", ["QB", "BE"]),
    ]
    _patch(monkeypatch, _team_with_roster(1, roster, position_slot_counts={"QB": 1, "BE": 6}))
    client = ESPNLineupClient(espn_config)

    plan = client.plan_lineup_change(1, "Bench QB", "QB")
    assert plan.displaced_player.player_name == "Starting QB"


def test_plan_lineup_change_ambiguous_displacement_raises(espn_config, monkeypatch):
    roster = [
        make_fake_lineup_player(1, "RB One", "RB", ["RB", "BE"]),
        make_fake_lineup_player(2, "RB Two", "RB", ["RB", "BE"]),
        make_fake_lineup_player(3, "Bench RB", "BE", ["RB", "BE"]),
    ]
    # capacity 1 but 2 occupants already — an inconsistent fixture on
    # purpose, to exercise the "more occupants than we can resolve"
    # ambiguity path regardless of how it arose.
    _patch(monkeypatch, _team_with_roster(1, roster, position_slot_counts={"RB": 1, "BE": 6}))
    client = ESPNLineupClient(espn_config)
    try:
        client.plan_lineup_change(1, "Bench RB", "RB")
        assert False, "expected AmbiguousDisplacementError"
    except AmbiguousDisplacementError:
        pass


def test_plan_swap_valid(espn_config, monkeypatch):
    roster = [
        make_fake_lineup_player(1, "Starter", "RB", ["RB", "BE"]),
        make_fake_lineup_player(2, "Bencher", "BE", ["RB", "BE"]),
    ]
    _patch(monkeypatch, _team_with_roster(1, roster))
    client = ESPNLineupClient(espn_config)

    plan = client.plan_swap(1, "Starter", "Bencher")
    assert {plan.player_a.player_name, plan.player_b.player_name} == {"Starter", "Bencher"}


def test_plan_swap_ineligible_raises(espn_config, monkeypatch):
    roster = [
        make_fake_lineup_player(1, "Kicker", "K", ["K", "BE"]),
        make_fake_lineup_player(2, "Bench RB", "BE", ["RB", "BE"]),
    ]
    _patch(monkeypatch, _team_with_roster(1, roster))
    client = ESPNLineupClient(espn_config)
    try:
        client.plan_swap(1, "Kicker", "Bench RB")
        assert False, "expected SlotIneligibleError"
    except SlotIneligibleError:
        pass


def test_verify_lineup_true_when_matching(espn_config, monkeypatch):
    roster = [make_fake_lineup_player(1, "Player", "RB", ["RB", "BE"])]
    _patch(monkeypatch, _team_with_roster(1, roster))
    client = ESPNLineupClient(espn_config)
    assert client.verify_lineup(1, {1: 2}) is True


def test_verify_lineup_false_when_mutation_did_not_take(espn_config, monkeypatch):
    # Simulates Phase 7's core case: we asked for slot 2 (RB) but the
    # live roster still shows the player on the bench (20) — must not be
    # reported as a success.
    roster = [make_fake_lineup_player(1, "Player", "BE", ["RB", "BE"])]
    _patch(monkeypatch, _team_with_roster(1, roster))
    client = ESPNLineupClient(espn_config)
    assert client.verify_lineup(1, {1: 2}) is False


def test_set_lineup_dry_run_does_not_attempt_and_says_so(espn_config, monkeypatch):
    espn_config.dry_run = True
    roster = [make_fake_lineup_player(1, "Bench RB", "BE", ["RB", "BE"])]
    _patch(monkeypatch, _team_with_roster(1, roster))
    client = ESPNLineupClient(espn_config)

    result = client.set_lineup(1, "Bench RB", "RB")
    assert result.dry_run is True
    assert result.attempted is False
    assert result.verified is False
    assert "DRY RUN" in result.detail


def test_set_lineup_with_displacement_dry_run_describes_both_players(espn_config, monkeypatch):
    # Planning/dry-run coverage only — this file never mocks
    # requests.post, so it never runs with dry_run=False. Full send
    # coverage for the (now verified) 2-item displacement shape lives in
    # test_espn_lineup_write.py, alongside the swap-shape test.
    espn_config.dry_run = True
    roster = [
        make_fake_lineup_player(1, "Starting QB", "QB", ["QB", "BE"]),
        make_fake_lineup_player(2, "Bench QB", "BE", ["QB", "BE"]),
    ]
    _patch(monkeypatch, _team_with_roster(1, roster, position_slot_counts={"QB": 1, "BE": 6}))
    client = ESPNLineupClient(espn_config)

    result = client.set_lineup(1, "Bench QB", "QB")
    assert result.dry_run is True
    assert "displaces=1" in result.detail


def test_dry_run_log_never_contains_credentials(espn_config, monkeypatch, caplog):
    espn_config.dry_run = True
    espn_config.espn_s2 = "super-secret-s2-value"
    espn_config.swid = "super-secret-swid-value"
    roster = [make_fake_lineup_player(1, "Bench RB", "BE", ["RB", "BE"])]
    _patch(monkeypatch, _team_with_roster(1, roster))
    client = ESPNLineupClient(espn_config)

    with caplog.at_level("INFO"):
        client.set_lineup(1, "Bench RB", "RB")

    log_text = "\n".join(r.getMessage() for r in caplog.records)
    assert "super-secret-s2-value" not in log_text
    assert "super-secret-swid-value" not in log_text
