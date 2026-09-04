"""Pure unit tests for app/analytics/taxonomy.py — no DB needed, this
is the one gate every incoming analytics event passes through before
it's ever trusted (POST /admin/track)."""
from app.analytics import taxonomy


def test_classify_route_matches_known_prefixes():
    assert taxonomy.classify_route("/") == "nav_home"
    assert taxonomy.classify_route("/standings") == "nav_standings"
    assert taxonomy.classify_route("/matchups/123") == "nav_matchups"
    assert taxonomy.classify_route("/gamecast") == "nav_gamecast"
    assert taxonomy.classify_route("/gamecast/abc123") == "nav_gamecast"
    assert taxonomy.classify_route("/admin/users/5") == "nav_admin"


def test_classify_route_falls_back_for_an_unknown_path():
    assert taxonomy.classify_route("/some-page-nobody-taught-this-list-about") == taxonomy.FALLBACK_EVENT_NAME


def test_classify_route_does_not_prefix_match_a_similar_but_different_route():
    # "/league" is a real prefix; "/leaguesomethingelse" must not
    # accidentally match it (only "/league" or "/league/...").
    assert taxonomy.classify_route("/leaguesomethingelse") != "nav_league"


def test_validate_event_accepts_a_known_page_view():
    assert taxonomy.validate_event("nav_standings", "page_view", {}, "mobile", "ios") is None


def test_validate_event_rejects_an_unknown_event_type():
    assert taxonomy.validate_event("nav_standings", "click", {}, None, None) is not None


def test_validate_event_rejects_an_unknown_page_view_name():
    assert taxonomy.validate_event("nav_not_real", "page_view", {}, None, None) is not None


def test_validate_event_accepts_a_known_feature_event_with_valid_metadata():
    assert taxonomy.validate_event("league_switched", "feature", {"to_league_id": 5}, None, None) is None


def test_validate_event_rejects_an_unknown_feature_name():
    assert taxonomy.validate_event("not_a_real_feature", "feature", {}, None, None) is not None


def test_validate_event_rejects_a_disallowed_metadata_key():
    assert taxonomy.validate_event("league_switched", "feature", {"password": "x"}, None, None) is not None
    assert (
        taxonomy.validate_event("league_switched", "feature", {"to_league_id": 5, "extra": "x"}, None, None)
        is not None
    )


def test_validate_event_rejects_an_overly_long_metadata_value():
    long_value = "x" * (taxonomy.MAX_METADATA_VALUE_LENGTH + 1)
    assert taxonomy.validate_event("gamecast_game_selected", "feature", {"game_id": long_value}, None, None) is not None


def test_validate_event_rejects_an_invalid_device_type():
    assert taxonomy.validate_event("nav_home", "page_view", {}, "smart_fridge", None) is not None


def test_validate_event_rejects_an_invalid_platform():
    assert taxonomy.validate_event("nav_home", "page_view", {}, None, "blackberry") is not None


def test_validate_event_allows_null_device_and_platform():
    assert taxonomy.validate_event("nav_home", "page_view", {}, None, None) is None
