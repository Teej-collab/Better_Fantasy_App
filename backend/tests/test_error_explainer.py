from app.error_explainer import explain, page_name


def test_react_errors_get_plain_english_by_number():
    hydration = explain("client", "Error: Minified React error #418; visit https://react.dev/errors/418?args[]=HTML", "/")
    assert hydration["headline"] == "Page didn't match the server"
    assert "the home page" in hydration["what"]
    assert hydration["severity"] == "low"

    server_render = explain("client", "Error: Minified React error #441; visit https://react.dev/errors/441", "/chug")
    assert "the Chug Board" in server_render["what"]
    assert "deploy" in server_render["what"]


def test_network_drops_read_as_a_lost_connection():
    assert explain("client", "TypeError: network error", "/")["headline"] == "Phone lost connection"
    assert explain("client", "TypeError: Load failed", "/team")["severity"] == "low"


def test_missing_data_names_the_field():
    e = explain("client", "TypeError: Cannot read properties of undefined (reading 'score')", "/matchups/12")
    assert '"score"' in e["what"]
    assert e["what"].startswith("A matchup")


def test_server_errors_say_what_the_request_was_doing():
    e = explain("server", "503 response from GET /leagues/{league_id}/standings", "/leagues/{league_id}/standings",
                method="GET")
    assert e["headline"] == "Server was down or too slow"
    assert "loading Standings" in e["what"]

    e = explain("server", "ReadTimeout: timed out", "/admin/sync", stack="httpx ... fantasy.espn.com", method="POST")
    assert e["headline"] == "ESPN was too slow"


def test_unknown_errors_still_read_as_a_sentence():
    e = explain("server", "ValueError: something odd", "/bets/slip", method="POST")
    assert e["headline"] == "Server error on Bets"
    assert 'saving on Bets: "something odd"' in e["what"]


def test_page_names():
    assert page_name("/") == "the home page"
    assert page_name("/leagues/{league_id}/standings") == "Standings"
    assert page_name("/somewhere-new") == "/somewhere-new"
    assert page_name(None) == "an unknown page"
