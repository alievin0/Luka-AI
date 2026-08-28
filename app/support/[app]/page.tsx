import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { APPS, type AppId } from "../../privacy/apps";
import { PAGE_STYLE, Section } from "../../legal-ui";

/**
 * Per-app support.
 *
 * The App Store requires a reachable support URL, and a page that only says
 * "email us" satisfies the requirement while helping nobody. But the questions
 * worth answering differ by app: a driver photographing a dashboard has never
 * wondered whether they are allowed to record a lecture, and a page that
 * answers both makes them read past the half that is not theirs.
 *
 * Shared answers — cancelling, restoring, refunds — stay shared. The rest is
 * chosen by the app's kind, from the same data the privacy policy uses.
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
  if (!entry) return { title: "Support" };
  return {
    title: `${entry.name} — Support`,
    description: `How to get help with ${entry.name}.`,
  };
}

export default async function Support({
  params,
}: {
  params: Promise<{ app: string }>;
}) {
  const { app } = await params;
  const entry = APPS[app as AppId];
  if (!entry) notFound();

  return (
    <main dir="ltr" style={PAGE_STYLE}>
      <p style={{ color: "#666", fontSize: 14, margin: 0 }}>{entry.name}</p>
      <h1 style={{ fontSize: 34, margin: "6px 0 4px", letterSpacing: -0.5 }}>
        Support
      </h1>
      <p style={{ color: "#666", fontSize: 14, marginTop: 0 }}>
        Updated {entry.updated} &middot; we read every message
      </p>

      <Section title="Contact us">
        <p>
          Email <a href={`mailto:${entry.contact}`}>{entry.contact}</a>. Tell us
          your phone model, what happened, and include a screenshot when
          possible. There is no account to look up, so what you tell us is all
          we have to go on.
        </p>
      </Section>

      {entry.kind === "scanner" ? (
        <Section title="Scanning">
          <p>
            <strong>It can&rsquo;t read the symbol.</strong> Get closer, hold
            steady, and avoid shooting through a reflection. A warning light
            photographed at an angle through a windscreen is often unreadable
            even to a person.
          </p>
          <p>
            <strong>It identified the wrong symbol.</strong> Tell us what it
            said and what it should have said. If you still have the photo,
            send it — please crop out anything unrelated to the dashboard
            first. That is the most useful message we receive.
          </p>
          <p>
            <strong>My scan failed.</strong> Try again with a clearer photo. If
            a scan was counted or you were charged and you did not get a
            result, email us with the approximate time and a screenshot.
          </p>
        </Section>
      ) : null}

      {entry.kind === "audio" ? (
        <Section title="Recording lectures">
          <p>
            <strong>No text appears while I record.</strong> Live transcription
            runs on the phone and needs the speech-recognition permission. If it
            is unavailable, the lecture still records and the text arrives when
            you finish.
          </p>
          <p>
            <strong>The transcript is poor.</strong> Open the lecture and use
            &ldquo;re-transcribe from the recording&rdquo;, which runs a more
            accurate pass over the audio. Getting the phone closer to the
            lecturer matters more than anything else.
          </p>
          <p>
            <strong>Am I allowed to record?</strong> Check with your instructor
            or institution first. Some places require consent from everyone in
            the room, and that responsibility is yours.
          </p>
        </Section>
      ) : null}

      <Section title="Subscriptions">
        <p>
          <strong>How do I cancel?</strong> In your device settings, not in the
          app: on iPhone, Settings &rarr; your name &rarr; Subscriptions; on
          Android, Play Store &rarr; Profile &rarr; Payments and subscriptions.
          Deleting the app does not cancel a subscription.
        </p>
        <p>
          <strong>I paid but it still says free.</strong> Open the app&rsquo;s
          settings and tap Restore a purchase. Purchases are tied to the store
          account that bought them, so make sure you are signed in with the
          same one.
        </p>
        <p>
          <strong>I changed phones.</strong> Your subscription follows your
          store account — restore it as above. Your saved history does not: it
          lives on the device, by design.
        </p>
        <p>
          <strong>I want a refund.</strong> Refund requests for purchases made
          through Apple or Google are handled according to that store&rsquo;s
          policies. Use{" "}
          <a href="https://reportaproblem.apple.com">reportaproblem.apple.com</a>{" "}
          or your Play Store order history. Tell us too, so we can fix whatever
          led to it.
        </p>
      </Section>

      {app === "dashlight" ? (
        <Section title="Safety">
          <p>
            This app gives you guidance from a photograph, not a mechanical
            diagnosis. If your vehicle is smoking, overheating, leaking, smells
            of burning, is making an unusual noise, or is driving differently,
            stop in a safe place and get professional help. Do not rely on the
            app alone to decide whether a vehicle is safe to drive.
          </p>
        </Section>
      ) : null}

      <Section title="Privacy and your data">
        <p>
          What the app saves is stored on your device, and deleting the app
          removes it. We do not run an account-based history that we could
          delete on request. The{" "}
          <a href={`/privacy/${app}`}>privacy policy</a> describes what the app
          sends, what our servers see, and which providers process it, and the{" "}
          <a href={`/terms/${app}`}>terms of use</a> cover the subscription.
        </p>
      </Section>

    </main>
  );
}
