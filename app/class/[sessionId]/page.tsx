import { redirect } from "next/navigation";

/**
 * A Class_Session has no view of its own — it opens on Lecture, the view where
 * the Learner picks an Understanding_Level and an Explanation_Style before a
 * Recap can be requested.
 */
export default async function ClassIndexPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  redirect(`/class/${sessionId}/lecture`);
}
