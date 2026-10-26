"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/primitives";
import { card, colour, radius, space, type } from "@/lib/design/tokens";
import type { SourceRef } from "@/lib/types";

/**
 * One idea from the lecture, as a card that opens.
 *
 * Collapsed by default so the recap reads as a list of the ideas in this
 * lecture rather than a wall of prose. A Topic the Learner got wrong last time
 * is marked and opened, so the thing most worth rereading is visible before
 * anything is clicked.
 */

export interface RecapArtefactView {
  kind: "none" | "table" | "pipeline" | "mermaid";
  content: string;
  prose: string;
}

export interface RecapSectionView {
  topicId: string;
  topicName: string;
  body: string;
  sourceRefs: SourceRef[];
  unverified: boolean;
  uncovered: boolean;
  artefact: RecapArtefactView | null;
  styleWarning: string | null;
}

/**
 * The structured artefact.
 *
 * A Mermaid diagram is shown as its source beside the prose form rather than
 * rendered — there is no diagram renderer in this build, and the prose form
 * carries the same content, which is why it is always persisted.
 */
function Artefact({ artefact }: { artefact: RecapArtefactView }) {
  if (artefact.kind === "none") return null;

  return (
    <div style={{ marginTop: space.lg }}>
      <pre
        style={{
          ...type.small,
          margin: 0,
          padding: space.lg,
          background: colour.canvas,
          border: `1px solid ${colour.border}`,
          borderRadius: radius.md,
          overflowX: "auto",
          whiteSpace: "pre",
        }}
      >
        {artefact.content}
      </pre>

      <details style={{ marginTop: space.md }}>
        <summary style={{ ...type.small, color: colour.muted, cursor: "pointer" }}>
          Read this as prose
        </summary>
        <p style={{ ...type.body, margin: `${space.md} 0 0` }}>{artefact.prose}</p>
      </details>
    </div>
  );
}

export default function RecapSectionPanel({
  section,
  index,
  defaultOpen,
  needsAttention,
}: {
  section: RecapSectionView;
  index: number;
  defaultOpen?: boolean;
  needsAttention?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);

  return (
    <section
      id={`topic-${section.topicId}`}
      style={{
        ...card,
        padding: 0,
        overflow: "hidden",
        borderColor: needsAttention ? colour.attentionBorder : colour.border,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: space.lg,
          padding: space.xl,
          background: "none",
          border: 0,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span
          style={{ display: "flex", alignItems: "baseline", gap: space.md, minWidth: 0 }}
        >
          <span aria-hidden style={{ ...type.label, color: colour.subtle }}>
            {String(index + 1).padStart(2, "0")}
          </span>
          <span style={{ ...type.sectionTitle }}>{section.topicName}</span>
        </span>

        <span style={{ display: "flex", alignItems: "center", gap: space.sm }}>
          {needsAttention ? <Badge tone="attention">Review this</Badge> : null}
          {section.uncovered ? <Badge tone="attention">Not in this material</Badge> : null}
          {section.unverified && !section.uncovered ? (
            <Badge tone="attention">Unverified</Badge>
          ) : null}
          {section.sourceRefs.length > 0 ? (
            <Badge>{section.sourceRefs.map((ref) => ref.value).join(" · ")}</Badge>
          ) : null}
          <span
            aria-hidden
            style={{ ...type.sectionTitle, color: colour.subtle, fontWeight: 400 }}
          >
            {open ? "−" : "+"}
          </span>
        </span>
      </button>

      {open ? (
        <div style={{ padding: `0 ${space.xl} ${space.xl}` }}>
          <p
            style={{
              ...type.body,
              margin: 0,
              whiteSpace: "pre-wrap",
              maxWidth: "74ch",
            }}
          >
            {section.body}
          </p>

          {section.artefact ? <Artefact artefact={section.artefact} /> : null}

          {section.styleWarning ? (
            <p style={{ ...type.small, color: colour.subtle, margin: `${space.lg} 0 0` }}>
              {section.styleWarning}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
