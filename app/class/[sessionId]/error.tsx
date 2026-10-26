"use client";

import { button, card, colour, space, type } from "@/lib/design/tokens";

/**
 * The error boundary for the four views.
 *
 * Next nests this inside `layout.tsx` of the same segment, so a failing view
 * replaces only the content beside the sidebar — every other destination stays
 * reachable while one view is broken.
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
        ...card,
        background: colour.weakSoft,
        borderColor: colour.weakBorder,
      }}
    >
      <h1 style={{ ...type.sectionTitle, color: colour.weakInk, margin: 0 }}>
        This view could not be loaded
      </h1>

      <p
        style={{
          ...type.body,
          color: colour.muted,
          margin: `${space.sm} 0 ${space.xl}`,
          maxWidth: "60ch",
        }}
      >
        {error.message || "Something went wrong."} The other views are still available
        from the sidebar.
      </p>

      <button type="button" onClick={reset} style={button.secondary}>
        Try again
      </button>
    </section>
  );
}
