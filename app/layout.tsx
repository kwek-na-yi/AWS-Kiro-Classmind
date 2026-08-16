import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ClassMind",
  description:
    "Turns uploaded lecture material into a personalised study experience and gives the class a shared, anonymous view of where understanding is weak.",
};

/**
 * The application shell.
 *
 * It provides the wordmark, the fixed content column (Requirement 18.4) and the
 * single `<main>` landmark every page renders into. The four named views are
 * Class_Session-scoped, so their navigation lives in
 * `app/class/[sessionId]/layout.tsx`, which is the layout that owns them.
 *
 * There is deliberately no text input anywhere in this shell: ClassMind exposes
 * exactly four named views and no free-form chat surface (Requirements 18.1,
 * 18.2).
 */
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          color: "#111827",
          background: "#f9fafb",
        }}
      >
        <header
          style={{
            borderBottom: "1px solid #e5e7eb",
            background: "#ffffff",
          }}
        >
          <div
            style={{
              maxWidth: "1152px",
              margin: "0 auto",
              padding: "16px 24px",
            }}
          >
            <span style={{ fontSize: "18px", fontWeight: 600 }}>ClassMind</span>
          </div>
        </header>
        <main
          style={{
            maxWidth: "1152px",
            margin: "0 auto",
            padding: "24px",
          }}
        >
          {children}
        </main>
      </body>
    </html>
  );
}
