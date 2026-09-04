"use client";

import { useEffect, useRef, useState } from "react";
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
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-grows with the message instead of starting at a fixed tall
  // height (that made a short "practice starts Sunday" post sit in the
  // same oversized box as a real 20,000-char league update). Resets
  // "auto" first so deleting text shrinks the box back down too, not
  // just growing one-way — same technique used for growing an <input>
  // to fit its value.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [body]);

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
          ref={bodyRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write the announcement..."
          maxLength={MAX_BODY_LENGTH}
          rows={3}
          aria-label="Announcement body"
          // resize-none since the height is already driven by the
          // effect above — a manual drag-resize handle would just
          // fight the next keystroke's auto-resize. max-h keeps a
          // very long post from growing the box past the screen;
          // overflow-y-auto takes over with a normal scrollbar once
          // that cap is hit.
          className="max-h-[60vh] resize-none overflow-y-auto rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--wl-accent-dim)] dark:border-white/10"
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
