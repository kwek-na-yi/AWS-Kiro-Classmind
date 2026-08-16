import ClassNav from "@/components/ClassNav";

/**
 * The Class_Session shell: the four view tabs plus the slot the active view
 * renders into.
 *
 * The tabs are rendered by this layout, which sits *above* the sibling
 * `error.tsx` boundary, so a view that throws replaces only the content below
 * the tabs and every other view stays reachable (Requirement 18.6).
 *
 * No text input element exists here or in the root layout (Requirement 18.2).
 */
export default async function ClassLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;

  return (
    <div>
      <ClassNav sessionId={sessionId} />
      {children}
    </div>
  );
}
