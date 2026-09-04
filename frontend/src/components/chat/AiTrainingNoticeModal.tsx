"use client";

// Shown once, the first time an owner ever goes to send a chat
// message — not a gate on this feature actually existing yet (it
// doesn't), just getting real, informed consent on record ahead of
// time. Opt-out model: "Continue" sends the message and leaves the
// owner opted in; "Opt Out" also sends the message, just records the
// choice differently. Either way this shows exactly once — Settings >
// Chat carries the same toggle afterward for changing your mind.
export function AiTrainingNoticeModal({
  onContinue,
  onOptOut,
}: {
  onContinue: () => void;
  onOptOut: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-black/10 bg-[var(--background)] p-5 shadow-xl dark:border-white/10">
        <h2 className="text-lg font-semibold">Before you send your first message</h2>
        <p className="text-sm text-black/70 dark:text-white/70">
          We&apos;re considering a future feature where the app&apos;s AI learns to talk trash by studying real
          league chat messages. It doesn&apos;t exist yet, but we wanted to ask up front rather than surprise you
          later.
        </p>
        <p className="text-sm text-black/70 dark:text-white/70">
          By default your messages would be eligible if that feature ships. You can opt out now, or change your
          mind anytime in Settings &gt; Chat.
        </p>
        <div className="flex flex-col gap-2 pt-1">
          <button
            onClick={onContinue}
            className="rounded-full bg-[var(--wl-accent-dim)] px-4 py-2.5 text-sm font-medium text-white"
          >
            Continue — keep me opted in
          </button>
          <button
            onClick={onOptOut}
            className="rounded-full border border-black/10 px-4 py-2.5 text-sm font-medium hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"
          >
            Opt me out
          </button>
        </div>
      </div>
    </div>
  );
}
