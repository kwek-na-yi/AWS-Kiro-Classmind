import type { Metadata } from "next";

import "@/app/globals.css";
import { colour } from "@/lib/design/tokens";

export const metadata: Metadata = {
  title: "ClassMind",
  description:
    "Understand yourself. Understand your class. ClassMind turns one lecture into a personalised recap, an adaptive check, and a shared view of where the class is struggling.",
};

/**
 * The document shell.
 *
 * Deliberately thin: it sets the page ground and the type family and nothing
 * else. The sidebar belongs to the Class_Session layout, because the landing
 * page has no class to navigate and should read as a product front door.
 *
 * There is no text input and no chat surface anywhere in this shell — ClassMind
 * exposes exactly the named views in the sidebar.
 *
 * `suppressHydrationWarning` covers browser extensions that stamp classes onto
 * these two elements before React hydrates. It applies one level deep, so a
 * genuine mismatch inside the app is still reported.
 */
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        style={{
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif",
          color: colour.text,
          background: colour.canvas,
          WebkitFontSmoothing: "antialiased",
        }}
      >
        {children}
      </body>
    </html>
  );
}
