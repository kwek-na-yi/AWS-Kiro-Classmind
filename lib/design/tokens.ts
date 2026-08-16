/**
 * One typographic scale and one palette, shared by every view.
 *
 * Values live here rather than in each component so the interface reads as one
 * product on stage. Meaning is never carried by colour alone: every band and
 * status renders its text label too.
 */

export const colour = {
  text: "#111827",
  muted: "#6b7280",
  subtle: "#9ca3af",
  border: "#e5e7eb",
  surface: "#ffffff",
  canvas: "#f9fafb",
  accent: "#1d4ed8",
  accentSoft: "#eff6ff",
  positive: "#047857",
  positiveSoft: "#ecfdf5",
  negative: "#b91c1c",
  negativeSoft: "#fef2f2",
  warning: "#b45309",
  warningSoft: "#fffbeb",
} as const;

export const type = {
  display: { fontSize: "28px", lineHeight: 1.25, fontWeight: 650 },
  title: { fontSize: "20px", lineHeight: 1.3, fontWeight: 600 },
  heading: { fontSize: "16px", lineHeight: 1.4, fontWeight: 600 },
  body: { fontSize: "15px", lineHeight: 1.6, fontWeight: 400 },
  small: { fontSize: "13px", lineHeight: 1.5, fontWeight: 400 },
} as const;

export const space = {
  xs: "4px",
  sm: "8px",
  md: "16px",
  lg: "24px",
  xl: "32px",
} as const;

export const radius = { sm: "6px", md: "10px", lg: "14px" } as const;

/** The standard panel: white card on the canvas. */
export const panel = {
  background: colour.surface,
  border: `1px solid ${colour.border}`,
  borderRadius: radius.md,
  padding: space.lg,
} as const;

export const button = {
  primary: {
    background: colour.accent,
    color: "#ffffff",
    border: `1px solid ${colour.accent}`,
    borderRadius: radius.sm,
    padding: "10px 16px",
    fontSize: "15px",
    fontWeight: 600,
    cursor: "pointer",
  },
  secondary: {
    background: colour.surface,
    color: colour.text,
    border: `1px solid ${colour.border}`,
    borderRadius: radius.sm,
    padding: "10px 16px",
    fontSize: "15px",
    fontWeight: 500,
    cursor: "pointer",
  },
} as const;
