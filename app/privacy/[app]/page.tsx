import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AI_PROVIDER, APPS, type AppId } from "../apps";

/**
 * Per-app privacy policies.
 *
 * One shared policy would be inaccurate, and an inaccurate privacy policy is
 * worse than none: these apps do genuinely different things with genuinely
 * different data. The scanners take photographs, the lecture app records a
 * room full of people, and the programs collect nothing at all. App Review
 * checks the policy against what the binary actually asks for, so each one
 * names only the permissions its own build declares.
 */

export function generateStaticParams() {
  return Object.keys(APPS).map((app) => ({ app }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ app: string }>;
}): Promise<Metadata> {
  const { app } = await params;
  const entry = APPS[app as AppId];
  if (!entry) return { title: "Privacy Policy" };
  return {
    title: `${entry.name} — Privacy Policy`,
    description: `How ${entry.name} handles your data.`,
  };
}

export default async function PrivacyPolicy({
  params,
}: {
  params: Promise<{ app: string }>;
}) {
  const { app } = await params;
  const entry = APPS[app as AppId];
  if (!entry) notFound();

  return (
    <main
      dir="ltr"
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: "56px 24px 96px",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        lineHeight: 1.7,
        color: "#1a1a1a",
      }}
    >
      <p style={{ color: "#666", fontSize: 14, margin: 0 }}>{entry.name}</p>
      <h1 style={{ fontSize: 34, margin: "6px 0 4px", letterSpacing: -0.5 }}>
        Privacy Policy
      </h1>
      <p style={{ color: "#666", fontSize: 14, marginTop: 0 }}>
        Last updated {entry.updated}
      </p>

      <Section title="The short version">
        <p>{entry.summary}</p>
      </Section>

      <Section title="What the app collects">
        <ul>
          {entry.collects.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </Section>

      <Section title="What leaves your device">
        <p>{entry.leaves}</p>
      </Section>

      <Section title="What we do not do">
        <ul>
          <li>We do not ask you to create an account with us.</li>
          <li>We do not sell your data, and the app carries no advertising and no analytics or tracking SDK.</li>
          <li>We do not build a profile of you or link your activity across sessions.</li>
          <li>We do not use your content to train our own models.</li>
        </ul>
      </Section>

      <Section title="Where your data is stored">
        <p>
          Everything the app saves — your answers during setup, your history,
          your settings — is stored on your device, by the app, and is removed
          when you delete the app. We hold no account-based copy of it.
        </p>
      </Section>

      <Section title="Processing by a third party">
        <p>
          To produce your result, the app sends {entry.sends} to{" "}
          <a href={AI_PROVIDER.policy}>{AI_PROVIDER.name}</a>, which processes
          it and returns an answer. We do not use it to train models and we do
          not attach your name, your email address or an account to it. What{" "}
          {AI_PROVIDER.name} itself retains, and for how long, is governed by
          its own privacy policy, linked above — not by this one.
        </p>
        {entry.extraProcessor ? <p>{entry.extraProcessor}</p> : null}
      </Section>

      {entry.serverSide ? (
        <Section title="What our servers see">
          <p>{entry.serverSide}</p>
        </Section>
      ) : null}

      {entry.subscription ? (
        <Section title="Subscriptions">
          <p>{entry.subscription}</p>
        </Section>
      ) : null}

      <Section title="Children">
        <p>
          {entry.name} is not directed to children under 13, and we do not
          knowingly collect personal information from children under 13.
        </p>
      </Section>

      <Section title="Your choices">
        <ul>
          <li>
            Every permission the app uses can be revoked at any time in your
            device settings. The app will tell you what stops working rather
            than failing silently.
          </li>
          <li>
            Deleting the app removes everything it stored on your device. We do
            not run an account-based history that we could delete on request;
            what our service providers process on our behalf is described above.
          </li>
          <li>
            You can clear your saved history from inside the app at any time.
          </li>
        </ul>
      </Section>

      {entry.notes.length > 0 ? (
        <Section title="Worth knowing">
          <ul>
            {entry.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="Changes">
        <p>
          If this policy changes we will update the date at the top. Material
          changes will be surfaced in the app rather than only here.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Questions about this policy or your data:{" "}
          <a href={`mailto:${entry.contact}`}>{entry.contact}</a>
        </p>
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 34 }}>
      <h2 style={{ fontSize: 19, marginBottom: 8 }}>{title}</h2>
      <div style={{ color: "#333" }}>{children}</div>
    </section>
  );
}
