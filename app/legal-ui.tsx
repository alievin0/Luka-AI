/**
 * Shared chrome for the legal and support pages.
 *
 * These exist because the stores require a reachable Terms and Support URL,
 * and because a subscription screen has to link to terms a person can
 * actually read. They are plain documents on purpose — nothing here should
 * look like marketing.
 */

export const PAGE_STYLE = {
  maxWidth: 720,
  margin: "0 auto",
  padding: "56px 24px 96px",
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  lineHeight: 1.7,
  color: "#1a1a1a",
} as const;

export function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginTop: 34 }}>
      <h2 style={{ fontSize: 19, marginBottom: 8 }}>{title}</h2>
      <div style={{ color: "#333" }}>{children}</div>
    </section>
  );
}

export const CONTACT = "alicpa2006@gmail.com";
export const UPDATED = "27 August 2026";

/** Every app shipped from this codebase, for the pages that cover all of them. */
export const ALL_APPS = [
  { id: "dashlight", name: "Dash Light Scanner", one: "identifies a dashboard warning light and says whether it is safe to drive" },
  { id: "goldscan", name: "Gold Hallmark Scanner", one: "reads a gold hallmark and checks an asking price against the metal value" },
  { id: "bugscan", name: "Insect Identifier", one: "identifies insects and bites and gives first-aid guidance" },
  { id: "womensfit", name: "Home Workouts", one: "a four-week bodyweight plan with no equipment" },
  { id: "dogtrain", name: "Dog Training", one: "twelve positive-reinforcement training sessions" },
  { id: "mahdar", name: "Mahdar", one: "records a lecture and returns the summary, the assignments and likely exam topics" },
] as const;
