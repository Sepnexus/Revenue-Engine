import { BG, S1, S2, B1, B2, TEXT, T2, T3, RED, G } from "@/shared/kpi";

/**
 * Full-page loading state — shows a subtle pulsing indicator instead of a blank screen.
 */
export function PageLoading({ message = "Loading..." }: { message?: string }) {
  return (
    <div style={{ minHeight: "100vh", background: BG, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 16 }}>
          {[0, 1, 2].map(i => (
            <div
              key={i}
              style={{
                width: 8, height: 8, borderRadius: "50%", background: G,
                animation: `bounce 1.1s ease-in-out ${i * 0.18}s infinite`,
              }}
            />
          ))}
        </div>
        <div style={{ fontSize: 14, color: T3 }}>{message}</div>
      </div>
    </div>
  );
}

/**
 * Full-page error state with retry button.
 */
export function PageError({ message = "Data could not load.", onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div style={{ minHeight: "100vh", background: BG, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ textAlign: "center", maxWidth: 400 }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
        <div style={{ fontSize: 16, fontWeight: 600, color: TEXT, marginBottom: 8 }}>{message}</div>
        <div style={{ fontSize: 13, color: T3, marginBottom: 20 }}>
          This might be a temporary network issue. Please try again.
        </div>
        {onRetry && (
          <button
            onClick={onRetry}
            style={{
              background: G, border: "none", borderRadius: 9,
              padding: "12px 28px", color: "#000", fontWeight: 700,
              fontSize: 14, cursor: "pointer", fontFamily: "inherit",
            }}
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Inline error banner — use within a page section that failed to load.
 */
export function InlineError({ message = "Failed to load.", onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div style={{
      background: RED + "08", border: "1px solid " + RED + "25",
      borderRadius: 12, padding: "18px 22px",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      gap: 16,
    }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: RED, marginBottom: 4 }}>⚠️ {message}</div>
        <div style={{ fontSize: 12, color: T3 }}>Check your connection or try again.</div>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          style={{
            background: RED + "15", border: "1px solid " + RED + "35",
            borderRadius: 8, padding: "8px 16px", color: RED,
            fontWeight: 600, fontSize: 12, cursor: "pointer",
            fontFamily: "inherit", whiteSpace: "nowrap",
          }}
        >
          Retry
        </button>
      )}
    </div>
  );
}

/**
 * Inline loading skeleton — use within page sections.
 */
export function InlineLoading({ message = "Loading..." }: { message?: string }) {
  return (
    <div style={{
      background: S1, border: "1px solid " + B1, borderRadius: 12,
      padding: "24px", textAlign: "center",
    }}>
      <div style={{ fontSize: 13, color: T3 }}>{message}</div>
    </div>
  );
}
