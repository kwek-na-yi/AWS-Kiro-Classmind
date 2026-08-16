import ProfilePicker from "@/components/ProfilePicker";
import { colour, panel, space, type } from "@/lib/design/tokens";
import { getMaterial, listTopics } from "@/lib/repo/material";
import { getSession } from "@/lib/repo/session";

/**
 * Lecture — the material, its Topics, and the profile that shapes the Recap.
 *
 * Assembled on the server: the material and Topic list are read straight through
 * the repository, so the view arrives in one round trip. Only the picker is a
 * Client Component, because only it needs the Learner_Id from local storage.
 */
export default async function LecturePage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;

  const session = await getSession(sessionId);

  if (!session) {
    return (
      <section style={panel}>
        <h1 style={{ ...type.title, marginTop: 0 }}>Class not found</h1>
        <p style={{ ...type.body, color: colour.muted, margin: 0 }}>
          This class session does not exist. Check the code and join again from the
          home page.
        </p>
      </section>
    );
  }

  const [material, topics] = await Promise.all([
    getMaterial(sessionId, session.materialVersion),
    listTopics(sessionId, session.materialVersion),
  ]);

  return (
    <div style={{ display: "grid", gap: space.lg }}>
      <header>
        <h1 style={{ ...type.display, margin: `0 0 ${space.xs}` }}>{session.name}</h1>
        <p style={{ ...type.body, color: colour.muted, margin: 0 }}>
          {material
            ? `${material.filename} · ${topics.length} topics · ${material.charCount.toLocaleString()} characters of source text`
            : "No lecture material has been uploaded yet."}
        </p>
      </header>

      <section style={panel}>
        <h2 style={{ ...type.title, margin: `0 0 ${space.md}` }}>Topics in this lecture</h2>

        {topics.length === 0 ? (
          <p style={{ ...type.body, color: colour.muted, margin: 0 }}>
            Topics appear once the instructor&rsquo;s material has been processed.
          </p>
        ) : (
          <ol style={{ ...type.body, margin: 0, paddingLeft: space.lg }}>
            {topics.map((topic) => (
              <li key={topic.topicId} style={{ marginBottom: space.xs }}>
                {topic.name}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section style={panel}>
        <h2 style={{ ...type.title, margin: `0 0 ${space.xs}` }}>
          Personalise your recap
        </h2>
        <p style={{ ...type.body, color: colour.muted, margin: `0 0 ${space.lg}` }}>
          The same lecture, written for where you actually are. You can change this at
          any time.
        </p>

        <ProfilePicker sessionId={sessionId} />
      </section>
    </div>
  );
}
