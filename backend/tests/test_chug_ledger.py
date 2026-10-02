from datetime import datetime, timedelta, timezone

from app.domain.chug_ledger import replay

T0 = datetime(2026, 9, 14, 23, 0, tzinfo=timezone.utc)  # Week 1's Monday deadline


def at(days):
    return T0 + timedelta(days=days)


def test_earned_doubled_and_paid_in_order():
    events = replay(
        earned={2: 1, 3: 1},
        reasons={2: [{"player_name": "Miami Dolphins", "position": "DEF", "points": -6.0}], 3: []},
        settlements=[
            {"week": 2, "action": "no_debt", "owed_before": 0, "owed_after": 0, "settled_at": at(7)},
            {"week": 3, "action": "doubled", "owed_before": 1, "owed_after": 2, "settled_at": at(14)},
        ],
        chugs=[{"created_at": at(15), "final_score": 8.4}],
        actual_outstanding=2,
        week_deadlines={2: at(7), 3: at(14)},
    )
    kinds = [(e["kind"], e.get("week"), e["change"], e["balance"]) for e in events]
    # Week 2's chug lands after week 2's deadline; week 3's doubles it;
    # week 3's own chug is earned after week 3's deadline; then a chug pays one.
    assert kinds == [("earned", 2, 1, 1), ("doubled", 3, 1, 2), ("earned", 3, 1, 3), ("chug", None, -1, 2)]
    assert events[0]["reasons"][0]["points"] == -6.0


def test_fine_converts_and_for_fun_chugs_change_nothing():
    events = replay(
        earned={1: 2},
        reasons={},
        settlements=[{"week": 4, "action": "fined", "owed_before": 8, "owed_after": 0, "settled_at": at(21)}],
        chugs=[{"created_at": at(-3), "final_score": 9.0}],
        actual_outstanding=0,
        week_deadlines={1: at(0)},
    )
    assert events[0]["kind"] == "chug" and events[0]["change"] == 0
    fine = next(e for e in events if e["kind"] == "fined")
    assert fine["fine_amount"] == 80 and fine["balance"] == 0


def test_unrecorded_payments_show_as_an_adjustment():
    events = replay(earned={1: 3}, reasons={}, settlements=[], chugs=[], actual_outstanding=1, week_deadlines={1: at(0)})
    assert events[-1] == {"kind": "adjustment", "change": -2, "balance": 1}


def test_past_season_has_no_reconciliation():
    events = replay(earned={1: 1}, reasons={}, settlements=[], chugs=[], actual_outstanding=None)
    assert [e["kind"] for e in events] == ["earned"]
