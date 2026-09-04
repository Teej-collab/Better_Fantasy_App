"use client";

import { useState } from "react";
import { AiTrainingNoticeModal } from "@/components/chat/AiTrainingNoticeModal";

const MAX_TITLE_LENGTH = 200;
// Matches the backend's own MAX_ANNOUNCEMENT_BODY_LENGTH
// (app/routers/chat.py) — a real league update can run much longer
// than a chat message, so this is far more generous than the plain
// composer's MAX_LENGTH.
const MAX_BODY_LENGTH = 20000;

// Replaces the plain chat composer for Commish's Corner — an
// announcement is a short article (headline + body), not a quick chat
// message, so it gets its own two-field form instead of a single text
// box. Text-only for now (no image attachment) — a deliberate scope
// cut, not an oversight; can be added later reusing MessageComposer's
// own upload path if wanted.
export function PostAnnouncementForm({
  onPost,
  aiNoticeSeen,
  onAiNoticeResolved,
}: {
  onPost: (title: string, body: string) => void;
  // Same one-time consent gate MessageComposer.tsx uses — an
  // announcement is still a real chat message under the hood, so it
  // goes through the identical first-ever-send interception.
  aiNoticeSeen: boolean;
  onAiNoticeResolved: (optOut: boolean) => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [showAiNotice, setShowAiNotice] = useState(false);

  function doPost() {
    const trimmedTitle = title.trim();
    const trimmedBody = body.trim();
    if (!trimmedTitle || !trimmedBody) return;
    onPost(trimmedTitle, trimmedBody);
    setTitle("");
    setBody("");
  }

  function submit() {
    if (!title.trim() || !body.trim()) return;
    if (!aiNoticeSeen) {
      setShowAiNotice(true);
      return;
    }
    doPost();
  }

  function resolveAiNotice(optOut: boolean) {
    setShowAiNotice(false);
    onAiNoticeResolved(optOut);
    doPost();
  }

  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex flex-col gap-2 border-t border-black/10 bg-[var(--background)] p-3 dark:border-white/10"
      >
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Announcement title..."
          maxLength={MAX_TITLE_LENGTH}
          aria-label="Announcement title"
          className="rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm font-medium outline-none focus:border-[var(--wl-accent-dim)] dark:border-white/10"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write the announcement..."
          maxLength={MAX_BODY_LENGTH}
          rows={4}
          aria-label="Announcement body"
          // Real default height (not just `rows`, which reads as
          // cramped once posts run long — a 20,000-char announcement
          // in a 6-line box meant constant scrolling just to review
          // what you'd written), taller still on desktop where there's
          // real room to spare. resize-y instead of resize-none lets
          // anyone drag it bigger on top of that; max-h keeps a drag-
          // resize from swallowing the whole screen.
          className="min-h-32 max-h-[60vh] resize-y rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--wl-accent-dim)] sm:min-h-64 dark:border-white/10"
        />
        <button
          type="submit"
          disabled={!title.trim() || !body.trim()}
          className="self-end rounded-full bg-[var(--wl-accent-dim)] px-4 py-2 text-sm font-medium text-white transition-transform active:scale-95 disabled:opacity-30"
        >
          Post Announcement
        </button>
      </form>

      {showAiNotice && (
        <AiTrainingNoticeModal onContinue={() => resolveAiNotice(false)} onOptOut={() => resolveAiNotice(true)} />
      )}
    </>
  );
}
