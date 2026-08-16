import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ClassMind",
  description:
    "Turns uploaded lecture material into a personalised study experience and gives the class a shared, anonymous view of where understanding is weak.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
