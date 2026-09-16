"use client";

import { upload } from "@vercel/blob/client";
import { useEffect, useRef, useState } from "react";
import type { ChatGif, ChatMember, ChatMessage } from "@/lib/api";
import { AiTrainingNoticeModal } from "@/components/chat/AiTrainingNoticeModal";
import { GifPicker } from "@/components/chat/GifPicker";

const MAX_LENGTH = 2000;
const TYPING_DEBOUNCE_MS = 2000;
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

// BottomNav.tsx/BottomNavBeta.tsx are `position: fixed` app-shell chrome
// that lives outside this component entirely — the id is theirs
// (documented on BottomNav.tsx as existing for exactly this kind of
// cross-component reach-in). Focusing this composer's textarea makes
// iOS scroll the real document to lift the caret above the keyboard,
// and WebKit is well known to let `fixed` siblings get dragged along
// and stick wherever that scroll lands instead of re-pinning to the
// (now keyboard-covered) bottom — a real screen recording confirmed
// the nav floating mid-page, stuck, whenever the message field was
// focused. Hiding it for the duration of the focus removes the only
// fixed element that bug can happen to, rather than trying to out-math
// WebKit's compensation scroll with more JS (already tried and
// reverted once for this exact bar — see BottomNav.tsx's own comment).
function setBottomNavHidden(hidden: boolean) {
  const nav = document.getElementById("app-bottom-nav");
  if (nav) nav.style.display = hidden ? "none" : "";
}

type PendingImage =
  | { status: "uploading"; previewUrl: string }
  | { status: "done"; previewUrl: string; url: string }
  | { status: "error" };

export function MessageComposer({
  members,
  replyTo,
  onCancelReply,
  onSend,
  onTyping,
  aiNoticeSeen,
  onAiNoticeResolved,
}: {
  members: ChatMember[];
  replyTo: ChatMessage | null;
  onCancelReply: () => void;
  onSend: (body: string, mentions: number[], imageUrl: string | null) => void;
  onTyping: () => void;
  // Settings > Chat > "AI Learning From Chat" preference's own
  // ai_training_notice_seen flag — false means this owner has never
  // been shown the one-time consent warning yet, so their first real
  // send attempt below is intercepted to show it instead.
  aiNoticeSeen: boolean;
  onAiNoticeResolved: (optOut: boolean) => void;
}) {
  const [value, setValue] = useState("");
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [pendingMentions, setPendingMentions] = useState<Map<string, number>>(new Map());
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [showAiNotice, setShowAiNotice] = useState(false);
  // True while a drag carrying a file hovers the composer — dragCounter
  // (not a plain boolean) survives the dragenter/dragleave pairs that
  // fire on every child element as the pointer crosses them, which a
  // naive boolean would flicker off on.
  const [isDragActive, setIsDragActive] = useState(false);
  const dragCounter = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastTypingSentAt = useRef(0);

  useEffect(() => {
    if (replyTo) inputRef.current?.focus();
  }, [replyTo]);

  // Restore the fixed bottom nav if this composer unmounts (e.g. the
  // owner navigates away) while still focused — blur normally fires
  // first, but this is the safety net for whenever it doesn't.
  useEffect(() => {
    return () => setBottomNavHidden(false);
  }, []);

  const filteredMembers =
    mentionQuery === null
      ? []
      : members.filter((m) => m.display_name.toLowerCase().startsWith(mentionQuery.toLowerCase())).slice(0, 6);

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const text = e.target.value;
    setValue(text);

    const now = Date.now();
    if (now - lastTypingSentAt.current > TYPING_DEBOUNCE_MS) {
      lastTypingSentAt.current = now;
      onTyping();
    }

    const cursor = e.target.selectionStart ?? text.length;
    const beforeCursor = text.slice(0, cursor);
    const match = beforeCursor.match(/(?:^|\s)@(\w*)$/);
    setMentionQuery(match ? match[1] : null);
  }

  function selectMention(member: ChatMember) {
    const cursor = inputRef.current?.selectionStart ?? value.length;
    const beforeCursor = value.slice(0, cursor);
    const afterCursor = value.slice(cursor);
    const replaced = beforeCursor.replace(/@(\w*)$/, `@${member.display_name} `);
    setValue(replaced + afterCursor);
    setPendingMentions((prev) => new Map(prev).set(member.display_name, member.owner_id));
    setMentionQuery(null);
    inputRef.current?.focus();
  }

  // Shared by every capture path — file picker, clipboard paste, and
  // drag-and-drop all end up here so upload auth, the MIME allowlist,
  // and the 8MB server-side cap (app/api/chat/upload/route.ts) are
  // enforced identically regardless of how the file arrived.
  async function uploadImageFile(file: File) {
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) return;
    // One attachment slot, one upload at a time — a second pick/paste/
    // drop while one is already in flight would otherwise race it: two
    // concurrent uploads both resolve into the same pendingImage state,
    // and whichever finishes last silently wins regardless of which
    // one the user actually meant to send.
    if (pendingImage?.status === "uploading") return;

    const previewUrl = URL.createObjectURL(file);
    setPendingImage({ status: "uploading", previewUrl });
    try {
      const blob = await upload(file.name, file, {
        access: "public",
        handleUploadUrl: "/api/chat/upload",
      });
      setPendingImage({ status: "done", previewUrl, url: blob.url });
    } catch {
      setPendingImage({ status: "error" });
    }
  }

  function pickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) uploadImageFile(file);
  }

  // Clipboard paste — a supported image (screenshot, copied GIF,
  // copied photo) takes over the paste; plain text paste is left
  // completely alone so normal typing/pasting never breaks. Fires on
  // the textarea itself, same element normal paste already targets.
  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = Array.from(e.clipboardData?.items ?? []);
    const imageItem = items.find((item) => item.kind === "file" && ALLOWED_IMAGE_TYPES.includes(item.type));
    if (!imageItem) return; // no supported image on the clipboard — let normal text paste proceed
    const file = imageItem.getAsFile();
    if (!file) return;
    e.preventDefault();
    uploadImageFile(file);
  }

  // Drag-and-drop onto the composer — desktop only in practice (touch
  // devices don't fire these events), gracefully absent everywhere
  // else since nothing else in the component depends on it firing.
  function handleDragEnter(e: React.DragEvent) {
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    dragCounter.current += 1;
    setIsDragActive(true);
  }

  function handleDragOver(e: React.DragEvent) {
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
  }

  function handleDragLeave(e: React.DragEvent) {
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setIsDragActive(false);
  }

  function handleDrop(e: React.DragEvent) {
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    dragCounter.current = 0;
    setIsDragActive(false);
    const file = Array.from(e.dataTransfer.files).find((f) => ALLOWED_IMAGE_TYPES.includes(f.type));
    if (file) uploadImageFile(file);
  }

  function removeImage() {
    // A GIF's previewUrl is a real GIPHY URL, not an object URL this
    // component created — only ever revoke the kind pickImage minted.
    if (pendingImage?.status === "uploading" || (pendingImage?.status === "done" && pendingImage.previewUrl.startsWith("blob:"))) {
      URL.revokeObjectURL(pendingImage.previewUrl);
    }
    setPendingImage(null);
  }

  // A GIF is already hosted on GIPHY's CDN — no upload step, straight
  // to "done" the same shape pickImage's own upload eventually reaches.
  function pickGif(gif: ChatGif) {
    setPendingImage({ status: "done", previewUrl: gif.preview_url, url: gif.url });
    setShowGifPicker(false);
  }

  function doSend() {
    const body = value.trim();
    const imageUrl = pendingImage?.status === "done" ? pendingImage.url : null;
    if (!body && !imageUrl) return;
    if (pendingImage?.status === "uploading") return;
    const mentions = [...pendingMentions.entries()]
      .filter(([name]) => body.includes(`@${name}`))
      .map(([, id]) => id);
    onSend(body, mentions, imageUrl);
    setValue("");
    setPendingMentions(new Map());
    setMentionQuery(null);
    removeImage();
  }

  function send() {
    // Nothing to actually send (empty box, still uploading) — never
    // trigger the one-time consent warning over a no-op send attempt.
    const hasContent = value.trim() || pendingImage?.status === "done";
    if (!hasContent || pendingImage?.status === "uploading") return;

    if (!aiNoticeSeen) {
      setShowAiNotice(true);
      return;
    }
    doSend();
  }

  function resolveAiNotice(optOut: boolean) {
    setShowAiNotice(false);
    onAiNoticeResolved(optOut);
    doSend();
  }

  return (
    <div
      className="relative border-t border-black/10 bg-[var(--background)] p-3 dark:border-white/10"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragActive && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-t-2xl border-2 border-dashed border-[var(--wl-accent-dim)] bg-[var(--background)]/90">
          <span className="text-sm font-medium text-[var(--wl-accent-dim)]">Drop image to attach</span>
        </div>
      )}

      {replyTo && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-black/[0.04] px-3 py-1.5 text-xs dark:bg-white/[0.06]">
          <span className="truncate text-black/60 dark:text-white/60">
            Replying to <span className="font-medium">{replyTo.owner_name}</span> — {replyTo.body}
          </span>
          <button
            onClick={onCancelReply}
            aria-label="Cancel reply"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-black/50 hover:bg-black/5 hover:text-black/70 dark:text-white/50 dark:hover:bg-white/10 dark:hover:text-white/70"
          >
            ✕
          </button>
        </div>
      )}

      {pendingImage && (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-black/[0.04] p-1.5 dark:bg-white/[0.06]">
          {pendingImage.status === "error" ? (
            <span className="px-2 text-xs text-red-500">Upload failed.</span>
          ) : (
            <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md">
              <img src={pendingImage.previewUrl} alt="" className="h-full w-full object-cover" />
              {pendingImage.status === "uploading" && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-xs text-white">
                  Uploading…
                </div>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={removeImage}
            aria-label="Remove image"
            className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-black/50 hover:bg-black/5 hover:text-black/70 dark:text-white/50 dark:hover:bg-white/10 dark:hover:text-white/70"
          >
            ✕
          </button>
        </div>
      )}

      {showGifPicker && <GifPicker onSelect={pickGif} onClose={() => setShowGifPicker(false)} />}

      {filteredMembers.length > 0 && (
        <div className="absolute bottom-full left-3 z-40 mb-1 flex w-56 flex-col overflow-hidden rounded-lg border border-black/10 bg-white shadow-lg dark:border-white/10 dark:bg-[var(--wl-surface)]">
          {filteredMembers.map((m) => (
            <button
              key={m.owner_id}
              onClick={() => selectMention(m)}
              className="flex flex-col px-3 py-1.5 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10"
            >
              <span className="font-medium">{m.display_name}</span>
              <span className="text-xs text-black/50 dark:text-white/50">{m.team_name}</span>
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="flex items-end gap-2"
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={ALLOWED_IMAGE_TYPES.join(",")}
          onChange={pickImage}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          aria-label="Add image"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xl text-black/50 hover:bg-black/5 dark:text-white/50 dark:hover:bg-white/10"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => setShowGifPicker((v) => !v)}
          aria-label="Add GIF"
          aria-pressed={showGifPicker}
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[11px] font-bold tracking-tight hover:bg-black/5 dark:hover:bg-white/10 ${
            showGifPicker ? "text-[var(--wl-accent-dim)]" : "text-black/50 dark:text-white/50"
          }`}
        >
          GIF
        </button>
        <textarea
          ref={inputRef}
          value={value}
          onChange={handleChange}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          onPaste={handlePaste}
          onFocus={() => setBottomNavHidden(true)}
          onBlur={() => setBottomNavHidden(false)}
          placeholder="Message..."
          maxLength={MAX_LENGTH}
          rows={1}
          aria-label="Message"
          className="max-h-32 min-h-[2.5rem] flex-1 resize-none rounded-2xl border border-black/10 bg-transparent px-4 py-2 text-sm outline-none focus:border-[var(--wl-accent-dim)] dark:border-white/10"
        />
        <button
          type="submit"
          disabled={!value.trim() && pendingImage?.status !== "done"}
          aria-label="Send"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--wl-accent-dim)] text-white transition-transform active:scale-90 disabled:opacity-30"
        >
          ➤
        </button>
      </form>

      {showAiNotice && (
        <AiTrainingNoticeModal onContinue={() => resolveAiNotice(false)} onOptOut={() => resolveAiNotice(true)} />
      )}
    </div>
  );
}
