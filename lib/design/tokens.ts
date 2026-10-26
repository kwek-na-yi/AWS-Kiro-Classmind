/**
 * The ClassMind design system.
 *
 * One palette, one type scale, one card. Every colour a component uses comes
 * from here, so the product can be recoloured in one file and reads as one
 * thing on stage.
 *
 * The palette is deliberately semantic rather than decorative: teal means a
 * Learner is strong, yellow means developing or worth watching, and the warning
 * red is reserved for genuine weakness. Meaning is never carried by colour
 * alone — every state also carries a text label.
 */

/** The brand palette. */
const brand = {
  blue: "#7497DF",
  blueSoft: "#E3EAF8",
  teal: "#41C8C2",
  yellow: "#FCBD20",
  pink: "#F8C6D1",
} as const;

export const colour = {
  // Brand
  primary: brand.blue,
  primarySoft: brand.blueSoft,
  /** Darkened for text and small icons, where #7497DF alone is too light. */
  primaryInk: "#3A5FA8",
  primaryBorder: "#B9CBEE",

  // Neutrals
  text: "#1F2937",
  muted: "#667085",
  subtle: "#98A2B3",
  border: "#E6EAF0",
  borderStrong: "#D3DAE6",
  surface: "#FFFFFF",
  canvas: "#F7F9FC",
  raised: "#F1F4F9",

  // Semantic — strong / verified / positive
  strong: brand.teal,
  strongInk: "#127D78",
  strongSoft: "#E6F9F8",
  strongBorder: "#A9E9E6",

  // Semantic — developing / attention / watch-for
  attention: brand.yellow,
  attentionInk: "#8A6100",
  attentionSoft: "#FFF7E3",
  attentionBorder: "#FBE1A2",

  // Semantic — learner focus / supporting highlight
  focus: brand.pink,
  focusInk: "#A33F5C",
  focusSoft: "#FDEEF2",
  focusBorder: "#F4CFD9",

  // Semantic — needs attention. Restrained by intent.
  weak: "#D1495B",
  weakInk: "#A03242",
  weakSoft: "#FDF0F2",
  weakBorder: "#F3CBD1",
} as const;

export const type = {
  hero: { fontSize: "38px", lineHeight: 1.15, fontWeight: 700, letterSpacing: "-0.022em" },
  pageTitle: { fontSize: "26px", lineHeight: 1.25, fontWeight: 680, letterSpacing: "-0.015em" },
  sectionTitle: { fontSize: "17px", lineHeight: 1.35, fontWeight: 640 },
  cardTitle: { fontSize: "15px", lineHeight: 1.4, fontWeight: 620 },
  body: { fontSize: "14.5px", lineHeight: 1.6, fontWeight: 400 },
  small: { fontSize: "13px", lineHeight: 1.5, fontWeight: 400 },
  label: {
    fontSize: "11px",
    lineHeight: 1.4,
    fontWeight: 650,
    letterSpacing: "0.07em",
    textTransform: "uppercase" as const,
  },
  metric: { fontSize: "30px", lineHeight: 1, fontWeight: 700, letterSpacing: "-0.02em" },
} as const;

export const space = {
  xs: "4px",
  sm: "8px",
  md: "12px",
  lg: "16px",
  xl: "24px",
  xxl: "32px",
  xxxl: "48px",
} as const;

export const radius = { sm: "6px", md: "10px", lg: "14px", pill: "999px" } as const;

/** Restrained elevation: depth separates layers, it does not decorate. */
export const shadow = {
  card: "0 1px 2px rgba(31, 41, 55, 0.04), 0 1px 3px rgba(31, 41, 55, 0.03)",
  raised: "0 4px 12px rgba(31, 41, 55, 0.07)",
  focus: `0 0 0 3px ${colour.primarySoft}`,
} as const;

/** The one card used everywhere. */
export const card = {
  background: colour.surface,
  border: `1px solid ${colour.border}`,
  borderRadius: radius.lg,
  padding: space.xl,
  boxShadow: shadow.card,
} as const;

export const button = {
  primary: {
    background: colour.primary,
    color: "#FFFFFF",
    border: `1px solid ${colour.primary}`,
    borderRadius: radius.md,
    padding: "11px 20px",
    fontSize: "14.5px",
    fontWeight: 620,
    cursor: "pointer",
    display: "inline-block",
    textDecoration: "none",
  },
  secondary: {
    background: colour.surface,
    color: colour.text,
    border: `1px solid ${colour.borderStrong}`,
    borderRadius: radius.md,
    padding: "11px 20px",
    fontSize: "14.5px",
    fontWeight: 560,
    cursor: "pointer",
    display: "inline-block",
    textDecoration: "none",
  },
  quiet: {
    background: "transparent",
    color: colour.muted,
    border: 0,
    padding: `${space.sm} 0`,
    fontSize: "14px",
    fontWeight: 520,
    cursor: "pointer",
  },
} as const;

/** The small uppercase label above a heading. */
export const eyebrow = {
  ...type.label,
  color: colour.subtle,
  display: "block",
  marginBottom: space.sm,
} as const;

/** Layout constants shared by the shell. */
export const layout = {
  sidebarWidth: "232px",
  contentMax: "1080px",
} as const;

// ---------------------------------------------------------------------------
// Semantic bands
// ---------------------------------------------------------------------------

export type MasteryBand = "strong" | "developing" | "needs-attention";

export interface Tone {
  band: MasteryBand;
  /** Fill colour for bars and dots. */
  colour: string;
  /** Darkened variant, safe for text on the soft background. */
  ink: string;
  soft: string;
  border: string;
  label: string;
}

export const TONES: Record<MasteryBand, Tone> = {
  strong: {
    band: "strong",
    colour: colour.strong,
    ink: colour.strongInk,
    soft: colour.strongSoft,
    border: colour.strongBorder,
    label: "Strong",
  },
  developing: {
    band: "developing",
    colour: colour.attention,
    ink: colour.attentionInk,
    soft: colour.attentionSoft,
    border: colour.attentionBorder,
    label: "Developing",
  },
  "needs-attention": {
    band: "needs-attention",
    colour: colour.weak,
    ink: colour.weakInk,
    soft: colour.weakSoft,
    border: colour.weakBorder,
    label: "Needs attention",
  },
};

/**
 * The band a mastery percentage falls in. The thresholds match the ones the
 * domain layer already uses, so a Learner's badge and the class map agree.
 */
export function masteryTone(value: number): Tone {
  if (value >= 75) return TONES.strong;
  if (value >= 60) return TONES.developing;
  return TONES["needs-attention"];
}
