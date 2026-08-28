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


