"use client";

import { Anton } from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { useEffect, useState, type ReactNode } from "react";
import { setDraftSchedule } from "@/lib/draftApi";
import {
  claimOwner,
  createLeague,
  createTeam,
  getMyLeagues,
  getUnclaimedOwners,
  joinLeague,
  previewLeague,
  selectLeague,
  type League,
  type LeaguePreview,
  type ScoringPreset,
  type UnclaimedOwner,
} from "@/lib/leaguesApi";
import { seasonalEmblem } from "@/lib/seasonal";
import styles from "./StartFlow.module.css";

const anton = Anton({ weight: "400", subsets: ["latin"] });

// The front door for joining or creating a league — the approved "Join &
// Create League Flow" mockups. One decision per screen:
// - home: two doors (Join / Create) for someone with no league yet, or
//   "Welcome back" with their leagues for someone who has one;
// - join: paste a link or code (or scan the QR with the phone's camera),
//   see the league before joining, then claim your past team's history
//   or start a new team;
// - create: name + start fresh / from ESPN, the basics (teams, scoring,
//   draft, keepers), your team — then an invite screen with the QR.
// Everything here is an existing endpoint (backend app/routers/
// leagues.py); /leagues stays as the full management page.

type View = "home" | "join" | "joinTeam" | "create1" | "create2" | "create3" | "invite";

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
  const [source, setSource] = useState<"fresh" | "espn">("fresh");
  const [teamCount, setTeamCount] = useState(12);
  const [scoring, setScoring] = useState<ScoringPreset>("ppr");
  const [draftAt, setDraftAt] = useState("");
  const [keepers, setKeepers] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [created, setCreated] = useState<League | null>(null);

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
      const owners = await getUnclaimedOwners(preview.id).catch(() => []);
      setUnclaimed(owners);
      setClaimId(owners[0]?.owner_id ?? null);
      setNewTeamName("");
      go("joinTeam");
    });

  const finishJoin = (mode: "claim" | "new") =>
    run(async () => {
      if (!joined) return;
      if (mode === "claim" && claimId !== null) await claimOwner(joined.id, claimId);
      if (mode === "new") await createTeam(joined.id, newTeamName.trim());
      router.push("/");
      router.refresh();
    });

  const createNow = () =>
    run(async () => {
      const league = await createLeague(leagueName.trim(), { teamCount, scoring, keepers, makeActive: true });
      await createTeam(league.id, teamName.trim());
      if (draftAt) await setDraftSchedule(draftAt).catch(() => {});
      setCreated(league);
      go("invite");
    });

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
              <span className="text-sm text-[#aab2bf] capitalize">{l.role}</span>
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
            <strong className="text-[color:var(--wl-text)]">Moving from ESPN?</strong> Bring your league over with every past season, record and rivalry.
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
      </>
    );
  }

  if (view === "joinTeam" && joined) {
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
                <span className="flex-grow font-semibold">{o.display_name}</span>
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
          <input className={styles.field} value={newTeamName} onChange={(e) => setNewTeamName(e.target.value)} maxLength={40} placeholder="Name your team" />
        </label>
        {error && <p className={styles.error}>{error}</p>}
        <button
          type="button"
          className={unclaimed.length > 0 ? styles.ghost : `${styles.neon} mt-auto`}
          disabled={!newTeamName.trim() || busy}
          onClick={() => finishJoin("new")}
        >
          Start a new team
        </button>
      </>
    );
  }

  if (view === "create1") {
    content = (
      <>
        <Top onBack={() => go("home")} step={1} />
        <div className="flex flex-col gap-2">
          <span className={styles.kicker}>Create a league · 1 of 3</span>
          <h1 className={`${anton.className} ${styles.title}`}>Name your league</h1>
        </div>
        <label className={styles.label}>
          League name
          <input className={`${styles.field} text-lg font-semibold`} value={leagueName} onChange={(e) => setLeagueName(e.target.value)} maxLength={40} placeholder="Sunday Scaries" />
        </label>
        <div className="flex flex-col gap-2.5">
          <span className={styles.kicker}>Start from</span>
          <Option on={source === "fresh"} onClick={() => setSource("fresh")} icon={<PlusIcon />} color="var(--wl-accent)" title="Start fresh" text="A new league with good defaults. Tweak anything later." />
          <Option
            on={source === "espn"}
            onClick={() => setSource("espn")}
            icon={<DownloadIcon />}
            color="#fbbf24"
            title="Bring it over from ESPN"
            text="After it's created, connect ESPN to import every past season, owner, matchup and record."
          />
        </div>
        <button type="button" className={`${styles.neon} mt-auto`} disabled={!leagueName.trim()} onClick={() => go("create2")}>
          Continue
        </button>
      </>
    );
  }

  if (view === "create2") {
    content = (
      <>
        <Top onBack={() => go("create1")} step={2} />
        <div className="flex flex-col gap-2">
          <span className={styles.kicker}>Create a league · 2 of 3</span>
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
        <Group label="Draft">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <input type="datetime-local" className={styles.field} value={draftAt} onChange={(e) => setDraftAt(e.target.value)} aria-label="Draft date and time" />
            <button type="button" className={`${styles.seg} px-3.5 ${draftAt ? "" : styles.segOn}`} aria-pressed={!draftAt} onClick={() => setDraftAt("")}>
              Decide later
            </button>
          </div>
        </Group>
        <div className={`${styles.card} flex-row items-center justify-between`}>
          <div className="flex flex-col">
            <span className="font-semibold">Keepers</span>
            <span className="text-sm text-[color:var(--wl-text-secondary)]">Teams keep players into next season</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={keepers}
            aria-label="Keepers"
            className={`${styles.switch} ${keepers ? styles.switchOn : ""}`}
            onClick={() => setKeepers((k) => !k)}
          >
            <span className={styles.knob} />
          </button>
        </div>
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
        <Top onBack={() => go("create2")} step={3} />
        <div className="flex flex-col gap-2">
          <span className={styles.kicker}>Create a league · 3 of 3</span>
          <h1 className={`${anton.className} ${styles.title}`}>Now your team</h1>
          <p className={styles.sub}>This is what everyone sees in standings, matchups and chat. Add a logo any time in Settings.</p>
        </div>
        <label className={styles.label}>
          Team name
          <input className={`${styles.field} text-lg font-semibold`} value={teamName} onChange={(e) => setTeamName(e.target.value)} maxLength={40} placeholder="Name your team" />
        </label>
        <div className={styles.card}>
          <span className={styles.kicker}>Your league</span>
          <span className={`${anton.className} text-2xl tracking-wide uppercase`}>{leagueName}</span>
          <span className="text-sm text-[#aab2bf]">
            {teamCount} teams · {SCORING.find((s) => s.key === scoring)?.label} · {draftAt ? `Draft ${formatDraft(draftAt)}` : "Draft date later"} · Keepers {keepers ? "on" : "off"}
          </span>
        </div>
        {error && <p className={styles.error}>{error}</p>}
        <button type="button" className={`${styles.neon} mt-auto`} disabled={!teamName.trim() || busy} onClick={createNow}>
          {busy ? "Creating…" : "Create league"}
        </button>
      </>
    );
  }

  if (view === "invite" && created) {
    content = <InviteScreen league={created} teamCount={teamCount} fromEspn={source === "espn"} hasDraftDate={!!draftAt} />;
  }

  return (
    <div className={styles.shell}>
      <div className={styles.glowA} aria-hidden />
      <div className={styles.glowB} aria-hidden />
      {content}
    </div>
  );
}

function InviteScreen({ league, teamCount, fromEspn, hasDraftDate }: { league: League; teamCount: number; fromEspn: boolean; hasDraftDate: boolean }) {
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
    const text = `Join my league "${league.name}" on The Weekend — code ${league.invite_code}`;
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
        {fromEspn && (
          <Link href="/commissioner/espn" className={styles.ghost}>
            Connect ESPN to import your history
          </Link>
        )}
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
        <div className={styles.dots} aria-label={`Step ${step} of 3`}>
          {[1, 2, 3].map((i) => (
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

function Option({ on, onClick, icon, color, title, text }: { on: boolean; onClick: () => void; icon: ReactNode; color: string; title: string; text: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} className={`${styles.option} ${on ? styles.optionOn : ""}`}>
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
