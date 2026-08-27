import type { Metadata } from "next";
import { ALL_APPS, CONTACT, PAGE_STYLE, Section, UPDATED } from "../legal-ui";

export const metadata: Metadata = {
  title: "Support",
  description: "How to get help with these apps, and answers to the common questions.",
};

/**
 * Support page.
 *
 * The App Store requires a reachable support URL, and a page that only says
 * "email us" satisfies the requirement while helping nobody. The questions
 * below are the ones the apps' own design actually raises.
 */
export default function Support() {
  return (
    <main dir="ltr" style={PAGE_STYLE}>
      <h1 style={{ fontSize: 34, margin: "0 0 4px", letterSpacing: -0.5 }}>Support</h1>
      <p style={{ color: "#666", fontSize: 14, marginTop: 0 }}>
        Updated {UPDATED} &middot; we read every message
      </p>

      <Section title="Get in touch">
        <p>
          Email <a href={`mailto:${CONTACT}`}>{CONTACT}</a>. Tell us which app,
          which phone, and what happened — a screenshot helps more than anything
          else. There is no account to look up, so what you tell us is all we
          have to go on.
        </p>
      </Section>

      <Section title="The apps">
        <ul>
          {ALL_APPS.map((app) => (
            <li key={app.id}>
              <strong>{app.name}</strong> — {app.one}.{" "}
              <a href={`/privacy/${app.id}`}>Privacy policy</a>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Billing and subscriptions">
        <p>
          <strong>How do I cancel?</strong> In your device settings, not in the
          app: on iPhone, Settings &rarr; your name &rarr; Subscriptions; on
          Android, Play Store &rarr; Profile &rarr; Payments and subscriptions.
          Deleting the app does not cancel a subscription.
        </p>
        <p>
          <strong>I paid and the app still says free.</strong> Open the app&rsquo;s
          settings and tap Restore a purchase. Purchases are tied to the store
          account that bought them, so make sure you are signed in with the same
          one.
        </p>
        <p>
          <strong>I want a refund.</strong> Refunds go through Apple or Google,
          not through us — we never receive the payment. Use{" "}
          <a href="https://reportaproblem.apple.com">reportaproblem.apple.com</a>{" "}
          or the Play Store order history. Tell us too, so we can fix whatever
          led to it.
        </p>
        <p>
          <strong>I changed phones.</strong> Your subscription follows your store
          account. Your saved history does not — it lives on the device, by
          design, because we never had a copy.
        </p>
      </Section>

      <Section title="Scanning">
        <p>
          <strong>It says it cannot see the symbol.</strong> Get closer, hold
          steady, and avoid shooting through a reflection. A warning light
          photographed at an angle through a windscreen is often unreadable even
          to a person.
        </p>
        <p>
          <strong>It identified the wrong thing.</strong> Tell us what it said
          and what it should have said, and send the photo if you still have it.
          That is the most useful message we receive.
        </p>
      </Section>

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
          accurate pass over the audio. Getting the phone closer to the lecturer
          matters more than anything else.
        </p>
        <p>
          <strong>Am I allowed to record?</strong> Check with your instructor or
          institution first. Some places require consent from everyone in the
          room, and that responsibility is yours.
        </p>
      </Section>

      <Section title="Privacy and your data">
        <p>
          Everything these apps save is stored on your device. There is no
          account, no tracking and no advertising. Deleting the app removes
          everything — there is nothing on our side to delete. Each app has its
          own policy, linked above, describing exactly what it sends and why.
        </p>
      </Section>
    </main>
  );
}
