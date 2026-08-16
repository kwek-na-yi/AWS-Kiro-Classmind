"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The four named views of a Class_Session (Requirement 18.1). The Study_Space is
 * not a fifth view — it renders inside Class Insight, because Requirement 10.4
 * orders Study_Threads by the same ascending Class_Mastery the
 * Class_Understanding_Map already computes.
 */
export const CLASS_VIEWS = [
  { segment: "lecture", label: "Lecture" },
  { segment: "recap", label: "Recap" },
  { segment: "quiz", label: "Quiz" },
  { segment: "insight", label: "Class Insight" },
] as const;

export type ClassViewSegment = (typeof CLASS_VIEWS)[number]["segment"];

/**
 * The persistent view tabs. A Client Component only because the active tab is
 * derived from the current path; it fetches nothing and holds no state.
 *
 * The tabs live above the view's error boundary, so they stay operable while a
 * single view is showing an error (Requirement 18.6).
 */
export default function ClassNav({ sessionId }: { sessionId: string }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Class views"
      style={{
        display: "flex",
        gap: "8px",
        borderBottom: "1px solid #e5e7eb",
        marginBottom: "24px",
      }}
    >
      {CLASS_VIEWS.map(({ segment, label }) => {
        const href = `/class/${sessionId}/${segment}`;
        const isActive = pathname === href;

        return (
          <Link
            key={segment}
            href={href}
            aria-current={isActive ? "page" : undefined}
            style={{
              padding: "10px 14px",
              textDecoration: "none",
              color: isActive ? "#1d4ed8" : "#374151",
              fontWeight: isActive ? 600 : 400,
              borderBottom: isActive
                ? "2px solid #1d4ed8"
                : "2px solid transparent",
            }}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
