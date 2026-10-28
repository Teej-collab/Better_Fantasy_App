"use client";

import { Anton } from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { useEffect, useState, type ReactNode } from "react";
import { setDraftSchedule } from "@/lib/draftApi";
import {
  DRAFT_TYPES,
  formatSummary,
  isAvailable,
  LEAGUE_TYPES,
  MATCHUP_TYPES,
  ROSTER_PRESETS,
  TYPE_NOTE,
  TYPE_SETTINGS,
  type DraftType,
  type FormatOptions,
  type LeagueType,
  type MatchupType,
  type RosterPreset,
} from "@/lib/leagueFormat";
import {
  claimOwner,
  connectEspn,
  connectSleeper,
  createLeague,
  createTeam,
  getLeagueFormats,
  getMyLeagues,
  requestCustomLeague,
  chooseMyTeam,
  getLeagueClaims,
  notMyTeam,
  getUnclaimedOwners,
  getSleeperLeagues,
  importPreview,
  requestJoin,
  joinLeague,
  previewLeague,
  selectLeague,
  syncEspnNow,
  type ImportPreview,
  type League,
  type SleeperLeagueOption,
  type LeaguePreview,
  type ScoringPreset,
  type UnclaimedOwner,
} from "@/lib/leaguesApi";
import { seasonalEmblem } from "@/lib/seasonal";
import { IOS_APP_URL } from "@/lib/appLinks";
import styles from "./StartFlow.module.css";

const anton = Anton({ weight: "400", subsets: ["latin"] });

// The front door for joining or creating a league — the approved "Join &
// Create League Flow" mockups. One decision per screen:
// - home: two doors (Join / Create) for someone with no league yet, or
//   "Welcome back" with their leagues for someone who has one;
// - join: paste a link or code (or scan the QR with the phone's camera),
//   see the league before joining, then claim your past team's history
//   or start a new team;
// - create: name + start fresh / from ESPN, the kind of league (redraft,
//   keeper, dynasty, best ball, guillotine — 2026-10), the basics (teams,
//   scoring, roster, matchups, draft, and the type's own settings), your
//   team — then an invite screen with the QR.
// Everything here is an existing endpoint (backend app/routers/
// leagues.py); /leagues stays as the full management page.

type View =
  | "home"
  | "join"
  | "joinTeam"
  | "create1"
  | "createType"
  | "createCustom"
  | "create2"
  | "create3"
  | "invite"
  | "connectLink"
  | "connectFound"
  | "connectClaim"
  | "connectInvite";

const PLATFORM_NAME = { espn: "ESPN", sleeper: "Sleeper" } as const;

const TEAM_COUNTS = [8, 10, 12, 14];
const SCORING: { key: ScoringPreset; label: string }[] = [
  { key: "ppr", label: "PPR" },
  { key: "half", label: "Half PPR" },
  { key: "standard", label: "Standard" },
];

export function StartFlow({
  displayName,
  initialFlow,
  initialCode,
}: {
  displayName: string | null;
  initialFlow: "join" | "create" | null;
  initialCode: string | null;
}) {
  const router = useRouter();
  const [view, setView] = useState<View>(initialCode || initialFlow === "join" ? "join" : initialFlow === "create" ? "create1" : "home");
  const [leagues, setLeagues] = useState<League[] | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [joinAsked, setJoinAsked] = useState(false);

  // Join
  const [code, setCode] = useState(initialCode ?? "");
  const [preview, setPreview] = useState<LeaguePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [joined, setJoined] = useState<League | null>(null);
  const [unclaimed, setUnclaimed] = useState<UnclaimedOwner[]>([]);
  const [claimId, setClaimId] = useState<number | null>(null);
  const [newTeamName, setNewTeamName] = useState("");

  // Create
  const [leagueName, setLeagueName] = useState("");
  // Where the league plays now (2026-10-24): ESPN or Sleeper go through
  // the bring-it-in steps (connect*); a fresh league carries on as before.
  const [source, setSource] = useState<"fresh" | "espn" | "sleeper">("fresh");
  const [link, setLink] = useState("");
  const [showPrivate, setShowPrivate] = useState(false);
  const [espnS2, setEspnS2] = useState("");
  const [espnSwid, setEspnSwid] = useState("");
  const [found, setFound] = useState<ImportPreview | null>(null);
  const [mine, setMine] = useState<number | null>(null);
  const [unclaimedLeft, setUnclaimedLeft] = useState<number | null>(null);
  // Your team when your account already had it, and who else in the
  // league is already on The Weekend (2026-10-28).
  const [yours, setYours] = useState<{ owner_id: number; team_name: string } | null>(null);
  const [alreadyHere, setAlreadyHere] = useState<{ display_name: string; team_name: string; member: boolean }[]>([]);
  // One login runs several teams in the league: you pick yours first.
  const [sharedLogin, setSharedLogin] = useState<{ team_id: number; team_name: string }[]>([]);
  const [sharedPick, setSharedPick] = useState<number | null>(null);
  const [reported, setReported] = useState(false);
  // Joining put you straight onto a team matched to your ESPN/Sleeper
  // account: the pop-up says so (2026-10-28).
  const [matched, setMatched] = useState<{ teamName: string; platform: string | null } | null>(null);
  // Sleeper by username (2026-10-24): no link to copy.
  const [sleeperName, setSleeperName] = useState("");
  const [sleeperOptions, setSleeperOptions] = useState<SleeperLeagueOption[] | null>(null);
  const [teamCount, setTeamCount] = useState(12);
  const [scoring, setScoring] = useState<ScoringPreset>("ppr");
  const [draftAt, setDraftAt] = useState("");
  const [leagueType, setLeagueType] = useState<LeagueType>("redraft");
  const [rosterPreset, setRosterPreset] = useState<RosterPreset>("standard");
  const [matchupType, setMatchupType] = useState<MatchupType>("h2h");
  const [draftType, setDraftType] = useState<DraftType>("snake");
  const [typeSettings, setTypeSettings] = useState<Record<string, number>>({});
  const [formats, setFormats] = useState<FormatOptions | null>(null);
  const [customText, setCustomText] = useState("");
  const [customSent, setCustomSent] = useState(false);
  const [teamName, setTeamName] = useState("");
  const newTeamField = useRequired("start-new-team-name", newTeamName, "Give your team a name first.");
  const leagueField = useRequired("start-league-name", leagueName, "Give your league a name first.");
  const teamField = useRequired("start-team-name", teamName, "Give your team a name first.");
  const linkField = useRequired("start-league-link", link, "Paste your league link first.");
  const sleeperField = useRequired("start-sleeper-name", sleeperName, "Type your Sleeper username first.");
  const [created, setCreated] = useState<League | null>(null);

  useEffect(() => {
    getLeagueFormats()
      .then(setFormats)
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    getMyLeagues()
      .then((r) => {
        if (cancelled) return;
        setLeagues(r.leagues);
        setActiveId(r.activeLeagueId);
      })
      .catch(() => !cancelled && setLeagues([]));
    return () => {
      cancelled = true;
    };
  }, []);

  // Look the league up as soon as something code-shaped is typed or pasted.
  useEffect(() => {
    const text = code.trim();
    if (text.length < 4) return;
    let cancelled = false;
    const id = setTimeout(() => {
      previewLeague(text)
        .then((p) => {
          if (cancelled) return;
          setPreview(p);
          setPreviewError(null);
        })
        .catch(() => {
          if (cancelled) return;
          setPreview(null);
          setPreviewError("No league found for that code — check it with your commissioner.");
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [code]);

  async function run(action: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong — try again.");
    } finally {
      setBusy(false);
    }
  }

  function go(next: View) {
    setError(null);
    setView(next);
  }

  const joinLeagueNow = () =>
    run(async () => {
      if (!preview) return;
      const league = preview.already_member ? null : await joinLeague(preview.invite_code, true);
      if (preview.already_member) await selectLeague(preview.id);
      setJoined(league ?? ({ id: preview.id, name: preview.name, invite_code: preview.invite_code, created_at: "", role: "member" } as League));
      const claims = await getLeagueClaims(preview.id).catch(() => null);
      // Already have a team here (connected from ESPN, and you were
      // already on The Weekend): it's yours, nothing to pick.
      if (claims?.yours) {
        setMatched({ teamName: claims.yours.team_name, platform: claims.platform ?? null });
        setReported(false);
        return;
      }
      if (claims?.shared_login?.length) {
        setSharedLogin(claims.shared_login);
        setSharedPick(null);
        go("joinTeam");
        return;
      }
      const owners = claims?.owners ?? [];
      setUnclaimed(owners);
      setClaimId(owners[0]?.owner_id ?? null);
      setNewTeamName("");
      go("joinTeam");
    });

  const finishJoin = (mode: "claim" | "new") =>
    run(async () => {
      if (!joined) return;
      if (mode === "claim" && claimId !== null) {
        const picked = unclaimed.find((o) => o.owner_id === claimId);
        if (!confirmClaim(picked?.team_name ?? picked?.display_name ?? "this team")) return;
        await claimOwner(joined.id, claimId);
      }
      if (mode === "new") await createTeam(joined.id, newTeamName.trim());
      router.push("/");
      router.refresh();
    });

  const platform = source === "sleeper" ? "sleeper" : "espn";

  const lookUpSleeper = () =>
    run(async () => {
      const r = await getSleeperLeagues(sleeperName.trim());
      setSleeperOptions(r.leagues);
      if (r.leagues.length === 0) throw new Error(`No ${r.season} leagues on that account yet.`);
    });

  const findLeague = (picked?: string) =>
    run(async () => {
      const target = (picked ?? link).trim();
      try {
        setFound(await importPreview(platform, target, showPrivate ? espnS2.trim() : undefined, showPrivate ? espnSwid.trim() : undefined));
        go("connectFound");
      } catch (e) {
        if (e instanceof Error && e.message.includes("is private")) setShowPrivate(true);
        throw e;
      }
    });

  const bringIn = () =>
    run(async () => {
      if (!found) return;
      // A retry after a failed connect reuses the league already made.
      const league = created ?? (await createLeague(found.name, { teamCount: found.team_count, makeActive: true }));
      setCreated(league);
      if (platform === "espn") {
        await connectEspn(link.trim(), showPrivate ? espnS2.trim() : undefined, showPrivate ? espnSwid.trim() : undefined);
        await syncEspnNow().catch(() => {});
      } else {
        await connectSleeper(link.trim());
      }
      const claims = await getLeagueClaims(league.id).catch(() => null);
      setUnclaimed(claims?.owners ?? []);
      setYours(claims?.yours ?? null);
      setAlreadyHere(claims?.already_here ?? []);
      setSharedLogin(claims?.shared_login ?? []);
      setSharedPick(null);
      setMine(null);
      go("connectClaim");
    });

  const claimMine = () =>
    run(async () => {
      if (!created || mine === null) return;
      const picked = unclaimed.find((o) => o.owner_id === mine);
      if (!confirmClaim(picked?.team_name ?? picked?.display_name ?? "this team")) return;
      await claimOwner(created.id, mine);
      const left = await getUnclaimedOwners(created.id).catch(() => []);
      setUnclaimedLeft(left.length);
      go("connectInvite");
    });

  const createNow = () =>
    run(async () => {
      const league = await createLeague(leagueName.trim(), {
        teamCount,
        scoring,
        makeActive: true,
        format: {
          league_type: leagueType,
          roster_preset: rosterPreset,
          // A guillotine always ranks on points; it has no matchups to pick.
          matchup_type: leagueType === "guillotine" ? "points" : matchupType,
          draft_type: draftType,
          type_settings: settingValues(),
        },
      });
      await createTeam(league.id, teamName.trim());
      if (draftAt) await setDraftSchedule(draftAt).catch(() => {});
      setCreated(league);
      go("invite");
    });

  // This type's settings, defaulted from GET /leagues/formats' limits.
  const limitsFor = (key: string) => formats?.type_settings[leagueType]?.[key] ?? DEFAULT_LIMITS[key];
  const settingValues = () =>
    Object.fromEntries(TYPE_SETTINGS[leagueType].map((t) => [t.key, typeSettings[t.key] ?? limitsFor(t.key)?.default ?? 0]));

  const emblem = seasonalEmblem();
  let content: ReactNode = null;

  if (view === "home") {
    const returning = (leagues?.length ?? 0) > 0;
    content = returning ? (
      <>
        <div className="flex items-center gap-3">
          <Image src={emblem} alt="" width={56} height={56} className="h-14 w-14" />
          <div className="flex flex-col">
            <span className={styles.kicker}>Welcome back</span>
            <span className={`${anton.className} text-3xl tracking-wide text-[color:var(--wl-accent)] [text-shadow:0_0_12px_rgba(57,255,20,0.55)]`}>
              {displayName ?? "Commish"}
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-2.5">
          <span className={styles.kicker}>Your leagues</span>
          {leagues!.map((l) => (
            <button
              key={l.id}
              type="button"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  if (l.id !== activeId) await selectLeague(l.id);
                  router.push("/");
                  router.refresh();
                })
              }
              className={styles.card}
              style={{ textAlign: "left", cursor: "pointer", borderColor: l.id === activeId ? "color-mix(in srgb, var(--wl-accent) 45%, transparent)" : undefined }}
            >
              <div className="flex items-center justify-between gap-3">
                <span className={`${anton.className} text-xl tracking-wide uppercase`}>{l.name}</span>
                {l.id === activeId && (
                  <span className="rounded-full bg-[color:color-mix(in_srgb,var(--wl-accent)_14%,transparent)] px-2 py-0.5 text-[11px] font-bold tracking-wider text-[color:var(--wl-accent)] uppercase">
                    Active
                  </span>
                )}
              </div>
              <span className="text-sm text-[#aab2bf]">{cardLine(l)}</span>
              {statusChip(l) && (
                <span className="self-start rounded-full bg-amber-400/15 px-2 py-0.5 text-[11px] font-bold tracking-wider text-amber-400 uppercase">
                  {statusChip(l)}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="mt-auto grid grid-cols-2 gap-2.5">
          <button type="button" className={styles.ghost} onClick={() => go("join")}>
            Join another
          </button>
          <button type="button" className={styles.ghost} onClick={() => go("create1")}>
            Create new
          </button>
        </div>
      </>
    ) : (
      <>
        <div className="flex flex-col items-center gap-3 pt-4 text-center">
          <Image src={emblem} alt="The Weekend" width={120} height={120} className="h-[120px] w-[120px]" />
          <span className={styles.kicker}>Welcome to The Weekend</span>
          <h1 className={`${anton.className} ${styles.title}`}>Let&apos;s get you into a league</h1>
          <p className={styles.sub}>Every league here keeps its history, chat, chugs and trash talk in one place.</p>
        </div>
        <div className="flex flex-col gap-3.5">
          <Door
            onClick={() => go("join")}
            accent="#39ff14"
            icon={<UsersIcon />}
            title="Join a league"
            text="Got an invite link, code or QR from your commissioner?"
          />
          <Door onClick={() => go("create1")} accent="#2fd0ff" icon={<PlusIcon />} title="Create a league" text="Start your own and run it as commissioner." />
        </div>
        <button
          type="button"
          onClick={() => {
            setSource("espn");
            go("create1");
          }}
          className="mt-auto flex items-center gap-3 rounded-xl border border-dashed border-[#2a303a] p-4 text-left text-sm leading-snug text-[#aab2bf]"
        >
          <span className="text-amber-400">
            <DownloadIcon />
          </span>
          <span>
            <strong className="text-[color:var(--wl-text)]">Already playing on ESPN or Sleeper?</strong> Bring your league in and keep playing there.
          </span>
        </button>
      </>
    );
  }

  if (view === "join") {
    content = (
      <>
        <Top onBack={() => go("home")} />
        <div className="flex flex-col gap-2">
          <span className={styles.kicker}>Join a league</span>
          <h1 className={`${anton.className} ${styles.title}`}>How&apos;d you get invited?</h1>
          <p className={styles.sub}>Paste the link or code your commissioner sent. Got a QR? Scan it with your phone&apos;s camera.</p>
        </div>
        <label className={styles.label}>
          Invite link or code
          <input
            className={styles.field}
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              if (e.target.value.trim().length < 4) {
                setPreview(null);
                setPreviewError(null);
              }
            }}
            placeholder="e.g. K7M2QX"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        {previewError && <p className={styles.error}>{previewError}</p>}
        {preview && (
          <div className={styles.card} style={{ borderColor: "color-mix(in srgb, var(--wl-accent) 45%, transparent)" }}>
            <span className="flex items-center gap-2 text-xs font-bold tracking-wider text-[color:var(--wl-accent)] uppercase">
              <CheckIcon /> {preview.already_member ? "You're already in this league" : "League found"}
            </span>
            <div className="flex flex-col gap-1">
              <span className={`${anton.className} text-2xl tracking-wide uppercase`}>{preview.name}</span>
              <span className="text-sm text-[#aab2bf]">
                {preview.season} season{preview.commissioner ? ` · Commissioner ${preview.commissioner}` : ""}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Stat value={preview.team_count ? `${preview.teams}/${preview.team_count}` : String(preview.teams)} label="Teams" />
              <Stat value={preview.scoring} label="Scoring" />
              <Stat value={preview.history_seasons > 1 ? `${preview.history_seasons} yrs` : "New"} label="History" />
            </div>
          </div>
        )}
        {error && <p className={styles.error}>{error}</p>}
        <button type="button" className={`${styles.neon} mt-auto`} disabled={!preview || busy} onClick={joinLeagueNow}>
          {preview ? (preview.already_member ? `Go to ${preview.name}` : `Join ${preview.name}`) : "Join league"}
        </button>
        {/* The app is the best way in (2026-10-28): the iPhone download. */}
        <a href={IOS_APP_URL} className={`${styles.ghost} text-center`} target="_blank" rel="noopener">
          Get the iPhone app
        </a>
      </>
    );
  }

  const keepSharedTeam = (leagueId: number, after: (teamName: string) => void) =>
    run(async () => {
      const team = sharedLogin.find((t) => t.team_id === sharedPick);
      if (!team) return;
      await chooseMyTeam(leagueId, team.team_id);
      setSharedLogin([]);
      after(team.team_name);
    });

  const sharedPicker = (leagueId: number, platformName: string, after: (teamName: string) => void) => (
    <>
      <p className={styles.sub}>
        Your {platformName} account runs {sharedLogin.length} teams in this league. Which one is yours? The others stay open for
        whoever really manages them.
      </p>
      <div className="flex flex-col gap-2">
        {sharedLogin.map((t) => (
          <Option
            key={t.team_id}
            on={sharedPick === t.team_id}
            onClick={() => setSharedPick(t.team_id)}
            icon={<UsersIcon />}
            color="var(--wl-accent)"
            title={t.team_name}
            text="Run by your account"
          />
        ))}
      </div>
      {error && <p className={styles.error}>{error}</p>}
      <button
        type="button"
        className={`${styles.neon} mt-auto`}
        disabled={sharedPick === null || busy}
        onClick={() => keepSharedTeam(leagueId, after)}
      >
        This one&apos;s mine
      </button>
    </>
  );

  if (matched && preview) {
    const account = matched.platform === "sleeper" ? "Sleeper account" : matched.platform === "espn" ? "ESPN account" : "fantasy account";
    content = (
      <>
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="matched-title">
          <div className={`${styles.card} w-full max-w-md gap-3 border border-[color:var(--wl-accent)] p-5`}>
            <span className={styles.kicker}>{reported ? "Got it" : "Matched to your team"}</span>
            <h2 id="matched-title" className={`${anton.className} text-3xl uppercase`}>
              {reported ? "Thanks for telling us" : `You're ${matched.teamName}`}
            </h2>
            <p className="text-sm leading-snug text-[#aab2bf]">
              {reported
                ? `We'll sort out ${matched.teamName} in ${preview.name} and fix it by hand. You can head in now.`
                : `We matched your ${account} to this team in ${preview.name}, so you're all set.`}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {!reported && (
                <button
                  type="button"
                  className={`${styles.ghost} flex-1 rounded-full`}
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await notMyTeam(preview.id);
                      setReported(true);
                    })
                  }
                >
                  Not my team
                </button>
              )}
              <button
                type="button"
                className={`${styles.neon} flex-1 rounded-full`}
                // A full load of Home plays the Welcome to The Weekend intro;
                // router.push would skip it.
                // eslint-disable-next-line @next/next/no-location-assign-relative-destination
                onClick={() => window.location.assign("/")}
              >
                Send it
              </button>
            </div>
            {error && <p className={styles.error}>{error}</p>}
          </div>
        </div>
      </>
    );
  } else if (view === "joinTeam" && joined && sharedLogin.length > 0) {
    content = (
      <>
        <Top onBack={() => go("join")} />
        <div className="flex flex-col gap-2">
          <span className={styles.kicker}>{joined.name}</span>
          <h1 className={`${anton.className} ${styles.title}`}>Which team is yours?</h1>
        </div>
        {sharedPicker(joined.id, "ESPN or Sleeper", () => {
          router.push("/");
          router.refresh();
        })}
      </>
    );
  } else if (view === "joinTeam" && joined) {
    content = (
      <>
        <Top onBack={() => go("join")} />
        <div className="flex flex-col gap-2">
          <span className={styles.kicker}>{joined.name}</span>
          <h1 className={`${anton.className} ${styles.title}`}>Who are you here?</h1>
          <p className={styles.sub}>Played here before? Claim your team and your whole history comes with it.</p>
        </div>
        {unclaimed.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className={styles.kicker}>Claim your history</span>
            {unclaimed.map((o) => (
              <button
                key={o.owner_id}
                type="button"
                onClick={() => setClaimId(o.owner_id)}
                aria-pressed={claimId === o.owner_id}
                className={`${styles.option} ${claimId === o.owner_id ? styles.optionOn : ""}`}
                style={{ alignItems: "center" }}
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#191d23] text-sm font-bold text-[#aab2bf]">
                  {initials(o.display_name)}
                </span>
                <span className="flex flex-grow flex-col">
                  <span className="font-semibold">{o.team_name ?? o.display_name}</span>
                  {o.team_name && <span className="text-xs text-[#aab2bf]">{o.display_name}</span>}
                </span>
                {claimId === o.owner_id && (
                  <span className="text-[color:var(--wl-accent)]">
                    <CheckIcon />
                  </span>
                )}
              </button>
            ))}
            <button type="button" className={styles.neon} disabled={claimId === null || busy} onClick={() => finishJoin("claim")}>
              That&apos;s me — claim it
            </button>
            <div className={styles.divider}>new to this league?</div>
          </div>
        )}
        <label className={styles.label}>
          Your team name
          <input {...newTeamField.field} className={styles.field} value={newTeamName} onChange={(e) => setNewTeamName(e.target.value)} maxLength={40} placeholder="Name your team" />
        </label>
        {newTeamField.message}
        {error && <p className={styles.error}>{error}</p>}
        <button
          type="button"
          className={`${unclaimed.length > 0 ? styles.ghost : `${styles.neon} mt-auto`} ${newTeamField.empty ? styles.incomplete : ""}`}
          disabled={busy}
          onClick={() => newTeamField.check() && finishJoin("new")}
        >
          Start a new team
        </button>
      </>
    );
  }

  if (view === "create1") {
    content = (
      <>
        <Top onBack={() => go("home")} />
        <div className="flex flex-col gap-2">
          <span className={styles.kicker}>Set up your league</span>
          <h1 className={`${anton.className} ${styles.title}`}>Where does your league play right now?</h1>
          <p className={styles.sub}>Keep playing there. We&apos;ll pull in your teams and scores and add everything else on top.</p>
        </div>
        <div className="flex flex-col gap-2.5">
          <Option on={source === "espn"} onClick={() => setSource("espn")} icon={<DownloadIcon />} color="#f87171" title="ESPN" text="Paste your league link. About 30 seconds." />
          <Option on={source === "sleeper"} onClick={() => setSource("sleeper")} icon={<DownloadIcon />} color="#38bdf8" title="Sleeper" text="Paste your league link. No sign-in." />
          <Option on={false} onClick={() => {}} disabled icon={<DownloadIcon />} color="#a78bfa" title="Yahoo" text="Coming soon." />
          <Option on={source === "fresh"} onClick={() => setSource("fresh")} icon={<PlusIcon />} color="var(--wl-accent)" title="Starting a new league" text="Draft here with good defaults. Tweak anything later." />
        </div>
        {source === "fresh" && (
          <label className={styles.label}>
            League name
            <input {...leagueField.field} className={`${styles.field} text-lg font-semibold`} value={leagueName} onChange={(e) => setLeagueName(e.target.value)} maxLength={40} placeholder="Sunday Scaries" />
          </label>
        )}
        {source === "fresh" && leagueField.message}
        <button
          type="button"
          className={`${styles.neon} mt-auto ${source === "fresh" && leagueField.empty ? styles.incomplete : ""}`}
          onClick={() => {
            if (source !== "fresh") go("connectLink");
            else if (leagueField.check()) go("createType");
          }}
        >
          Continue
        </button>
      </>
    );
  }

  if (view === "createType") {
    content = (
      <>
        <Top onBack={() => go("create1")} step={2} />
        <div className="flex flex-col gap-2">
          <span className={styles.kicker}>Create a league · 2 of 4</span>
          <h1 className={`${anton.className} ${styles.title}`}>What kind of league?</h1>
        </div>
        <div className="flex flex-col gap-2.5" role="radiogroup" aria-label="League type">
          {LEAGUE_TYPES.map((t) => {
            const available = isAvailable(formats, "league_type", t.key);
            const on = leagueType === t.key;
            return (
              <button
                key={t.key}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={!available}
                onClick={() => {
                  setLeagueType(t.key);
                  setTypeSettings({});
                }}
                className={`${styles.option} ${on ? styles.optionOn : ""} ${available ? "" : "opacity-55"}`}
                style={{ alignItems: "center" }}
              >
                <span className={styles.typeIcon}>
                  <LeagueTypeIcon type={t.key} />
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className={`${anton.className} text-lg tracking-wide uppercase`}>{t.name}</span>
                    {available && t.badge && <span className={`${styles.pill} ${styles.pillPop}`}>{t.badge}</span>}
                    {!available && <span className={styles.pill}>Coming soon</span>}
                  </span>
                  <span className="text-sm leading-snug text-[#aab2bf]">{t.text}</span>
                </span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => go("createCustom")}
          className="flex items-center gap-3 rounded-xl border border-dashed border-[#2a303a] p-4 text-left text-sm leading-snug text-[#aab2bf]"
        >
          <span className={styles.typeIcon}>
            <PlusIcon />
          </span>
          <span>
            <strong className="text-[color:var(--wl-text)]">Something custom?</strong> Tell us the league you want and we&apos;ll help
            set it up.
          </span>
        </button>
        <p className="text-sm text-[color:var(--wl-text-secondary)]">You can&apos;t switch types once the draft starts.</p>
        <button type="button" className={`${styles.neon} mt-auto`} onClick={() => go("create2")}>
          Continue
        </button>
      </>
    );
  }

  if (view === "createCustom") {
    content = (
      <>
        <Top onBack={() => go("createType")} step={2} />
        <div className="flex flex-col gap-2">
          <span className={styles.kicker}>Create a league · Custom</span>
          <h1 className={`${anton.className} ${styles.title}`}>Describe your league</h1>
          <p className={styles.sub}>
            Scoring quirks, a format we don&apos;t list, house rules — tell us and we&apos;ll get back to you to set it up.
          </p>
        </div>
        {customSent ? (
          <div className={styles.card} style={{ borderColor: "color-mix(in srgb, var(--wl-accent) 45%, transparent)" }}>
            <span className="flex items-center gap-2 text-xs font-bold tracking-wider text-[color:var(--wl-accent)] uppercase">
              <CheckIcon /> Sent
            </span>
            <span className="text-sm text-[#aab2bf]">We got it and will reach out. You can still create a league now and change it later.</span>
          </div>
        ) : (
          <label className={styles.label}>
            Your league
            <textarea
              className={`${styles.field} min-h-40 py-3`}
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
              maxLength={2000}
              placeholder="e.g. 14 teams, 2 divisions, 3-QB lineups, a bonus for every 50-yard field goal…"
            />
          </label>
        )}
        {error && <p className={styles.error}>{error}</p>}
        {customSent ? (
          <button type="button" className={`${styles.neon} mt-auto`} onClick={() => go("createType")}>
            Back to league types
          </button>
        ) : (
          <button
            type="button"
            className={`${styles.neon} mt-auto`}
            disabled={!customText.trim() || busy}
            onClick={() =>
              run(async () => {
                await requestCustomLeague(customText.trim());
                setCustomSent(true);
              })
            }
          >
            {busy ? "Sending…" : "Send request"}
          </button>
        )}
      </>
    );
  }

  if (view === "create2") {
    content = (
      <>
        <Top onBack={() => go("createType")} step={3} />
        <div className="flex flex-col gap-2">
          <span className={styles.kicker}>Create a league · 3 of 4</span>
          <h1 className={`${anton.className} ${styles.title}`}>Set the basics</h1>
        </div>
        <Group label="How many teams?">
          <div className={styles.segs} style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
            {TEAM_COUNTS.map((n) => (
              <button key={n} type="button" aria-pressed={teamCount === n} className={`${styles.seg} ${teamCount === n ? styles.segOn : ""}`} onClick={() => setTeamCount(n)}>
                {n}
              </button>
            ))}
          </div>
        </Group>
        <Group label="Scoring">
          <div className={styles.segs} style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
            {SCORING.map((s) => (
              <button key={s.key} type="button" aria-pressed={scoring === s.key} className={`${styles.seg} ${scoring === s.key ? styles.segOn : ""}`} onClick={() => setScoring(s.key)}>
                {s.label}
              </button>
            ))}
          </div>
        </Group>
        <Group label="Roster">
          <Segs
            columns={4}
            options={ROSTER_PRESETS.map((r) => ({ ...r, available: isAvailable(formats, "roster_preset", r.key) }))}
            value={rosterPreset}
            onChange={setRosterPreset}
          />
        </Group>
        {leagueType !== "guillotine" && (
          <Group label="Matchups">
            <Segs
              columns={2}
              options={MATCHUP_TYPES.map((m) => ({ ...m, available: isAvailable(formats, "matchup_type", m.key) }))}
              value={matchupType}
              onChange={setMatchupType}
            />
          </Group>
        )}
        <Group label="Draft">
          <Segs
            columns={2}
            options={DRAFT_TYPES.map((d) => ({ ...d, available: isAvailable(formats, "draft_type", d.key) }))}
            value={draftType}
            onChange={setDraftType}
          />
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <input type="datetime-local" className={styles.field} value={draftAt} onChange={(e) => setDraftAt(e.target.value)} aria-label="Draft date and time" />
            <button type="button" className={`${styles.seg} px-3.5 ${draftAt ? "" : styles.segOn}`} aria-pressed={!draftAt} onClick={() => setDraftAt("")}>
              Decide later
            </button>
          </div>
        </Group>
        {(TYPE_SETTINGS[leagueType].length > 0 || TYPE_NOTE[leagueType]) && (
          <div className={styles.card}>
            {TYPE_NOTE[leagueType] && <span className="text-sm text-[#aab2bf]">{TYPE_NOTE[leagueType]}</span>}
            {TYPE_SETTINGS[leagueType].map((t) => {
              const limits = limitsFor(t.key);
              const value = typeSettings[t.key] ?? limits?.default ?? 0;
              const step = t.step ?? 1;
              const set = (v: number) => setTypeSettings((cur) => ({ ...cur, [t.key]: Math.max(limits?.min ?? 0, Math.min(limits?.max ?? 99, v)) }));
              return (
                <div key={t.key} className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-col">
                    <span className="font-semibold">{t.title}</span>
                    <span className="text-sm text-[color:var(--wl-text-secondary)]">{t.text}</span>
                  </div>
                  <div className={styles.stepper}>
                    <button type="button" aria-label={`Fewer: ${t.title}`} onClick={() => set(value - step)} disabled={value <= (limits?.min ?? 0)}>
                      −
                    </button>
                    <span className="min-w-[3.5ch] text-center font-mono font-bold">
                      {t.prefix ?? ""}
                      {value}
                    </span>
                    <button type="button" aria-label={`More: ${t.title}`} onClick={() => set(value + step)} disabled={value >= (limits?.max ?? 99)}>
                      +
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <p className="text-sm leading-relaxed text-[color:var(--wl-text-secondary)]">
          Roster spots, playoffs and every scoring rule are in Commissioner Tools whenever you want them.
        </p>
        <button type="button" className={`${styles.neon} mt-auto`} onClick={() => go("create3")}>
          Continue
        </button>
      </>
    );
  }

  if (view === "create3") {
    content = (
      <>
        <Top onBack={() => go("create2")} step={4} />
        <div className="flex flex-col gap-2">
          <span className={styles.kicker}>Create a league · 4 of 4</span>
          <h1 className={`${anton.className} ${styles.title}`}>Now your team</h1>
          <p className={styles.sub}>This is what everyone sees in standings, matchups and chat. Add a logo any time in Settings.</p>
        </div>
        <label className={styles.label}>
          Team name
          <input {...teamField.field} className={`${styles.field} text-lg font-semibold`} value={teamName} onChange={(e) => setTeamName(e.target.value)} maxLength={40} placeholder="Name your team" />
        </label>
        {teamField.message}
        <div className={styles.card}>
          <span className={styles.kicker}>Your league</span>
          <span className={`${anton.className} text-2xl tracking-wide uppercase`}>{leagueName}</span>
          <span className="text-sm text-[#aab2bf]">
            {teamCount} teams ·{" "}
            {formatSummary({ league_type: leagueType, roster_preset: rosterPreset, matchup_type: matchupType, draft_type: draftType })} ·{" "}
            {SCORING.find((s) => s.key === scoring)?.label} · {draftAt ? `Draft ${formatDraft(draftAt)}` : "Draft date later"}
          </span>
        </div>
        {error && <p className={styles.error}>{error}</p>}
        <button type="button" className={`${styles.neon} mt-auto ${teamField.empty ? styles.incomplete : ""}`} disabled={busy} onClick={() => teamField.check() && createNow()}>
          {busy ? "Creating…" : "Create league"}
        </button>
      </>
    );
  }

  if (view === "invite" && created) {
    content = <InviteScreen league={created} teamCount={teamCount} hasDraftDate={!!draftAt} />;
  }

  if (view === "connectLink") {
    const name = PLATFORM_NAME[platform];
    content = (
      <>
        <Top onBack={() => go("create1")} />
        <div className="flex flex-col gap-2">
          <span className={styles.kicker}>{name}</span>
          <h1 className={`${anton.className} ${styles.title}`}>{platform === "espn" ? "Paste your league link" : "What's your Sleeper username?"}</h1>
          <p className={styles.sub}>
            {platform === "espn"
              ? "In the ESPN Fantasy app, open your league → Invite friends (or Share) → Copy link, and paste it here. A link from fantasy.espn.com or just the league number works too."
              : "We'll find your leagues. No sign-in or link needed."}
          </p>
        </div>
        {platform === "sleeper" && (
          <div className="flex flex-col gap-2.5">
            <label className={styles.label}>
              Sleeper username
              <input {...sleeperField.field} className={styles.field} value={sleeperName} onChange={(e) => setSleeperName(e.target.value)} placeholder="your username" />
            </label>
            {sleeperField.message}
            <button type="button" className={`${styles.ghost} ${sleeperField.empty ? styles.incomplete : ""}`} disabled={busy} onClick={() => sleeperField.check() && lookUpSleeper()}>
              {busy && !sleeperOptions ? "Looking…" : "Find my leagues"}
            </button>
            {sleeperOptions?.map((lg) => (
              <Option
                key={lg.league_id}
                on={false}
                onClick={() => {
                  setLink(lg.league_id);
                  findLeague(lg.league_id);
                }}
                icon={<UsersIcon />}
                color="#38bdf8"
                title={lg.name}
                text={lg.teams ? `${lg.teams} teams` : "Sleeper league"}
              />
            ))}
            <p className="text-sm text-[#aab2bf]">Or paste a league link from sleeper.com instead:</p>
          </div>
        )}
        {platform === "espn" && (
          <div className={styles.card}>
            <span className={styles.kicker}>Easiest, and works for private leagues</span>
            <strong>Connect it in The Weekend app</strong>
            <span className="text-sm leading-snug text-[#aab2bf]">
              On your iPhone, open The Weekend → Set up your league → ESPN → <b>Sign in with ESPN</b>. Sign in on ESPN&apos;s own page and
              tap your team. There&apos;s nothing to change in your ESPN settings, and we never see your password. Your league then shows up
              here on the website too.
            </span>
            {IOS_APP_URL && (
              <a href={IOS_APP_URL} className={styles.ghost} target="_blank" rel="noopener">
                Get the iPhone app
              </a>
            )}
          </div>
        )}
        <label className={styles.label}>
          {name} league link
          <input
            {...linkField.field}
            className={styles.field}
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder={platform === "espn" ? "https://fantasy.espn.com/football/league?leagueId=…" : "https://sleeper.com/leagues/…"}
          />
        </label>
        {linkField.message}
        {platform === "espn" && (
          <div className={styles.card}>
            <span className={styles.kicker}>Or, from here: before you tap Find</span>
            <strong>Turn on &ldquo;Viewable to Public&rdquo;</strong>
            <span className="text-sm leading-snug text-[#aab2bf]">
              On fantasy.espn.com as the league manager (your phone&apos;s browser works; the ESPN app doesn&apos;t have this setting):
              League Manager → Settings → Basic Settings → &ldquo;Make League Viewable to Public.&rdquo; Your league stays private and your
              rules don&apos;t change; this only lets The Weekend read your scores. You can turn it off anytime.
            </span>
          </div>
        )}
        {platform === "espn" &&
          (showPrivate ? (
            <div className="flex flex-col gap-2.5">
              <p className="text-sm leading-snug text-[#aab2bf]">
                The app (above) is the easy way. To do it here instead: sign in at espn.com, open your browser&apos;s developer tools → Application → Cookies → espn.com, and
                copy espn_s2 and SWID (with the curly braces).
              </p>
              <label className={styles.label}>
                espn_s2
                <input className={styles.field} type="password" autoComplete="off" value={espnS2} onChange={(e) => setEspnS2(e.target.value)} />
              </label>
              <label className={styles.label}>
                SWID
                <input className={styles.field} autoComplete="off" value={espnSwid} onChange={(e) => setEspnSwid(e.target.value)} />
              </label>
            </div>
          ) : (
            <button type="button" className={styles.ghost} onClick={() => setShowPrivate(true)}>
              Private league? Paste ESPN&apos;s login cookies instead
            </button>
          ))}
        {error && <p className={styles.error}>{error}</p>}
        <button type="button" className={`${styles.neon} mt-auto ${linkField.empty ? styles.incomplete : ""}`} disabled={busy} onClick={() => linkField.check() && findLeague()}>
          {busy ? "Looking…" : "Find my league"}
        </button>
      </>
    );
  }

  // Already on The Weekend (2026-10-28): one copy per ESPN or Sleeper
  // league, so a second person joins that one instead of splitting it.
  if (view === "connectFound" && found?.existing) {
    const existing = found.existing;
    content = (
      <>
        <Top onBack={() => go("connectLink")} />
        <div className="flex flex-col gap-2">
          <span className={styles.kicker}>Already on The Weekend</span>
          <h1 className={`${anton.className} ${styles.title}`}>
            {existing.you_are_in_it ? `You're already in ${existing.name}` : `${existing.name} is already here`}
          </h1>
          <p className={styles.sub}>
            {existing.you_are_in_it
              ? "No need to bring it in again. Open it from your leagues."
              : `${existing.commissioner} brought it in already. Join theirs so everyone's in one league, with one chat and one set of standings.`}
          </p>
        </div>
        {joinAsked && !existing.you_are_in_it && (
          <div className={styles.card}>
            <span className="text-sm text-[#aab2bf]">
              Sent. {existing.commissioner} got a notification to send you the invite. You can also ask them in your group text.
            </span>
          </div>
        )}
        {error && <p className={styles.error}>{error}</p>}
        {existing.you_are_in_it ? (
          <Link href="/leagues" className={`${styles.neon} mt-auto text-center`}>
            Open my leagues
          </Link>
        ) : (
          <div className="mt-auto flex flex-col gap-2">
            <button
              type="button"
              className={styles.neon}
              disabled={busy || joinAsked}
              onClick={() =>
                run(async () => {
                  await requestJoin(found.platform, found.external_id);
                  setJoinAsked(true);
                })
              }
            >
              {joinAsked ? "Asked ✓" : `Ask ${existing.commissioner} to let me in`}
            </button>
            <button type="button" className={styles.ghost} onClick={() => go("join")}>
              I have an invite code
            </button>
          </div>
        )}
      </>
    );
  } else if (view === "connectFound" && found) {
    content = (
      <>
        <Top onBack={() => go("connectLink")} />
        <div className={styles.card}>
          <span className="flex items-center gap-2 font-bold text-[color:var(--wl-accent)]">
            <CheckIcon /> Found {found.name}
          </span>
          <span className="text-sm text-[#aab2bf]">
            {found.season} season · {found.team_count} teams · Week {found.current_week}
          </span>
          <div className="grid grid-cols-2 gap-2">
            {found.teams.slice(0, 6).map((t, i) => (
              <div key={`${t.team_name}-${i}`} className="flex min-w-0 flex-col rounded-lg bg-white/[0.04] p-2">
                <span className="truncate text-sm font-bold">{t.team_name}</span>
                {t.owner_name && <span className="truncate text-xs text-[#aab2bf]">{t.owner_name}</span>}
              </div>
            ))}
          </div>
          {found.teams.length > 6 && <span className="text-sm text-[#aab2bf]">+ {found.teams.length - 6} more teams</span>}
        </div>
        <ul className="flex flex-col gap-1.5 text-sm">
          <li>✓ Every week&apos;s matchups and scores so far</li>
          <li>✓ Live scoring during games</li>
          <li>✓ Write-ups, recaps, trade tools and chat on top</li>
          <li>✓ Your league keeps running on {PLATFORM_NAME[platform]}, nothing changes there</li>
        </ul>
        {error && <p className={styles.error}>{error}</p>}
        <div className="mt-auto flex flex-col gap-2">
          <button type="button" className={styles.neon} disabled={busy} onClick={bringIn}>
            {busy ? "Bringing it in…" : "This is my league"}
          </button>
          <button type="button" className={styles.ghost} onClick={() => go("connectLink")}>
            Not it? Paste a different link
          </button>
        </div>
      </>
    );
  }

  if (view === "connectClaim" && created && sharedLogin.length > 0) {
    content = (
      <>
        <div className="flex flex-col gap-2">
          <span className={styles.kicker}>{created.name} is here</span>
          <h1 className={`${anton.className} ${styles.title}`}>Which team is yours?</h1>
        </div>
        {sharedPicker(created.id, PLATFORM_NAME[platform], (teamName) => {
          setYours({ owner_id: 0, team_name: teamName });
          void getLeagueClaims(created.id).then((c) => setUnclaimed(c.owners)).catch(() => {});
        })}
      </>
    );
  } else if (view === "connectClaim" && created && yours) {
    content = (
      <>
        <div className="flex flex-col gap-2">
          <span className={styles.kicker}>{created.name} is here</span>
          <h1 className={`${anton.className} ${styles.title}`}>You&apos;re {yours.team_name}</h1>
          <p className={styles.sub}>
            Your {PLATFORM_NAME[platform]} team was already linked to your account, so there&apos;s nothing to pick.
          </p>
        </div>
        {reported ? (
          <p className="text-sm text-[#aab2bf]">Thanks. We&apos;ll look into it.</p>
        ) : (
          <button
            type="button"
            className="w-fit text-sm text-[#aab2bf] underline"
            onClick={() => {
              if (window.confirm("Not your team? We'll tell the people who run The Weekend and fix it by hand.")) {
                void notMyTeam(created.id).then(() => setReported(true)).catch(() => setError("Couldn't send that. Try again in a minute."));
              }
            }}
          >
            Not my team?
          </button>
        )}
        <AlreadyHere people={alreadyHere} />
        <button
          type="button"
          className={`${styles.neon} mt-auto`}
          onClick={() => {
            setUnclaimedLeft(unclaimed.length);
            go("connectInvite");
          }}
        >
          Continue
        </button>
      </>
    );
  } else if (view === "connectClaim" && created) {
    content = (
      <>
        <div className="flex flex-col gap-2">
          <span className={styles.kicker}>{created.name} is here</span>
          <h1 className={`${anton.className} ${styles.title}`}>Which team is yours?</h1>
          <p className={styles.sub}>These came from your league on {PLATFORM_NAME[platform]}.</p>
        </div>
        <AlreadyHere people={alreadyHere} />
        {unclaimed.length === 0 && <p className="text-sm text-[#aab2bf]">Still bringing your teams in. Refresh in a minute if they don&apos;t show.</p>}
        <div className="flex flex-col gap-2">
          {unclaimed.map((o) => (
            <Option
              key={o.owner_id}
              on={mine === o.owner_id}
              onClick={() => setMine(o.owner_id)}
              icon={<UsersIcon />}
              color="var(--wl-accent)"
              title={o.team_name ?? o.display_name}
              text={`${PLATFORM_NAME[platform]} owner: ${o.display_name}`}
            />
          ))}
        </div>
        {error && <p className={styles.error}>{error}</p>}
        <button type="button" className={`${styles.neon} mt-auto`} disabled={mine === null || busy} onClick={claimMine}>
          {busy ? "Claiming…" : "That's me"}
        </button>
      </>
    );
  }

  if (view === "connectInvite" && created && found) {
    content = <ConnectInvite league={created} total={found.team_count} unclaimedLeft={unclaimedLeft} platformName={PLATFORM_NAME[platform]} />;
  }

  return (
    <div className={styles.shell}>
      <div className={styles.glowA} aria-hidden />
      <div className={styles.glowB} aria-hidden />
      {content}
    </div>
  );
}

// Managers in this league who are already on The Weekend: they aren't in
// the picker, so say who they are instead of leaving them out.
function AlreadyHere({ people }: { people: { display_name: string; team_name: string; member: boolean }[] }) {
  if (people.length === 0) return null;
  return (
    <div className={styles.card}>
      <span className={styles.kicker}>Already on The Weekend</span>
      {people.map((p) => (
        <span key={`${p.display_name}-${p.team_name}`} className="text-sm">
          {p.display_name} · {p.team_name}
          {p.member ? " ✓" : ""}
        </span>
      ))}
      <span className="text-sm leading-snug text-[#aab2bf]">
        Their teams are already theirs. They just open your invite link to see this league.
      </span>
    </div>
  );
}

function ConnectInvite({ league, total, unclaimedLeft, platformName }: { league: League; total: number; unclaimedLeft: number | null; platformName: string }) {
  const [copied, setCopied] = useState(false);
  const [link, setLink] = useState("");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- needs the browser's own origin
    setLink(`${window.location.origin}/start?join=${encodeURIComponent(league.invite_code)}`);
  }, [league.invite_code]);
  const claimed = total - (unclaimedLeft ?? total - 1);
  const message = `Our league is on The Weekend now: write-ups before every matchup, live gamecasts and a real league chat. Still on ${platformName}, nothing changes there. Tap to claim your team: ${link}`;

  async function send() {
    if (navigator.share) {
      await navigator.share({ title: league.name, text: message }).catch(() => {});
      return;
    }
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked: the message is on screen to copy by hand.
    }
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <span className={styles.kicker}>Your league is here</span>
        <h1 className={`${anton.className} ${styles.title}`}>Now bring everyone in</h1>
        <p className={styles.sub}>Send one message to your group chat. Each person taps the link, signs up and picks their team.</p>
      </div>
      <div className={styles.card}>
        <span className={styles.kicker}>The message</span>
        <p className="text-sm leading-relaxed">{message}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex justify-between text-sm">
          <span className="font-semibold">Who&apos;s claimed</span>
          <span className="font-mono font-bold text-[color:var(--wl-accent)]">
            {claimed} / {total}
          </span>
        </div>
        <div className={styles.bar}>
          <div className={styles.barFill} style={{ width: `${Math.max(4, (claimed / Math.max(1, total)) * 100)}%` }} />
        </div>
      </div>
      <div className="mt-auto flex flex-col gap-2">
        <button type="button" className={styles.neon} onClick={send}>
          {copied ? "Copied" : "Send to the group chat"}
        </button>
        <Link href="/" className="p-2.5 text-center text-sm text-[#aab2bf]">
          Go to my league
        </Link>
      </div>
    </>
  );
}

function InviteScreen({ league, teamCount, hasDraftDate }: { league: League; teamCount: number; hasDraftDate: boolean }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [link, setLink] = useState("");
  useEffect(() => {
    const url = `${window.location.origin}/start?join=${encodeURIComponent(league.invite_code)}`;
    QRCode.toString(url, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#0d1016", light: "#ffffff" } })
      .then((s) => {
        setLink(url);
        setSvg(s);
      })
      .catch(() => setLink(url));
  }, [league.invite_code]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked — the link is on screen to copy by hand.
    }
  }

  async function share() {
    const text = `Join my league "${league.name}" on The Weekend — code ${league.invite_code}. Get the iPhone app: ${IOS_APP_URL}`;
    if (navigator.share) {
      await navigator.share({ title: league.name, text, url: link }).catch(() => {});
    } else {
      await copy();
    }
  }

  return (
    <>
      <div className="flex flex-col items-center gap-2 pt-1 text-center">
        <span className="flex items-center gap-2 text-xs font-bold tracking-wider text-[color:var(--wl-accent)] uppercase">
          <CheckIcon /> {league.name} is live
        </span>
        <h1 className={`${anton.className} ${styles.title}`}>Now bring your league</h1>
        <p className={styles.sub}>Everyone who scans this or opens the link lands right in your league.</p>
      </div>
      <div className={styles.qr} aria-label="League invite QR code" role="img">
        {svg ? <div dangerouslySetInnerHTML={{ __html: svg }} /> : <div className="h-[12.5rem] w-[12.5rem]" />}
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex justify-between text-sm">
          <span className="text-[#aab2bf]">Teams in</span>
          <span className="font-mono font-bold">1 / {teamCount}</span>
        </div>
        <div className={styles.bar}>
          <div className={styles.barFill} style={{ width: `${100 / teamCount}%` }} />
        </div>
      </div>
      <div className="flex min-h-[3.25rem] items-center gap-2.5 rounded-xl border border-[#2a303a] bg-[#191d23] pr-1.5 pl-3.5">
        <span className="flex-grow truncate font-mono text-sm">{link.replace(/^https?:\/\//, "")}</span>
        <button type="button" onClick={copy} className="min-h-10 rounded-lg bg-[color:var(--wl-surface)] px-3 text-sm font-semibold">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <button type="button" className={styles.neon} onClick={share}>
          Share
        </button>
        <div className={styles.ghost} aria-label={`League code ${league.invite_code}`}>
          Code: <span className="font-mono tracking-widest">{league.invite_code}</span>
        </div>
      </div>
      <div className="mt-auto flex flex-col gap-2">
        {!hasDraftDate && (
          <Link href="/draft" className={styles.ghost}>
            Set your draft date
          </Link>
        )}
        <Link href="/" className="p-2.5 text-center text-sm text-[#aab2bf]">
          Go to my league
        </Link>
      </div>
    </>
  );
}

// A text field a button needs filled in (2026-10-27: a beta tester read
// a dimmed Continue as broken). The button stays clickable; check()
// returns true when the field's filled, else outlines it, says what's
// missing and puts the cursor there. Spread `field` onto the input and
// render `message` under it.
function useRequired(id: string, value: string, message: string) {
  const [tried, setTried] = useState(false);
  const empty = !value.trim();
  const showing = tried && empty;
  const check = () => {
    if (!empty) return true;
    setTried(true);
    document.getElementById(id)?.focus();
    return false;
  };
  return {
    empty,
    check,
    field: { id, "aria-invalid": showing, "aria-describedby": showing ? `${id}-error` : undefined },
    message: showing ? <p id={`${id}-error`} className={styles.error} role="alert">{message}</p> : null,
  };
}


// Claiming a team links it to your account in every league, so it asks
// first: a wrong tap is the one way a team gets mixed up (2026-10-28).
function confirmClaim(teamName: string): boolean {
  return window.confirm(`Is ${teamName} your team? Claiming it links it to your account in every league.`);
}

function Top({ onBack, step }: { onBack: () => void; step?: number }) {
  return (
    <div className="flex items-center justify-between">
      <button type="button" className={styles.back} onClick={onBack}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M15 18l-6-6 6-6" />
        </svg>
        Back
      </button>
      {step && (
        <div className={styles.dots} aria-label={`Step ${step} of 4`}>
          {[1, 2, 3, 4].map((i) => (
            <span key={i} className={`${styles.dot} ${i === step ? styles.dotNow : i < step ? styles.dotDone : ""}`} />
          ))}
        </div>
      )}
    </div>
  );
}

function Door({ onClick, accent, icon, title, text }: { onClick: () => void; accent: string; icon: ReactNode; title: string; text: string }) {
  return (
    <button type="button" onClick={onClick} className={styles.door} style={{ border: `1px solid ${accent}55`, boxShadow: `0 0 22px ${accent}22` }}>
      <span className={styles.doorIcon} style={{ background: `${accent}1f`, color: accent }}>
        {icon}
      </span>
      <span className="flex flex-grow flex-col gap-1">
        <span className={`${anton.className} ${styles.doorTitle}`}>{title}</span>
        <span className="text-sm leading-snug text-[#aab2bf]">{text}</span>
      </span>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8790a0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M9 18l6-6-6-6" />
      </svg>
    </button>
  );
}

function Option({
  on,
  onClick,
  icon,
  color,
  title,
  text,
  disabled,
}: {
  on: boolean;
  onClick: () => void;
  icon: ReactNode;
  color: string;
  title: string;
  text: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      className={`${styles.option} ${on ? styles.optionOn : ""} disabled:opacity-45`}
    >
      <span style={{ color }}>{icon}</span>
      <span className="flex flex-col gap-1">
        <span className="font-bold">{title}</span>
        <span className="text-sm leading-snug text-[#aab2bf]">{text}</span>
      </span>
    </button>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-semibold text-[#aab2bf]">{label}</span>
      {children}
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className={styles.stat}>
      <div className="font-mono text-lg font-bold">{value}</div>
      <div className="text-xs text-[color:var(--wl-text-secondary)]">{label}</div>
    </div>
  );
}

// "Bucky'd Up · 2–1 · Week 4 · Commissioner", like the mockup.
function cardLine(l: League): string {
  const s = l.summary;
  const role = l.role === "commissioner" ? "Commissioner" : "Member";
  if (!s?.team_name) return s && s.team_count ? `${s.teams} of ${s.team_count} teams in · ${role}` : role;
  const bits = [s.team_name];
  if (s.record && s.draft_status === "complete") bits.push(s.record.replace("-", "–"));
  if (s.week && s.draft_status === "complete") bits.push(`Week ${s.week}`);
  bits.push(role);
  return bits.join(" · ");
}

// What's next for the league, when there's something: the draft, or
// open spots before it.
function statusChip(l: League): string | null {
  const s = l.summary;
  if (!s || s.draft_status === "complete") return null;
  if (s.draft_at && new Date(s.draft_at).getTime() > Date.now()) {
    const d = new Date(s.draft_at);
    return `Draft ${d.toLocaleDateString(undefined, { weekday: "short" })} ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  }
  if (s.draft_status === "in_progress" || s.draft_status === "paused") return "Drafting now";
  if (s.team_count && s.teams < s.team_count) return `${s.team_count - s.teams} spots open`;
  return null;
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join("") || "?"
  );
}

function formatDraft(local: string): string {
  const d = new Date(local);
  return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const svgProps = { width: 24, height: 24, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
function UsersIcon() {
  return (
    <svg {...svgProps} width={26} height={26}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg {...svgProps}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}
function DownloadIcon() {
  return (
    <svg {...svgProps} width={20} height={20}>
      <path d="M12 3v12" />
      <path d="M7 10l5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg {...svgProps} width={18} height={18}>
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

// Fallback limits for the type settings until GET /leagues/formats answers.
const DEFAULT_LIMITS: Record<string, { default: number; min: number; max: number }> = {
  keepers_per_team: { default: 2, min: 1, max: 10 },
  rookie_draft_rounds: { default: 4, min: 1, max: 10 },
  taxi_squad_size: { default: 3, min: 0, max: 10 },
  bench_size: { default: 10, min: 4, max: 20 },
  faab_budget: { default: 1000, min: 100, max: 10000 },
};

function Segs<K extends string>({
  columns,
  options,
  value,
  onChange,
}: {
  columns: number;
  options: { key: K; label: string; sub?: string; available: boolean }[];
  value: K;
  onChange: (key: K) => void;
}) {
  return (
    <div className={styles.segs} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          aria-pressed={value === o.key}
          disabled={!o.available}
          className={`${styles.seg} ${value === o.key ? styles.segOn : ""} ${o.available ? "" : "opacity-50"}`}
          onClick={() => onChange(o.key)}
        >
          <span className="block">{o.label}</span>
          {(o.sub || !o.available) && <span className={styles.segSub}>{o.available ? o.sub : "Soon"}</span>}
        </button>
      ))}
    </div>
  );
}

function LeagueTypeIcon({ type }: { type: LeagueType }) {
  const paths: Record<LeagueType, ReactNode> = {
    redraft: (
      <>
        <path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3" />
        <path d="M18 3v4h-4M6 21v-4h4" />
      </>
    ),
    keeper: <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />,
    dynasty: <path d="M3 18h18M5 18l-1-9 5 4 3-7 3 7 5-4-1 9" />,
    bestball: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M8.5 12.5l2.5 2.5 4.5-5" />
      </>
    ),
    guillotine: <path d="M6 3v18M18 3v18M6 6h12M8 9l8 3" />,
  };
  return (
    <svg {...svgProps} width={20} height={20}>
      {paths[type]}
    </svg>
  );
}
