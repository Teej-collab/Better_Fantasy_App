"""add waiver_wire, waiver_claims, and team_waiver_priority tables

Real waiver-wire system (competitive audit's #1 confirmed functional
gap, 2026-09): free-agent pickups have been instant/first-come-first-
served since this app's own draft/roster pivot, with zero waiver
enforcement — every one of Sleeper/ESPN/Yahoo supports at least one
real waiver model. This league's actual, real ESPN settings (the
commissioner's own screenshot) specify:

  Player Acquisition System: Waivers (priority-order, NOT FAAB)
  Waiver Period:             1 Day
  Waiver Order:               Resets each week to inverse order of standings
  Season Acquisition Limit:  No Limit

Three tables implement this:

- waiver_wire: which players are CURRENTLY on waivers right now — one
  row per (season, league_id, sleeper_player_id), written whenever a
  player is dropped (see app/domain/waivers.py's start_waiver_clock,
  called from every drop/displacement path). A player is "on waivers"
  iff a row exists here with clears_at in the future; the daily
  scheduler job (app/scheduler.py's _run_waiver_processing_job)
  resolves whichever rows have clears_at in the past and deletes them
  — so "no row" and "row with a past clears_at that just hasn't been
  swept yet" both correctly read as "processed/free," with the delete
  itself acting as the idempotency marker.

- waiver_claims: the actual bid queue. A team submits a claim
  (add_sleeper_player_id, optional drop_sleeper_player_id) for a
  player currently on waivers; the partial unique index prevents a
  team double-claiming the same player while a claim is still pending.
  status starts 'pending' and resolves to 'successful'/'failed' when
  the scheduler processes that player's expired waiver_wire row, or
  'cancelled' if the team pulls it back first.

- team_waiver_priority: this league's real "resets each week to
  inverse order of standings" rule, materialized per (season,
  league_id, week) the first time that week is touched (worst-record
  team = priority 1, goes first) — see app/queries/league.py's
  get_standings, reversed. A team that WINS a claim gets bumped to the
  back of the current week's list immediately (matching every real
  platform's own priority-waiver behavior), so one team can't sweep
  every contested player in a single week.

Revision ID: 8b295d67654f
Revises: 03100a8a1874
Create Date: 2026-09-08 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op

revision: str = '8b295d67654f'
down_revision: Union[str, Sequence[str], None] = '03100a8a1874'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE waiver_wire (
            season              INTEGER NOT NULL,
            league_id           INTEGER NOT NULL REFERENCES leagues(id),
            sleeper_player_id   TEXT NOT NULL REFERENCES players(sleeper_player_id),
            waived_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
            clears_at           TIMESTAMPTZ NOT NULL,
            PRIMARY KEY (season, league_id, sleeper_player_id)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE waiver_claims (
            id                      SERIAL PRIMARY KEY,
            season                  INTEGER NOT NULL,
            league_id               INTEGER NOT NULL REFERENCES leagues(id),
            team_id                 INTEGER NOT NULL REFERENCES teams_by_season(id),
            add_sleeper_player_id   TEXT NOT NULL REFERENCES players(sleeper_player_id),
            drop_sleeper_player_id  TEXT REFERENCES players(sleeper_player_id),
            status                  TEXT NOT NULL DEFAULT 'pending'
                                        CHECK (status IN ('pending', 'successful', 'failed', 'cancelled')),
            failure_reason          TEXT,
            created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
            processed_at            TIMESTAMPTZ
        )
        """
    )
    # One live claim per team per player at a time — resubmitting means
    # cancel-then-reclaim, not a second row racing the first.
    op.execute(
        """
        CREATE UNIQUE INDEX waiver_claims_one_pending_per_team_player
        ON waiver_claims (season, league_id, team_id, add_sleeper_player_id)
        WHERE status = 'pending'
        """
    )
    op.execute(
        "CREATE INDEX waiver_claims_by_target_player ON waiver_claims (season, league_id, add_sleeper_player_id, status)"
    )
    op.execute(
        "CREATE INDEX waiver_claims_by_team ON waiver_claims (season, league_id, team_id, status)"
    )
    op.execute(
        """
        CREATE TABLE team_waiver_priority (
            season      INTEGER NOT NULL,
            league_id   INTEGER NOT NULL REFERENCES leagues(id),
            week        INTEGER NOT NULL,
            team_id     INTEGER NOT NULL REFERENCES teams_by_season(id),
            priority    INTEGER NOT NULL,
            PRIMARY KEY (season, league_id, week, team_id)
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE team_waiver_priority")
    op.execute("DROP TABLE waiver_claims")
    op.execute("DROP TABLE waiver_wire")
