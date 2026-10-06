import * as Haptics from "expo-haptics";
import { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";

import { Text } from "@/components/Text";
import { Card } from "@/components/ui";
import { Colors, Radius, Spacing } from "@/constants/theme";
import { api } from "@/lib/api";
import { formatGameTime, formatPoints } from "@/lib/format";
import { invalidateRosterMoves, useMyTeam } from "@/lib/queries";
import { slotDisplayLabel } from "@/lib/rosterSlots";
import type { FreeAgent, RosterEntry } from "@/lib/types";

function formatClearsAt(iso: string | null): string {
  if (!iso) return "On waivers.";
  const date = new Date(iso);
  return `On waivers until ${date.toLocaleDateString(undefined, { weekday: "short" })} ${date.toLocaleTimeString(
    undefined,
    {
      hour: "numeric",
      minute: "2-digit",
    },
  )}.`;
}

// Add a free agent, or file a waiver claim when they're on waivers.
// Mirrors the web flow: an add that comes back roster_full asks who to
// drop and tries again; one that comes back on_waivers turns into a
// claim. A claim can name a drop, used only if the claim wins.
export function PlayerActionSheet({
  player,
  onClose,
}: {
  player: FreeAgent;
  onClose: () => void;
}) {
  const team = useMyTeam();
  const [mode, setMode] = useState<"add" | "claim">(
    player.waiver_clears_at || player.game_locked ? "claim" : "add",
  );
  const [clearsAt, setClearsAt] = useState(player.waiver_clears_at);
  const [pickingDrop, setPickingDrop] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // An add happens now, so a player whose game started can't be the
  // drop. A claim doesn't run until waivers clear — by then that game
  // is over — so anyone on the roster can be its drop (the server
  // allows it; before this, a claim on Monday night offered no drops
  // at all, only "No drop").
  const roster = team.data?.roster ?? [];

  async function add(drop?: RosterEntry) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.addFreeAgent(
        player.sleeper_player_id,
        drop?.player_id,
      );
      if (result.status === "ok") {
        finish(
          drop
            ? `Added ${player.full_name} and dropped ${drop.player_name}.`
            : `Added ${player.full_name}.`,
        );
      } else if (result.status === "roster_full") {
        setPickingDrop(true);
        setMessage("Your roster is full. Pick someone to drop.");
      } else {
        setMode("claim");
        setClearsAt(result.clears_at);
        setPickingDrop(false);
        setMessage(result.detail);
      }
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function claim(drop: RosterEntry | null) {
    setBusy(true);
    setMessage(null);
    try {
      await api.submitWaiverClaim(
        player.sleeper_player_id,
        drop?.player_id ?? null,
      );
      finish(
        `Claim filed for ${player.full_name}. It's decided when waivers clear.`,
      );
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  function finish(text: string) {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    invalidateRosterMoves();
    setDone(text);
  }

  function fail(e: unknown) {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    setMessage(e instanceof Error ? e.message : "Something went wrong.");
  }

  const opponent = player.next_opponent
    ? `${player.next_opponent}${player.game_time ? ` ${formatGameTime(player.game_time)}` : ""}`
    : null;

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.sheet}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.name} numberOfLines={1}>
              {player.full_name}
            </Text>
            <Text style={styles.muted}>
              {player.position === "DEF" ? "D/ST" : player.position}
              {player.pro_team ? ` · ${player.pro_team}` : ""}
              {player.injury_status ? ` · ${player.injury_status}` : ""}
            </Text>
          </View>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.close}>{done ? "Done" : "Cancel"}</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.stats}>
            <Stat label="Proj" value={formatPoints(player.projected_points)} />
            <Stat label="This week" value={formatPoints(player.score)} />
            <Stat
              label="Last week"
              value={formatPoints(player.last_week_score)}
            />
          </View>
          {opponent && <Text style={styles.muted}>Next: {opponent}</Text>}
          {mode === "claim" && (
            <Text style={styles.waivers}>{formatClearsAt(clearsAt)}</Text>
          )}

          {done ? (
            <Text style={styles.done}>{done}</Text>
          ) : (
            <>
              {message && <Text style={styles.message}>{message}</Text>}

              {!pickingDrop && (
                <Pressable
                  disabled={busy}
                  onPress={() =>
                    mode === "add" ? add() : setPickingDrop(true)
                  }
                  style={({ pressed }) => [
                    styles.primary,
                    (pressed || busy) && styles.pressed,
                  ]}
                >
                  {busy ? (
                    <ActivityIndicator color={Colors.bg} />
                  ) : (
                    <Text style={styles.primaryText}>
                      {mode === "add" ? "Add to roster" : "Place waiver claim"}
                    </Text>
                  )}
                </Pressable>
              )}

              {pickingDrop && (
                <>
                  <Text style={styles.pickTitle}>
                    {mode === "add"
                      ? "Drop a player"
                      : "Drop if the claim wins"}
                  </Text>
                  <Card style={styles.list}>
                    {roster.map((entry, i) => {
                      const locked = mode === "add" && entry.is_locked;
                      return (
                        <DropRow
                          key={entry.player_id}
                          divided={i > 0}
                          label={entry.player_name}
                          detail={`${slotDisplayLabel(entry.lineup_slot)} · ${entry.position}${entry.pro_team ? ` · ${entry.pro_team}` : ""}${locked ? " · Game started" : ""}`}
                          disabled={busy || locked}
                          unavailable={locked}
                          onPress={() =>
                            mode === "add" ? add(entry) : claim(entry)
                          }
                        />
                      );
                    })}
                    {mode === "claim" && (
                      <DropRow
                        label="No drop"
                        detail="Only works if you have an open roster spot"
                        onPress={() => claim(null)}
                        disabled={busy}
                        divided={roster.length > 0}
                      />
                    )}
                  </Card>
                  {busy && (
                    <ActivityIndicator
                      color={Colors.accent}
                      style={styles.spinner}
                    />
                  )}
                </>
              )}
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function DropRow(props: {
  label: string;
  unavailable?: boolean;
  detail: string;
  onPress: () => void;
  disabled: boolean;
  divided?: boolean;
}) {
  return (
    <Pressable
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.dropRow,
        props.divided && styles.divided,
        pressed && styles.dropPressed,
        props.unavailable && styles.dropDisabled,
      ]}
    >
      <View style={styles.dropText}>
        <Text style={styles.dropName}>{props.label}</Text>
        <Text style={styles.muted}>{props.detail}</Text>
      </View>
      <Text style={styles.dropAction}>Drop</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  headerText: { flex: 1, gap: 2 },
  name: { color: Colors.text, fontSize: 22, fontWeight: "800" },
  close: { color: Colors.accent, fontSize: 16, fontWeight: "600" },
  content: { padding: Spacing.lg, gap: Spacing.md },
  stats: { flexDirection: "row", gap: Spacing.md },
  stat: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    padding: Spacing.md,
    alignItems: "center",
  },
  statValue: {
    color: Colors.text,
    fontSize: 20,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  statLabel: { color: Colors.textSecondary, fontSize: 12, marginTop: 2 },
  muted: { color: Colors.textSecondary, fontSize: 13 },
  waivers: { color: Colors.accent, fontSize: 14, fontWeight: "600" },
  message: { color: Colors.text, fontSize: 14 },
  done: {
    color: Colors.win,
    fontSize: 16,
    fontWeight: "700",
    marginTop: Spacing.md,
  },
  primary: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.pill,
    paddingVertical: Spacing.lg,
    alignItems: "center",
    marginTop: Spacing.md,
  },
  primaryText: { color: Colors.bg, fontSize: 16, fontWeight: "800" },
  pressed: { opacity: 0.7 },
  pickTitle: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginTop: Spacing.md,
  },
  list: { padding: 0, overflow: "hidden" },
  dropRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  divided: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  dropPressed: { backgroundColor: Colors.border },
  dropDisabled: { opacity: 0.4 },
  dropText: { flex: 1, gap: 2 },
  dropName: { color: Colors.text, fontSize: 15, fontWeight: "600" },
  dropAction: { color: Colors.loss, fontSize: 13, fontWeight: "700" },
  spinner: { marginTop: Spacing.md },
});
