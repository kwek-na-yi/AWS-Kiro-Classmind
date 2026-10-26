import ClassShell from "@/components/ClassShell";
import { ensureDemoData } from "@/lib/demo/bootstrap";
import { getSession } from "@/lib/repo/session";

/**
 * The Class_Session shell.
 *
 * The class name is read here, on the server, so the sidebar can show it
 * without the client fetching anything. The navigation sits above the sibling
 * `error.tsx` boundary, so a view that throws replaces only the content beside
 * the sidebar and every other destination stays reachable.
 */
export default async function ClassLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  await ensureDemoData();
  const session = await getSession(sessionId);

  return (
    <ClassShell sessionId={sessionId} className={session?.name}>
      {children}
    </ClassShell>
  );
}
