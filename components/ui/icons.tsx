/**
 * Line icons.
 *
 * Drawn inline as SVG rather than pulled from a package: there are five of
 * them, they inherit `currentColor`, and a dependency for that would be a poor
 * trade. Each is decorative — every icon in this product sits beside a text
 * label — so all are hidden from assistive technology.
 */

interface IconProps {
  size?: number;
}

function Svg({ size = 18, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      aria-hidden
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
    >
      {children}
    </svg>
  );
}

/** Home. */
export function IconHome(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V20h14V9.5" />
    </Svg>
  );
}

/** Learn — an open book. */
export function IconLearn(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 6.5C10.5 5 8.5 4.5 4 4.5V18c4.5 0 6.5.5 8 2 1.5-1.5 3.5-2 8-2V4.5c-4.5 0-6.5.5-8 2Z" />
      <path d="M12 6.5V20" />
    </Svg>
  );
}

/** Check — a task list with a tick. */
export function IconCheck(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 4h9a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3Z" />
      <path d="M9 12.5l2 2 4-4.5" />
    </Svg>
  );
}

/** Class Insight — grouped bars. */
export function IconInsight(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 20V11" />
      <path d="M10 20V5" />
      <path d="M16 20v-6" />
      <path d="M22 20H2" />
    </Svg>
  );
}

/** Study Together — two people. */
export function IconTogether(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
      <path d="M16 6.2a3 3 0 0 1 0 5.6" />
      <path d="M17.5 14.3c2 .7 3.5 2.4 3.5 4.7" />
    </Svg>
  );
}

/** A right-pointing chevron for forward navigation. */
export function IconArrowRight(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 12h13" />
      <path d="m13 6 6 6-6 6" />
    </Svg>
  );
}

/** A padlock, for a view that is not open yet. */
export function IconLock(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </Svg>
  );
}
