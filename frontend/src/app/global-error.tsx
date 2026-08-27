"use client"; // Error boundaries must be Client Components (App Router requirement)

// Last resort — only fires if the ROOT LAYOUT itself throws (error.tsx
// handles everything else). Per Next.js's own docs, global-error
// replaces the entire root layout when active and does NOT reliably
// have access to globals.css/CSS custom properties, so this is
// deliberately self-contained with inline styles rather than reusing
// --wl-accent/.neon-panel etc. Extremely unlikely to ever render in
// practice (this app's root layout is minimal), but the alternative
// (Next's bare unstyled 500 page) is worse than a simple on-brand
// fallback with no dependencies.
export default function GlobalError({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1rem",
          padding: "1rem",
          textAlign: "center",
          background: "#23212c",
          color: "#f5f4ec",
          fontFamily: "Arial, Helvetica, sans-serif",
        }}
      >
        <p style={{ fontSize: "0.875rem", fontWeight: 600, letterSpacing: "0.1em", color: "#39ff14", textTransform: "uppercase" }}>
          Error
        </p>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 600, margin: 0 }}>Weekend League hit a snag</h1>
        <p style={{ maxWidth: 384, fontSize: "0.875rem", color: "rgba(245,244,236,0.6)" }}>
          Something went wrong loading the app. Try again in a moment.
        </p>
        <button
          onClick={() => retry()}
          style={{
            marginTop: "0.5rem",
            borderRadius: 9999,
            background: "#1f890b",
            color: "#fff",
            border: "none",
            padding: "0.5rem 1.25rem",
            fontSize: "0.875rem",
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
