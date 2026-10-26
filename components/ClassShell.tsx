"use client";

import Sidebar from "@/components/Sidebar";
import { useDisplayName } from "@/hooks/useLearnerId";
import { colour, layout, space } from "@/lib/design/tokens";

/**
 * The Class_Session shell: persistent sidebar beside a wide content column.
 *
 * A Client Component only because the sidebar reads the Learner's name from
 * local storage to greet them. The pages it wraps stay server-rendered, so the
 * lecture view still arrives in one round trip.
 */
export default function ClassShell({
  sessionId,
  className,
  children,
}: {
  sessionId: string;
  className?: string;
  children: React.ReactNode;
}) {
  const displayName = useDisplayName(sessionId);

  return (
    <div
      className="cm-shell"
      style={{ display: "flex", minHeight: "100vh", background: colour.canvas }}
    >
      <Sidebar
        sessionId={sessionId}
        className={className}
        learnerName={displayName ?? undefined}
      />

      <div style={{ flex: 1, minWidth: 0 }}>
        <main
          className="cm-main"
          style={{
            maxWidth: layout.contentMax,
            margin: "0 auto",
            padding: `${space.xxl} ${space.xxl} ${space.xxxl}`,
          }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
