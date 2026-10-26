import type { CSSProperties, ReactNode } from "react";

import {
  card,
  colour,
  eyebrow as eyebrowStyle,
  masteryTone,
  radius,
  space,
  type,
  type Tone,
} from "@/lib/design/tokens";

/**
 * Shared UI primitives.
 *
 * Every repeated visual pattern lives here — the card, the badge, the bar, the
 * page header — so a component never re-implements one and never hardcodes a
 * colour. These are all plain server-renderable components: none holds state.
 */

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

export function Card({
  children,
  style,
  tone,
  id,
}: {
  children: ReactNode;
  style?: CSSProperties;
  /** Tints the border and background for a semantic card. */
  tone?: Tone;
  id?: string;
}) {
  return (
    <div
      id={id}
      style={{
        ...card,
        ...(tone ? { background: tone.soft, borderColor: tone.border } : {}),
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** A section heading with its uppercase eyebrow. */
export function SectionHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-end",
        gap: space.lg,
        marginBottom: space.lg,
      }}
    >
      <div>
        {eyebrow ? <span style={eyebrowStyle}>{eyebrow}</span> : null}
        <h2 style={{ ...type.sectionTitle, margin: 0 }}>{title}</h2>
        {description ? (
          <p style={{ ...type.small, color: colour.muted, margin: `${space.xs} 0 0` }}>
            {description}
          </p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

/** The title block at the top of a page. */
export function PageHeader({
  eyebrow,
  title,
  description,
  aside,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  aside?: ReactNode;
}) {
  return (
    <header
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: space.xl,
        marginBottom: space.xl,
      }}
    >
      <div style={{ minWidth: 0 }}>
        {eyebrow ? <span style={eyebrowStyle}>{eyebrow}</span> : null}
        <h1 style={{ ...type.pageTitle, margin: 0 }}>{title}</h1>
        {description ? (
          <p
            style={{
              ...type.body,
              color: colour.muted,
              margin: `${space.sm} 0 0`,
              maxWidth: "62ch",
            }}
          >
            {description}
          </p>
        ) : null}
      </div>
      {aside}
    </header>
  );
}

// ---------------------------------------------------------------------------
// Indicators
// ---------------------------------------------------------------------------

export type BadgeTone = "neutral" | "primary" | "strong" | "attention" | "weak" | "focus";

const BADGE_PALETTE: Record<BadgeTone, { bg: string; fg: string; border: string }> = {
  neutral: { bg: colour.raised, fg: colour.muted, border: colour.border },
  primary: { bg: colour.primarySoft, fg: colour.primaryInk, border: colour.primaryBorder },
  strong: { bg: colour.strongSoft, fg: colour.strongInk, border: colour.strongBorder },
  attention: { bg: colour.attentionSoft, fg: colour.attentionInk, border: colour.attentionBorder },
  weak: { bg: colour.weakSoft, fg: colour.weakInk, border: colour.weakBorder },
  focus: { bg: colour.focusSoft, fg: colour.focusInk, border: colour.focusBorder },
};

export function Badge({
  children,
  tone = "neutral",
  style,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  style?: CSSProperties;
}) {
  const palette = BADGE_PALETTE[tone];

  return (
    <span
      style={{
        ...type.small,
        fontWeight: 580,
        background: palette.bg,
        color: palette.fg,
        border: `1px solid ${palette.border}`,
        borderRadius: radius.pill,
        padding: `2px ${space.md}`,
        whiteSpace: "nowrap",
        display: "inline-block",
        ...style,
      }}
    >
      {children}
    </span>
  );
}

/** A horizontal mastery bar. Always paired with its number and label. */
export function MasteryBar({
  value,
  tone,
  height = 8,
}: {
  value: number;
  tone?: Tone;
  height?: number;
}) {
  const resolved = tone ?? masteryTone(value);

  return (
    <div
      role="img"
      aria-label={`${value} percent, ${resolved.label}`}
      style={{
        height: `${height}px`,
        background: colour.raised,
        borderRadius: radius.pill,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${Math.max(Math.min(value, 100), 2)}%`,
          height: "100%",
          background: resolved.colour,
          borderRadius: radius.pill,
        }}
      />
    </div>
  );
}

/** One row of the topic-mastery list, shared by results and the class map. */
export function MasteryRow({
  label,
  value,
  note,
  href,
}: {
  label: string;
  value: number;
  note?: string;
  href?: string;
}) {
  const tone = masteryTone(value);

  const title = href ? (
    <a href={href} style={{ ...type.body, color: colour.text, textDecoration: "none" }}>
      {label}
    </a>
  ) : (
    <span style={{ ...type.body }}>{label}</span>
  );

  return (
    <div style={{ display: "grid", gap: space.sm }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: space.lg,
        }}
      >
        <span style={{ display: "flex", alignItems: "baseline", gap: space.sm, minWidth: 0 }}>
          {title}
          {note ? (
            <span style={{ ...type.small, color: colour.subtle }}>{note}</span>
          ) : null}
        </span>

        <span
          style={{ display: "flex", alignItems: "baseline", gap: space.sm, whiteSpace: "nowrap" }}
        >
          <span style={{ ...type.body, fontWeight: 660, color: tone.ink }}>{value}%</span>
          <span style={{ ...type.small, color: colour.muted }}>{tone.label}</span>
        </span>
      </div>

      <MasteryBar value={value} tone={tone} />
    </div>
  );
}

/** Step progress across a fixed-length sequence. */
export function StepProgress({ current, total }: { current: number; total: number }) {
  return (
    <div aria-hidden style={{ display: "flex", gap: space.xs }}>
      {Array.from({ length: total }, (_, index) => (
        <span
          key={index}
          style={{
            flex: 1,
            height: "4px",
            borderRadius: radius.pill,
            background: index < current ? colour.primary : colour.border,
          }}
        />
      ))}
    </div>
  );
}

/** A numbered marker, used for takeaways and ordered lists. */
export function NumberChip({
  value,
  tone = "primary",
}: {
  value: number | string;
  tone?: BadgeTone;
}) {
  const palette = BADGE_PALETTE[tone];

  return (
    <span
      aria-hidden
      style={{
        ...type.small,
        fontWeight: 680,
        minWidth: "26px",
        height: "26px",
        borderRadius: radius.pill,
        background: palette.bg,
        color: palette.fg,
        border: `1px solid ${palette.border}`,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {value}
    </span>
  );
}

/**
 * The wait before a view has its data.
 *
 * Every asynchronous view uses this one, so the product waits the same way
 * everywhere. It says what it is doing and holds the shape the content will
 * take, rather than leaving a sentence stranded at the top of an empty page —
 * on AWS these reads take a second or more, and a bare line of grey text for
 * that long reads as a page that failed.
 */
export function Loading({
  label,
  lines = 3,
}: {
  label: string;
  lines?: number;
}) {
  return (
    <div role="status" aria-live="polite" style={{ display: "grid", gap: space.lg }}>
      <p
        style={{
          ...type.body,
          color: colour.muted,
          margin: 0,
          display: "flex",
          alignItems: "center",
          gap: space.md,
        }}
      >
        <span
          aria-hidden
          style={{
            width: "14px",
            height: "14px",
            borderRadius: radius.pill,
            border: `2px solid ${colour.primaryBorder}`,
            borderTopColor: colour.primary,
            animation: "cm-spin 700ms linear infinite",
            display: "inline-block",
            flexShrink: 0,
          }}
        />
        {label}
      </p>

      <div style={{ ...card, display: "grid", gap: space.md }}>
        {Array.from({ length: lines }, (_, index) => (
          <span
            key={index}
            aria-hidden
            className="cm-skeleton"
            style={{
              height: index === 0 ? "18px" : "12px",
              width: index === 0 ? "42%" : index === lines - 1 ? "68%" : "100%",
              borderRadius: radius.sm,
              background: colour.raised,
              display: "block",
            }}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * A state that occupies the view rather than sitting at the top of an empty one.
 *
 * Used when a whole screen resolves to a single message — no profile yet, no
 * quiz taken yet, a topic that failed to load. Centring it is what stops the
 * screen reading as a page whose content is missing.
 */
export function CenteredState({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        minHeight: "60vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{ width: "100%", maxWidth: "540px" }}>{children}</div>
    </div>
  );
}

/** An empty or unavailable state, stated plainly. */
export function Notice({
  tone = "neutral",
  title,
  children,
  action,
}: {
  tone?: BadgeTone;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const palette = BADGE_PALETTE[tone];

  return (
    <div
      role="status"
      style={{
        ...card,
        background: palette.bg,
        borderColor: palette.border,
      }}
    >
      <h2 style={{ ...type.cardTitle, color: palette.fg, margin: 0 }}>{title}</h2>
      {children ? (
        <div style={{ ...type.body, color: colour.muted, marginTop: space.sm }}>{children}</div>
      ) : null}
      {action ? <div style={{ marginTop: space.lg }}>{action}</div> : null}
    </div>
  );
}
