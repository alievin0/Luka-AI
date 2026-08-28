import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { APPS, type AppId } from "../../privacy/apps";
import { CONTACT, PAGE_STYLE, Section, UPDATED } from "../../legal-ui";

/**
 * Per-app terms of use.
 *
 * The subscription clauses genuinely are identical across these apps, which is
 * why one page used to cover all of them. But the same page then had to list
 * every app by name and carry every app's disclaimer — so someone opening the
 * terms for a dashboard scanner read paragraphs about gold hallmarks, insect
 * bites and lecture recordings, three of which are not on any store.
 *
 * A reviewer reads this document against one binary. It now describes one app:
 * shared clauses shared, and only this app's own limits, taken from the same
 * data the privacy policy uses so the two cannot drift apart.
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
  if (!entry) return { title: "Terms of Use" };
  return {
    title: `${entry.name} — Terms of Use`,
    description: `The terms that apply to ${entry.name} and its subscription.`,
  };
}

export default async function Terms({
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
        Terms of Use
      </h1>
      <p style={{ color: "#666", fontSize: 14, marginTop: 0 }}>
        Last updated {UPDATED}
      </p>

      <Section title="What these terms cover">
        <p>
          These terms apply to <strong>{entry.name}</strong>. By using it you
          agree to what follows. If you do not agree, delete the app; that is
          all it takes, because there is no account to close.
        </p>
      </Section>

      <Section title={`What ${entry.name} is, and is not`}>
        <p>
          This app gives you information. It does not give you professional
          advice, and it is not a substitute for someone qualified.
        </p>
        <ul>
          {entry.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
        <p>
          It uses AI, and AI is sometimes confidently wrong. Where an answer
          matters, check it.
        </p>
      </Section>

      {entry.kind === "audio" ? (
        <Section title="Recording">
          <p>
            Recording a lecture may require permission from your instructor or
            institution, and in some places the law requires the consent of the
            people being recorded. Making sure you are allowed to record is your
            responsibility, not ours. Do not use the app to record people who
            have not agreed to it.
          </p>
        </Section>
      ) : null}

      <Section title="Subscriptions">
        <ul>
          <li>
            Some features require a paid subscription. Prices are shown in the
            app in your local currency before you buy.
          </li>
          <li>
            Payment is charged to your Apple ID or Google Play account at
            confirmation of purchase.
          </li>
          <li>
            A subscription renews automatically unless you turn off auto-renewal
            at least 24 hours before the end of the current period. Your account
            is charged for renewal within 24 hours before the end of the current
            period.
          </li>
          <li>
            You can manage or cancel a subscription in your device account
            settings — App Store or Google Play — at any time. Deleting the app
            does not cancel a subscription.
          </li>
          <li>
            Where a free trial is offered, any unused part of it is forfeited
            when you buy a subscription.
          </li>
          <li>
            Refunds are handled by Apple and Google under their own policies,
            not by us. We cannot issue a refund for a purchase we never
            received.
          </li>
        </ul>
      </Section>

      <Section title="Acceptable use">
        <p>
          Do not use this app to break the law, to record people without their
          agreement, or to resell or redistribute what it produces as your own
          service. Do not attempt to extract keys from the app or to use its
          servers other than through the app itself.
        </p>
      </Section>

      <Section title="Availability">
        <p>
          This app depends on services we do not control, and features that need
          a network will not work without one. We do not promise uninterrupted
          availability, and we may change or discontinue features.
        </p>
      </Section>

      <Section title="Liability">
        <p>
          The app is provided as it is. To the extent the law allows, we are not
          liable for loss arising from your use of it — including decisions
          taken on information it gave you. Nothing here limits liability that
          cannot lawfully be limited, and where your local consumer law gives
          you rights, those rights stand.
        </p>
      </Section>

      <Section title="Changes">
        <p>
          If these terms change, the date at the top changes. Continuing to use
          the app after a change means you accept it.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          <a href={`mailto:${CONTACT}`}>{CONTACT}</a> &middot;{" "}
          <a href={`/privacy/${app}`}>Privacy policy</a> &middot;{" "}
          <a href={`/support/${app}`}>Support</a>
        </p>
      </Section>
    </main>
  );
}
