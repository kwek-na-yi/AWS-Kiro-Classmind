import Link from "next/link";

import MaterialUpload from "@/components/MaterialUpload";
import ProfilePicker from "@/components/ProfilePicker";
import {
  Badge,
  Card,
  CenteredState,
  Notice,
  PageHeader,
  SectionHeading,
  type BadgeTone,
} from "@/components/ui/primitives";
import { button, colour, radius, space, type } from "@/lib/design/tokens";
import { ensureDemoData } from "@/lib/demo/bootstrap";
import { isPublicDemo } from "@/lib/demo/public";
import { uploadLimitBytes } from "@/lib/ingest/limits";
import { getMaterial, listTopics } from "@/lib/repo/material";
import { getSession } from "@/lib/repo/session";
import type { MaterialStatus, PoolStatus } from "@/lib/types";

/**
 * Learn — what this lecture covers, and how you want it explained.
 *
 * Server-rendered: the material and Topic list come straight through the
 * repository, so the page arrives in one round trip. Only the upload control
 * and the picker are Client Components, because only they need the Learner_Id
 * from local storage.
 *
 * The upload is a client component sitting beside server-rendered material
 * facts, and that is deliberate: when an upload finishes it calls
 * `router.refresh()`, which re-runs the two reads below, so the lecture name,
 * the status line and the Topic list on this page become the ones just derived
 * from the uploaded file without a full navigation.
 */

const MATERIAL_TONE: Record<MaterialStatus, BadgeTone> = {
  ready: "strong",
  processing: "attention",
  unprocessable: "weak",
};

const MATERIAL_LABEL: Record<MaterialStatus, string> = {
  ready: "Ready",
  processing: "Processing",
  unprocessable: "Could not be read",
};

const POOL_LABEL: Record<PoolStatus, string> = {
  ready: "quiz ready",
  pending: "quiz not built yet",
  unavailable: "quiz unavailable",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
export default async function LecturePage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  // The layout seeds too, but it renders in parallel with this page.
  await ensureDemoData();
  const session = await getSession(sessionId);

  if (!session) {
    return (
      <CenteredState>
        <Notice
          tone="weak"
          title="Class not found"
          action={
            <Link href="/" style={button.primary}>
              Go to join page
            </Link>
          }
        >
          This class session does not exist. Check the code and join again from the
          home page.
        </Notice>
      </CenteredState>
    );
  }

  const [material, topics] = await Promise.all([
    getMaterial(sessionId, session.materialVersion),
    listTopics(sessionId, session.materialVersion),
  ]);

  return (
    <div style={{ display: "grid", gap: space.xxl }}>
      <PageHeader
        eyebrow="Today's lecture"
        title={session.name}
        description="Set up how you want this explained, and ClassMind will write a recap grounded in your instructor's own material."
        aside={
          material ? (
            <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
              <div style={{ ...type.metric, fontSize: "24px", color: colour.primaryInk }}>
                {topics.length}
              </div>
              <div style={{ ...type.small, color: colour.muted }}>topics</div>
            </div>
          ) : undefined
        }
      />

      <section>
        <SectionHeading
          eyebrow="Source material"
          title="Your lecture material"
          description="Upload the slides or notes from this lecture. ClassMind reads them, finds the topics and builds your recap and quiz from that file — nothing else."
        />

        <div style={{ display: "grid", gap: space.lg }}>
          {material ? (
            <Card style={{ padding: space.lg }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: space.md,
                  flexWrap: "wrap",
                }}
              >
                <span style={{ ...type.cardTitle }}>{material.filename}</span>
                <Badge tone={MATERIAL_TONE[material.status]}>
                  {MATERIAL_LABEL[material.status]}
                </Badge>
                <Badge>{POOL_LABEL[material.poolStatus]}</Badge>
              </div>

              <p
                style={{
                  ...type.small,
                  color: colour.muted,
                  margin: `${space.sm} 0 0`,
                }}
              >
                {material.ext.toUpperCase()} · {formatBytes(material.bytes)} ·{" "}
                {material.charCount.toLocaleString()} characters ·{" "}
                {material.unitCount} source units · {topics.length} topics ·
                version {material.version}
              </p>
            </Card>
          ) : (
            <Notice tone="attention" title="No lecture material yet">
              Upload a PDF, TXT or Markdown file below and this class will be
              built from it.
            </Notice>
          )}

          {isPublicDemo() && session.isDemo ? (
            <p style={{ ...type.small, color: colour.muted, margin: 0 }}>
              On the public demo this lecture is shared by every visitor, so it can&rsquo;t
              be replaced. To try your own file, join with class code{" "}
              <strong>UPLOAD</strong>.
            </p>
          ) : (
            <MaterialUpload
              sessionId={sessionId}
              hasMaterial={material !== null}
              maxBytes={uploadLimitBytes()}
            />
          )}
        </div>
      </section>

      {topics.length > 0 ? (
        <section>
          <SectionHeading
            eyebrow="Coverage"
            title="What this lecture covers"
            description={
              material
                ? `From ${material.filename} · ${material.charCount.toLocaleString()} characters of source material`
                : undefined
            }
          />

          <div
            className="cm-grid-3"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: space.md,
            }}
          >
            {topics.map((topic, index) => (
              <Card key={topic.topicId} style={{ padding: space.lg }}>
                <div
                  style={{ display: "flex", gap: space.md, alignItems: "flex-start" }}
                >
                  <span
                    aria-hidden
                    style={{
                      ...type.small,
                      fontWeight: 680,
                      color: colour.primaryInk,
                      background: colour.primarySoft,
                      border: `1px solid ${colour.primaryBorder}`,
                      borderRadius: radius.sm,
                      minWidth: "26px",
                      height: "26px",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {index + 1}
                  </span>
                  <span style={{ ...type.cardTitle, paddingTop: "3px" }}>
                    {topic.name}
                  </span>
                </div>
              </Card>
            ))}
          </div>
        </section>
      ) : (
        <Notice tone="attention" title="No topics yet">
          Topics appear once lecture material has been processed. Upload the
          file for this lecture above and they will be listed here.
        </Notice>
      )}

      <section>
        <SectionHeading
          eyebrow="Personalise"
          title="How should this lecture be taught to you?"
          description="You can change either answer at any time — every version stays grounded in the same source material."
        />

        <ProfilePicker sessionId={sessionId} />
      </section>
    </div>
  );
}
