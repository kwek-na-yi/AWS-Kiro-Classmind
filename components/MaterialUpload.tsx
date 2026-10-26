"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { Badge, Card } from "@/components/ui/primitives";
import {
  forgetLearner,
  LEARNER_HEADER,
  recoverLearner,
  useLearnerId,
} from "@/hooks/useLearnerId";
import { MATERIAL_MAX_BYTES } from "@/lib/domain/validate-input";
import { button, colour, radius, space, type } from "@/lib/design/tokens";
import { MATERIAL_EXTENSIONS } from "@/lib/types";

/**
 * Upload your own lecture material.
 *
 * The Learner drops a file or picks one, and the same request stores it,
 * extracts it, derives the Topics and builds the Quiz_Pool — so by the time
 * this component reports "ready", the Recap and the Quiz are already grounded
 * in the file that was just uploaded.
 *
 * The four working states are real rather than staged. `XMLHttpRequest` is used
 * in place of `fetch` for exactly one reason: it reports when the *body* has
 * finished being sent, which is the moment the upload becomes server-side
 * processing. With `fetch` there is no way to tell those two apart, and a
 * progress bar that guesses is worse than none — a 20 MB PDF over a conference
 * network spends most of its time in the first state and all of the visible
 * work in the second.
 */

type Phase = "idle" | "uploading" | "processing" | "ready" | "error";

/** The `accept` attribute and the client-side check, from one list. */
const ACCEPT = MATERIAL_EXTENSIONS.map((ext) => `.${ext}`).join(",");

interface UploadedMaterial {
  materialVersion: number;
  filename: string;
  charCount: number;
  unitCount: number;
  storage: "s3" | "local" | "database";
  poolStatus: string;
  quizReady: boolean;
  topics: { topicId: string; name: string }[];
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(dot + 1).toLowerCase() : "";
}

/** The error code of a failed response envelope, if it carries one. */
function codeOf(body: Record<string, unknown>): string | undefined {
  return (body as { error?: { code?: string } }).error?.code;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Sends the file and resolves with the handler's JSON.
 *
 * `onSent` fires when the last byte of the body has left, which is what moves
 * the view from "uploading" to "processing".
 */
function postFile(
  url: string,
  file: File,
  learnerId: string,
  handlers: { onProgress: (percent: number) => void; onSent: () => void },
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);

    const request = new XMLHttpRequest();
    request.open("POST", url);

    // Only the learner header: the browser sets the multipart content type,
    // boundary and all, and overriding it would make the body unparseable.
    request.setRequestHeader(LEARNER_HEADER, learnerId);

    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        handlers.onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    request.upload.onload = () => handlers.onSent();

    request.onload = () => {
      try {
        resolve({
          status: request.status,
          body: JSON.parse(request.responseText) as Record<string, unknown>,
        });
      } catch {
        reject(new Error("The server sent a response that could not be read."));
      }
    };
    request.onerror = () => reject(new Error("Could not reach ClassMind."));
    request.onabort = () => reject(new Error("The upload was cancelled."));

    request.send(form);
  });
}

export default function MaterialUpload({
  sessionId,
  hasMaterial,
  maxBytes = MATERIAL_MAX_BYTES,
}: {
  sessionId: string;
  /** Changes the wording between a first upload and a replacement. */
  hasMaterial: boolean;
  /** The deployment's ceiling, which is lower on a serverless host. */
  maxBytes?: number;
}) {
  const router = useRouter();
  const { learnerId, ready } = useLearnerId(sessionId);
  const inputId = useId();

  const [phase, setPhase] = useState<Phase>("idle");
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<UploadedMaterial | null>(null);

  const busy = phase === "uploading" || phase === "processing";

  async function upload(file: File) {
    if (busy) return;

    if (!learnerId) {
      setPhase("error");
      setError("Join the class from the home page before uploading material.");
      return;
    }

    // Both checks the server enforces, run here too so an obvious mistake is
    // answered instantly instead of after a 20 MB round trip. The server never
    // trusts this: it re-runs the same validators on what it received.
    const ext = extensionOf(file.name);
    if (!(MATERIAL_EXTENSIONS as readonly string[]).includes(ext)) {
      setPhase("error");
      setError(`Accepted file types are: ${MATERIAL_EXTENSIONS.join(", ")}.`);
      return;
    }

    if (file.size === 0 || file.size > maxBytes) {
      setPhase("error");
      setError(
        `File size must be between 1 byte and ${formatBytes(maxBytes)}.`,
      );
      return;
    }

    setPhase("uploading");
    setPercent(0);
    setError(null);
    setResult(null);

    const handlers = {
      onProgress: setPercent,
      onSent: () => setPhase("processing"),
    };

    try {
      let response = await postFile(
        `/api/sessions/${sessionId}/material`,
        file,
        learnerId,
        handlers,
      );

      // A Learner_Id the class no longer contains — the demo class having been
      // reseeded under this browser, most likely. Rejoin on the stored code and
      // send the file again rather than making the upload the Learner's problem.
      if (response.status === 403 && codeOf(response.body) === "LEARNER_NOT_IN_SESSION") {
        const fresh = await recoverLearner(sessionId);

        if (!fresh) {
          forgetLearner(sessionId);
          window.location.replace("/");
          return;
        }

        setPhase("uploading");
        setPercent(0);
        response = await postFile(
          `/api/sessions/${sessionId}/material`,
          file,
          fresh,
          handlers,
        );
      }

      if (response.status !== 201) {
        const envelope = response.body as { error?: { message?: string } };
        setPhase("error");
        setError(envelope.error?.message ?? "This file could not be processed.");
        return;
      }

      setResult(response.body as unknown as UploadedMaterial);
      setPhase("ready");

      // Re-renders the server component beside this one, so the lecture name,
      // the Topic list and the material status on the page become the ones
      // just derived from this file.
      router.refresh();
    } catch (thrown) {
      setPhase("error");
      setError(
        thrown instanceof Error ? thrown.message : "Could not reach ClassMind.",
      );
    }
  }

  function onDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);

    const file = event.dataTransfer.files[0];
    if (file) void upload(file);
  }

  if (ready && !learnerId) {
    return (
      <Card>
        <p style={{ ...type.body, color: colour.muted, margin: 0 }}>
          Join the class from the home page to upload your lecture material.
        </p>
      </Card>
    );
  }

  return (
    <div style={{ display: "grid", gap: space.lg }}>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          if (!busy) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        style={{
          border: `1.5px dashed ${dragging ? colour.primary : colour.borderStrong}`,
          background: dragging ? colour.primarySoft : colour.surface,
          borderRadius: radius.lg,
          padding: space.xxl,
          textAlign: "center",
          transition: "border-color 120ms ease, background 120ms ease",
        }}
      >
        <input
          id={inputId}
          type="file"
          accept={ACCEPT}
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Cleared so choosing the same file twice fires `change` again.
            event.target.value = "";
            if (file) void upload(file);
          }}
          style={{
            position: "absolute",
            opacity: 0,
            width: "1px",
            height: "1px",
            margin: "-1px",
          }}
        />

        <p style={{ ...type.cardTitle, margin: 0 }}>
          {hasMaterial
            ? "Upload different lecture material"
            : "Upload your lecture material"}
        </p>
        <p
          style={{
            ...type.small,
            color: colour.muted,
            margin: `${space.sm} 0 ${space.lg}`,
          }}
        >
          Drag a file here, or choose one. PDF, TXT or Markdown, up to{" "}
          {formatBytes(maxBytes)}.
        </p>

        <label
          htmlFor={inputId}
          style={{
            ...button.primary,
            opacity: busy ? 0.45 : 1,
            cursor: busy ? "not-allowed" : "pointer",
          }}
        >
          Choose a file
        </label>
      </div>

      <UploadStatus
        phase={phase}
        percent={percent}
        error={error}
        result={result}
        sessionId={sessionId}
      />
    </div>
  );
}

/** The five states, each stated in words rather than by colour alone. */
function UploadStatus({
  phase,
  percent,
  error,
  result,
  sessionId,
}: {
  phase: Phase;
  percent: number;
  error: string | null;
  result: UploadedMaterial | null;
  sessionId: string;
}) {
  if (phase === "idle") {
    return (
      <p
        role="status"
        style={{ ...type.small, color: colour.subtle, margin: 0 }}
        data-upload-phase="idle"
      >
        Nothing uploaded yet in this step.
      </p>
    );
  }

  if (phase === "uploading" || phase === "processing") {
    const uploading = phase === "uploading";

    return (
      <Card style={{ padding: space.lg }} id="upload-progress">
        <div
          role="status"
          aria-live="polite"
          data-upload-phase={phase}
          style={{ display: "grid", gap: space.md }}
        >
          <span style={{ ...type.body, display: "flex", gap: space.md, alignItems: "center" }}>
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
            {uploading
              ? `Uploading your material… ${percent}%`
              : "Processing: extracting the text, finding the topics and building your quiz…"}
          </span>

          <div
            style={{
              height: "6px",
              background: colour.raised,
              borderRadius: radius.pill,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: uploading ? `${Math.max(percent, 3)}%` : "100%",
                height: "100%",
                background: colour.primary,
                borderRadius: radius.pill,
                transition: "width 160ms linear",
              }}
            />
          </div>
        </div>
      </Card>
    );
  }

  if (phase === "error") {
    return (
      <Card
        style={{
          padding: space.lg,
          background: colour.weakSoft,
          borderColor: colour.weakBorder,
        }}
      >
        <div role="alert" data-upload-phase="error">
          <strong style={{ ...type.cardTitle, color: colour.weakInk }}>
            That file could not be used
          </strong>
          <p style={{ ...type.body, color: colour.muted, margin: `${space.sm} 0 0` }}>
            {error}
          </p>
        </div>
      </Card>
    );
  }

  if (!result) return null;

  return (
    <Card
      style={{
        padding: space.lg,
        background: colour.strongSoft,
        borderColor: colour.strongBorder,
      }}
    >
      <div role="status" aria-live="polite" data-upload-phase="ready">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: space.md,
            flexWrap: "wrap",
          }}
        >
          <strong style={{ ...type.cardTitle, color: colour.strongInk }}>
            {result.filename} is ready
          </strong>
          <Badge tone="strong">
            version {result.materialVersion} · stored in{" "}
            {result.storage === "s3"
              ? "S3"
              : result.storage === "database"
                ? "the database"
                : "local storage"}
          </Badge>
        </div>

        <p style={{ ...type.small, color: colour.muted, margin: `${space.sm} 0 0` }}>
          {result.charCount.toLocaleString()} characters read ·{" "}
          {result.unitCount} source units · {result.topics.length} topics ·{" "}
          {result.quizReady ? "quiz ready" : `quiz ${result.poolStatus}`}
        </p>

        <p style={{ ...type.small, color: colour.muted, margin: `${space.md} 0 0` }}>
          Detected topics: {result.topics.map((topic) => topic.name).join(" · ")}
        </p>

        <div style={{ display: "flex", gap: space.md, marginTop: space.lg }}>
          <a href={`/class/${sessionId}/recap`} style={button.primary}>
            Read my recap
          </a>
          <a href={`/class/${sessionId}/quiz`} style={button.secondary}>
            Take the quiz
          </a>
        </div>
      </div>
    </Card>
  );
}
