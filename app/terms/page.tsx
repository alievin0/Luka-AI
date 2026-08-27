import type { Metadata } from "next";
import { ALL_APPS, CONTACT, PAGE_STYLE, Section, UPDATED } from "../legal-ui";

export const metadata: Metadata = {
  title: "Terms of Use",
  description: "The terms that apply to these apps and their subscriptions.",
};

/**
 * Terms of Use.
 *
 * Apple requires a subscription screen to carry a functional link to terms,
 * and rejects builds that do not. This is that document — written to be read
 * rather than to be impressive, and honest about what the apps can and cannot
 * do, because overclaiming in terms is how a disclaimer stops protecting you.
 */
export default function Terms() {
  return (
    <main dir="ltr" style={PAGE_STYLE}>
      <h1 style={{ fontSize: 34, margin: "0 0 4px", letterSpacing: -0.5 }}>
        Terms of Use
      </h1>
      <p style={{ color: "#666", fontSize: 14, marginTop: 0 }}>
        Last updated {UPDATED}
      </p>

      <Section title="What these terms cover">
        <p>These terms apply to the following apps:</p>
        <ul>
          {ALL_APPS.map((app) => (
            <li key={app.id}>
              <strong>{app.name}</strong> — {app.one}.
            </li>
          ))}
        </ul>
        <p>
          By using one of them you agree to what follows. If you do not agree,
          delete the app; that is all it takes, because there is no account to
          close.
        </p>
      </Section>

      <Section title="What the apps are, and are not">
        <p>
          These apps give you information. They do not give you professional
          advice, and they are not a substitute for someone qualified.
        </p>
        <ul>
          <li>
            Dash Light Scanner reads a warning <em>symbol</em>. It cannot
            diagnose a <em>fault</em>, and it does not know the condition of
            your vehicle. Never rely on it alone to decide whether a vehicle is
            safe to drive. Cost ranges are rough orientation, not quotations.
          </li>
          <li>
            Gold Hallmark Scanner reads a stamp and checks arithmetic. A
            photograph cannot prove that gold is solid rather than plated —
            only an acid, XRF or density test can. Nothing in it is financial
            advice or a valuation to buy or sell on.
          </li>
          <li>
            Insect Identifier is not medical advice. If a bite is worsening, or
            you have trouble breathing, contact a doctor or emergency services
            rather than an app.
          </li>
          <li>
            Home Workouts and Dog Training are general guidance. Speak to a
            doctor before starting exercise if you are pregnant, injured or
            unwell, and to a qualified behaviourist where a dog shows
            aggression or fear.
          </li>
          <li>
            Mahdar summarises what it heard. It can mishear, and it is not a
            substitute for attending or for your lecturer&rsquo;s own material.
          </li>
        </ul>
        <p>
          All of these apps use AI, and AI is sometimes confidently wrong. Where
          an answer matters, check it.
        </p>
      </Section>

      <Section title="Recording, where it applies">
        <p>
          Mahdar records audio. Recording a lecture may require permission from
          your instructor or institution, and in some places the law requires
          the consent of the people being recorded. Making sure you are allowed
          to record is your responsibility, not ours. Do not use the app to
          record people who have not agreed to it.
        </p>
      </Section>

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
            A subscription renews automatically unless you turn off
            auto-renewal at least 24 hours before the end of the current
            period. Your account is charged for renewal within 24 hours before
            the end of the current period.
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
          Do not use these apps to break the law, to record people without
          their agreement, or to resell or redistribute what they produce as
          your own service. Do not attempt to extract keys from the apps or to
          use their servers other than through the apps themselves.
        </p>
      </Section>

      <Section title="Availability">
        <p>
          These apps depend on services we do not control, and features that
          need a network will not work without one. We do not promise
          uninterrupted availability, and we may change or discontinue features.
        </p>
      </Section>

      <Section title="Liability">
        <p>
          The apps are provided as they are. To the extent the law allows, we
          are not liable for loss arising from your use of them — including
          decisions taken on information they gave you. Nothing here limits
          liability that cannot lawfully be limited, and where your local
          consumer law gives you rights, those rights stand.
        </p>
      </Section>

      <Section title="Changes">
        <p>
          If these terms change, the date at the top changes. Continuing to use
          an app after a change means you accept it.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
        </p>
      </Section>
    </main>
  );
}
