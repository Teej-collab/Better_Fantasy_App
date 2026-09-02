// One-line definitions for every award/record category the Awards
// All-Time page shows (RecordBook.tsx, AwardLeaderboards.tsx) — keyed
// by the exact `category.key` each API response already sends
// (app/domain/awards_all_time.py, app/domain/records.py). Neither
// backend response has ever carried a description string; these were
// authored from the actual criteria in app/domain/season_awards.py so
// a card tells you why someone won it, not just its name.
export const AWARD_DESCRIPTIONS: Record<string, string> = {
  // All-time award leaderboards (awards_all_time.py)
  season_champion: "Finished 1st in the final standings that year.",
  "Clutch Performer": "Most wins where you beat your projection by 15% or more.",
  "Choke Artist": "Most losses where you missed your projection by 15% or more.",
  Overachiever: "Beat your season-long projected total by the widest margin.",
  Underachiever: "Missed your season-long projected total by the widest margin.",
  "Boom Week": "Posted the single highest weekly score of the season.",
  "Bust Week": "Posted the single lowest weekly score of the season.",
  "Snakebit Award": "Scored the most points ever in a game — and still lost it.",
  "Luckiest Win": "Won a game with the fewest points ever needed to do it.",
  Heater: "Longest win streak in a single season.",
  "Cold Streak": "Longest losing streak in a single season.",
  "Bullseye Award": "Most weeks landing within half a point of your projection.",
  "Highway Robbery": "Biggest single-week upset — won despite the lower projection.",

  // All-time record book (records.py)
  highest_week: "The 3 highest-scoring weeks anyone's ever posted.",
  lowest_week: "The 3 lowest-scoring weeks anyone's ever posted.",
  biggest_blowout: "The 3 largest margins of victory in league history.",
  season_total: "The 3 highest full-season point totals ever.",
};
