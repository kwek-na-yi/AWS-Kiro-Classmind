"use client";

/**
 * The error boundary for the four views.
 *
 * Next.js nests this boundary *inside* `layout.tsx` of the same segment, so a
 * failing view renders this panel while the four navigation tabs above it stay
 * present and operable — navigation to any other view remains available while a
 * single view shows an error (Requirement 18.6).
 */
export default function ClassViewError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section
      role="alert"
      style={{
        border: "1px solid #fecaca",
        background: "#fef2f2",
        borderRadius: "8px",
        padding: "16px",
      }}
    >
      <h2 style={{ margin: "0 0 8px", fontSize: "16px" }}>
        This view could not be loaded
      </h2>
      <p style={{ margin: "0 0 12px", color: "#374151" }}>
        {error.message || "Something went wrong."} The other views are still
        available from the tabs above.
      </p>
      <button
        type="button"
        onClick={reset}
        style={{
          padding: "8px 12px",
          border: "1px solid #d1d5db",
          borderRadius: "6px",
          background: "#ffffff",
          cursor: "pointer",
        }}
      >
        Try again
      </button>
    </section>
  );
}
