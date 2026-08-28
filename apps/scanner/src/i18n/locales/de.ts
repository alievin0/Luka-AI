/**
 * Deutsch — the lines a driver acts on.
 *
 * Keyed on the English string, because `L(en, ar)` appears over nine hundred
 * times and adding a language should not touch any of them. `t()` falls back
 * to English for anything absent here, so this file grows without breaking.
 *
 * The safety block below is not optional: `npm run check:locales` fails if any
 * of it is missing. It is also the block worth having a native speaker read
 * before launch — a mistranslated "stop the car" is not a cosmetic bug.
 */
const t: Record<string, string> = {
  /* ---- safety: never allowed to fall back to English ---- */
  "Stop the car now": "Halten Sie jetzt an",
  "Keep going, carefully": "Sie können vorsichtig weiterfahren",
  "No need to stop": "Sie müssen nicht anhalten",
  "Do not move the car": "Bewegen Sie das Auto nicht",
  "Leaving it where it is does less harm than driving it.": "Es stehen zu lassen richtet weniger Schaden an, als damit zu fahren.",
  "Move only to somewhere safe": "Fahren Sie nur bis zu einer sicheren Stelle",
  "Do not continue the journey. Get off the carriageway and stop.": "Setzen Sie die Fahrt nicht fort. Verlassen Sie die Fahrbahn und halten Sie an.",
  "You can continue, carefully": "Sie können vorsichtig weiterfahren",
  "Ease off the speed and book a check soon.": "Nehmen Sie Tempo heraus und lassen Sie das Auto bald prüfen.",
  "Keep an eye on it": "Behalten Sie es im Auge",
  "Nothing to change right now.": "Im Moment ist nichts zu ändern.",
  "Are you somewhere safe?": "Stehen Sie an einer sicheren Stelle?",
  "Yes": "Ja",
  "No": "Nein",
  "Good. Switch the engine off and stay clear of moving traffic.": "Gut. Schalten Sie den Motor aus und halten Sie sich vom fließenden Verkehr fern.",
  "Turn your hazard lights on now.": "Schalten Sie jetzt die Warnblinkanlage ein.",
  "Ease over to the hard shoulder or the nearest exit — no sudden braking.": "Wechseln Sie langsam auf den Standstreifen oder zur nächsten Ausfahrt, ohne scharf zu bremsen.",
  "Stop as far from moving traffic as you can.": "Halten Sie so weit wie möglich vom fließenden Verkehr entfernt.",
  "Get out on the side away from traffic, and stand behind the barrier if there is one.": "Steigen Sie auf der dem Verkehr abgewandten Seite aus und stellen Sie sich hinter die Leitplanke, falls vorhanden.",
  "Call for roadside help.": "Rufen Sie den Pannendienst.",
  "Have you noticed smoke, a burning smell, an unusual noise, or a change in how the car drives?": "Haben Sie Rauch, Brandgeruch, ein ungewöhnliches Geräusch oder ein verändertes Fahrverhalten bemerkt?",
  "What you have just described matters more than the lamp. Stop somewhere safe, switch the engine off, and call for help — whatever this reading says.": "Was Sie gerade beschrieben haben, wiegt schwerer als die Leuchte. Halten Sie an einer sicheren Stelle, schalten Sie den Motor aus und holen Sie Hilfe, unabhängig davon, was hier steht.",
  "This is why the verdict above changed: what you can see and hear outranks what the lamp shows.": "Deshalb hat sich das Urteil oben geändert: Was Sie sehen und hören, wiegt schwerer als das, was die Leuchte anzeigt.",
  "Then this reading stands. If anything changes while you drive, stop.": "Dann bleibt dieses Ergebnis bestehen. Ändert sich während der Fahrt etwas, halten Sie an.",
  "This reading is from the lamp alone. If you see smoke, smell burning, hear an unusual noise, or the car handles differently — stop, whatever this says.": "Dieses Ergebnis beruht allein auf der Leuchte. Wenn Sie Rauch sehen, Brandgeruch wahrnehmen, ein ungewöhnliches Geräusch hören oder das Auto sich anders fährt, halten Sie an, unabhängig davon, was hier steht.",
};

export default t;
