"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  IconCheck,
  IconHome,
  IconInsight,
  IconLearn,
  IconLock,
} from "@/components/ui/icons";
import { colour, layout, radius, space, type } from "@/lib/design/tokens";

/**
 * The persistent navigation.
 *
 * Four destinations, in the order a Learner meets them, so the sidebar doubles
 * as a map of the journey. A view that is not open yet is shown with a lock
 * rather than hidden — naming the destination is what makes the product's shape
 * legible from the first screen, and a lock is more honest than a dead link.
 *
 * Below 900px the sidebar becomes a horizontal strip above the content. That is
 * handled by a media query in the shell rather than by measuring the viewport
 * in JavaScript, so it works on the server render too.
 */

export interface NavItem {
  segment: string;
  label: string;
  Icon: (props: { size?: number }) => React.JSX.Element;
  ready: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { segment: "lecture", label: "Learn", Icon: IconLearn, ready: true },
  { segment: "recap", label: "Recap", Icon: IconHome, ready: true },
  { segment: "quiz", label: "Check", Icon: IconCheck, ready: true },
  { segment: "insight", label: "Class Insight", Icon: IconInsight, ready: true },
];

export default function Sidebar({
  sessionId,
  className,
  learnerName,
}: {
  sessionId: string;
  className?: string;
  learnerName?: string;
}) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="ClassMind sections"
      className="cm-sidebar"
      style={{
        width: layout.sidebarWidth,
        flexShrink: 0,
        background: colour.surface,
        borderRight: `1px solid ${colour.border}`,
        display: "flex",
        flexDirection: "column",
        position: "sticky",
        top: 0,
        height: "100vh",
      }}
    >
      <div style={{ padding: `${space.xl} ${space.lg} ${space.lg}` }}>
        <Link
          href="/"
          style={{
            display: "flex",
            alignItems: "center",
            gap: space.sm,
            textDecoration: "none",
          }}
        >
          <span
            aria-hidden
            style={{
              width: "28px",
              height: "28px",
              borderRadius: radius.sm,
              background: colour.primary,
              color: "#FFFFFF",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "15px",
              fontWeight: 700,
            }}
          >
            C
          </span>
          <span style={{ ...type.sectionTitle, color: colour.text }}>ClassMind</span>
        </Link>

        {className ? (
          <p
            style={{
              ...type.small,
              color: colour.subtle,
              margin: `${space.md} 0 0`,
              lineHeight: 1.4,
            }}
          >
            {className}
          </p>
        ) : null}
      </div>

      <ul
        className="cm-nav-list"
        style={{
          listStyle: "none",
          margin: 0,
          padding: `0 ${space.md}`,
          display: "grid",
          gap: "2px",
          // `flex: 1` makes the list absorb the space above the profile block.
          // Without `alignContent`, a grid that has been stretched distributes
          // that space *between* its rows, so the four destinations drift to
          // the four corners of the rail instead of sitting as a group.
          flex: 1,
          alignContent: "start",
        }}
      >
        {NAV_ITEMS.map(({ segment, label, Icon, ready }) => {
          const href = `/class/${sessionId}/${segment}`;
          // Class Insight stays highlighted while a Study Together topic below
          // it is open, so a Learner never loses their place in the sidebar.
          const isActive = pathname === href || pathname.startsWith(`${href}/`);

          const base: React.CSSProperties = {
            ...type.body,
            fontWeight: isActive ? 620 : 500,
            display: "flex",
            alignItems: "center",
            gap: space.md,
            padding: `${space.md} ${space.md}`,
            borderRadius: radius.md,
            textDecoration: "none",
          };

          return (
            <li key={segment}>
              {ready ? (
                <Link
                  href={href}
                  aria-current={isActive ? "page" : undefined}
                  style={{
                    ...base,
                    color: isActive ? colour.primaryInk : colour.muted,
                    background: isActive ? colour.primarySoft : "transparent",
                  }}
                >
                  <Icon />
                  {label}
                </Link>
              ) : (
                <span
                  aria-disabled="true"
                  title="Opens once the class has taken the check"
                  style={{ ...base, color: colour.subtle, cursor: "default" }}
                >
                  <Icon />
                  <span style={{ flex: 1 }}>{label}</span>
                  <IconLock size={14} />
                </span>
              )}
            </li>
          );
        })}
      </ul>

      <div
        className="cm-sidebar-foot"
        style={{
          borderTop: `1px solid ${colour.border}`,
          padding: space.lg,
          display: "flex",
          alignItems: "center",
          gap: space.md,
        }}
      >
        <span
          aria-hidden
          style={{
            width: "32px",
            height: "32px",
            borderRadius: radius.pill,
            background: colour.focusSoft,
            color: colour.focusInk,
            border: `1px solid ${colour.focusBorder}`,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "13px",
            fontWeight: 680,
          }}
        >
          {(learnerName ?? "You").slice(0, 1).toUpperCase()}
        </span>

        <span style={{ minWidth: 0 }}>
          <span
            style={{
              ...type.small,
              fontWeight: 580,
              color: colour.text,
              display: "block",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {learnerName ?? "Signed in"}
          </span>
          <span style={{ ...type.small, color: colour.subtle, fontSize: "12px" }}>
            Learner
          </span>
        </span>
      </div>
    </nav>
  );
}
