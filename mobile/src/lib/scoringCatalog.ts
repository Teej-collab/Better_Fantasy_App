// The scoring editor's shapes (GET /league/scoring-catalog, POST
// /league/scoring-preview) — same as the web's leaguesApi.ts types.

export type CatalogStat = {
  key: string;
  group: string;
  label: string;
  hint: string;
  tracked: boolean;
  idp: boolean;
  value: number | null;
};

export type ScoringCatalog = {
  season: number;
  groups: { key: string; label: string }[];
  stats: CatalogStat[];
  idp: boolean;
};

export type PreviewPlayer = {
  sleeper_player_id: string;
  name: string;
  position: string;
  pro_team: string | null;
  stats: Record<string, number>;
  before: number;
  after: number;
};
