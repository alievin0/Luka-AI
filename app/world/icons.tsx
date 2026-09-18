/**
 * The icon set, drawn rather than imported.
 *
 * Every glyph in the client's design is a 1.6px-stroke line icon on a 24 grid.
 * Inlining them keeps that weight identical across the nav, the stat cards and
 * the campus overlay, and keeps them crisp at any zoom — which a sprite cut
 * out of the mockup would not be.
 */

type IconProps = { className?: string; strokeWidth?: number };

function Svg({
  children,
  className,
  strokeWidth = 1.6,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function IconHome(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 10.2 12 4l8 6.2V19a1 1 0 0 1-1 1h-4v-5h-6v5H5a1 1 0 0 1-1-1z" />
    </Svg>
  );
}

export function IconChat(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M20 12.5a6.5 6.5 0 0 1-6.5 6.5H9l-4 3v-3.7A6.5 6.5 0 0 1 4 12.5 6.5 6.5 0 0 1 10.5 6h3A6.5 6.5 0 0 1 20 12.5z" />
    </Svg>
  );
}

export function IconCalendar(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="4" y="5.5" width="16" height="14.5" rx="2.5" />
      <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
    </Svg>
  );
}

export function IconAlert(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 4.5 21 19.5H3z" />
      <path d="M12 10v4" />
      <circle cx="12" cy="16.8" r=".6" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function IconAgents(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="9" cy="8.5" r="3" />
      <path d="M3.5 19.5a5.5 5.5 0 0 1 11 0" />
      <path d="M16 6.2a3 3 0 0 1 0 5.8M17.5 19.5a5.6 5.6 0 0 0-2.2-4.4" />
    </Svg>
  );
}

export function IconBook(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5 4.5h9.5A2.5 2.5 0 0 1 17 7v12.5H7.5A2.5 2.5 0 0 1 5 17z" />
      <path d="M17 4.5h2v15h-2" />
    </Svg>
  );
}

export function IconLink(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M10.2 13.8a3.6 3.6 0 0 0 5.1 0l2.6-2.6a3.6 3.6 0 0 0-5.1-5.1l-1.3 1.3" />
      <path d="M13.8 10.2a3.6 3.6 0 0 0-5.1 0l-2.6 2.6a3.6 3.6 0 0 0 5.1 5.1l1.3-1.3" />
    </Svg>
  );
}

export function IconGlobe(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8" />
      <path d="M4 12h16M12 4c2.2 2.3 3.3 5 3.3 8s-1.1 5.7-3.3 8c-2.2-2.3-3.3-5-3.3-8S9.8 6.3 12 4z" />
    </Svg>
  );
}

export function IconGear(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 14.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.2a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.5 1z" />
    </Svg>
  );
}

export function IconSearch(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="11" cy="11" r="6.2" />
      <path d="m16 16 4 4" />
    </Svg>
  );
}

export function IconBolt(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M13.5 3 5.8 13.2h5.1L10 21l7.8-10.3h-5.2z" />
    </Svg>
  );
}

export function IconMoon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M20 14.2A8.4 8.4 0 0 1 9.8 4 8.4 8.4 0 1 0 20 14.2z" />
    </Svg>
  );
}

export function IconChevron(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m14 7-5 5 5 5" />
    </Svg>
  );
}

export function IconChevronDown(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m7 10 5 5 5-5" />
    </Svg>
  );
}

export function IconPause(p: IconProps) {
  return (
    <Svg {...p} strokeWidth={0}>
      <rect x="8" y="6" width="3" height="12" rx="1.3" fill="currentColor" />
      <rect x="13" y="6" width="3" height="12" rx="1.3" fill="currentColor" />
    </Svg>
  );
}

export function IconPlay(p: IconProps) {
  return (
    <Svg {...p} strokeWidth={0}>
      <path d="M9 6.4 18 12l-9 5.6z" fill="currentColor" />
    </Svg>
  );
}

export function IconReplay(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4.5 11a7.5 7.5 0 1 1 2.2 5.3" />
      <path d="M4 6.5V11h4.5" />
    </Svg>
  );
}

export function IconWhatsapp({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 2a10 10 0 0 0-8.6 15L2 22l5.2-1.4A10 10 0 1 0 12 2zm5.1 13.7c-.2.6-1.2 1.2-1.7 1.2-.5.1-1 .1-1.6-.1-.4-.1-.9-.3-1.5-.6-2.6-1.1-4.3-3.8-4.4-4-.1-.2-1-1.4-1-2.6s.6-1.8.9-2.1c.2-.2.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.3 0 .5l-.3.5-.3.3c-.1.1-.2.3 0 .5.1.3.6 1.1 1.4 1.7 1 .8 1.7 1.1 2 1.2.2.1.4 0 .5-.1l.8-.9c.2-.2.3-.2.5-.1l2 .9c.2.1.4.2.4.3.1.1.1.5-.1 1.2z"
      />
    </svg>
  );
}

/** The mark from the client's design: a four-point star with a soft gradient. */
export function LukaMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="luka-mark" x1="8" y1="6" x2="40" y2="42" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#6d8bff" />
          <stop offset="0.55" stopColor="#3b5bf6" />
          <stop offset="1" stopColor="#6c4df0" />
        </linearGradient>
      </defs>
      <path
        fill="url(#luka-mark)"
        d="M24 3c1.4 9.1 4.3 14.4 8.7 17.2 2.3 1.5 7.4 2.6 12.3 3.8-4.9 1.2-10 2.3-12.3 3.8C28.3 30.6 25.4 35.9 24 45c-1.4-9.1-4.3-14.4-8.7-17.2C13 26.3 7.9 25.2 3 24c4.9-1.2 10-2.3 12.3-3.8C19.7 17.4 22.6 12.1 24 3z"
      />
    </svg>
  );
}
