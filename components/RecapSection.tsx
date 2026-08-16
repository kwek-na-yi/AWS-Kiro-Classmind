"use client";

import { useState } from "react";

import { colour, radius, space, type } from "@/lib/design/tokens";
import type { SourceRef } from "@/lib/types";

/**
 * One Recap_Section: a collapsible panel headed by the Topic name, showing its
 * Source_References and, where the style produced one, a structured artefact
 * with its prose alternative.
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

function Badge({ tone, children }: { tone: "warning" | "muted"; children: string }) {
  const palette =
    tone === "warning"
      ? { background: colour.warningSoft, color: colour.warning }
      : { background: colour.canvas, color: colour.muted };

  return (
    <span
      style={{
        ...type.small,
        ...palette,
        padding: `2px ${space.sm}`,
        borderRadius: radius.sm,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

/**
 * Renders the structured artefact.
 *
 * A Mermaid diagram is shown as its source text beside the prose form rather
 * than rendered — there is no diagram renderer in this build, and the prose form
 * carries the same content, which is exactly why it is always persisted.
 */
function Artefact({ artefact }: { artefact: RecapArtefactView }) {
  if (artefact.kind === "none") return null;

  return (
    <div style={{ marginTop: space.md }}>
      <pre
        style={{
          ...type.small,
          margin: 0,
          padding: space.md,
          background: colour.canvas,
          border: `1px solid ${colour.border}`,
          borderRadius: radius.sm,
          overflowX: "auto",
          whiteSpace: "pre",
        }}
      >
        {artefact.content}
      </pre>

      <details style={{ marginTop: space.sm }}>
        <summary style={{ ...type.small, color: colour.muted, cursor: "pointer" }}>
          Read this as prose
        </summary>
        <p style={{ ...type.body, margin: `${space.sm} 0 0` }}>{artefact.prose}</p>
      </details>
    </div>
  );
}

export default function RecapSectionPanel({
  section,
  defaultOpen,
}: {
  section: RecapSectionView;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? true);

  return (
    <section
      id={`topic-${section.topicId}`}
      style={{
        background: colour.surface,
        border: `1px solid ${colour.border}`,
        borderRadius: radius.md,
        overflow: "hidden",
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
          gap: space.md,
          padding: space.md,
          background: "none",
          border: 0,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span style={{ ...type.heading }}>{section.topicName}</span>

        <span style={{ display: "flex", alignItems: "center", gap: space.sm }}>
          {section.uncovered ? <Badge tone="warning">Not in this material</Badge> : null}
          {section.unverified && !section.uncovered ? (
            <Badge tone="warning">Unverified</Badge>
          ) : null}
          {section.sourceRefs.length > 0 ? (
            <Badge tone="muted">
              {section.sourceRefs.map((ref) => ref.value).join(" · ")}
            </Badge>
          ) : null}
          <span aria-hidden style={{ color: colour.subtle }}>{open ? "−" : "+"}</span>
        </span>
      </button>

      {open ? (
        <div style={{ padding: `0 ${space.md} ${space.md}` }}>
          <p style={{ ...type.body, margin: 0, whiteSpace: "pre-wrap" }}>{section.body}</p>

          {section.artefact ? <Artefact artefact={section.artefact} /> : null}

          {section.styleWarning ? (
            <p style={{ ...type.small, color: colour.muted, marginBottom: 0 }}>
              {section.styleWarning}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
