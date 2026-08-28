/**
 * Français — the lines a driver acts on.
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
  "Stop the car now": "Arrêtez la voiture maintenant",
  "Keep going, carefully": "Vous pouvez continuer, prudemment",
  "No need to stop": "Pas besoin de vous arrêter",
  "Do not move the car": "Ne déplacez pas la voiture",
  "Leaving it where it is does less harm than driving it.": "La laisser sur place fait moins de dégâts que de la conduire.",
  "Move only to somewhere safe": "Ne roulez que jusqu'à un endroit sûr",
  "Do not continue the journey. Get off the carriageway and stop.": "Ne poursuivez pas votre trajet. Quittez la chaussée et arrêtez-vous.",
  "You can continue, carefully": "Vous pouvez continuer, prudemment",
  "Ease off the speed and book a check soon.": "Levez le pied et faites contrôler la voiture rapidement.",
  "Keep an eye on it": "Restez attentif",
  "Nothing to change right now.": "Rien à changer pour l'instant.",
  "Are you somewhere safe?": "Êtes-vous dans un endroit sûr ?",
  "Yes": "Oui",
  "No": "Non",
  "Good. Switch the engine off and stay clear of moving traffic.": "Bien. Coupez le moteur et éloignez-vous de la circulation.",
  "Turn your hazard lights on now.": "Allumez vos feux de détresse maintenant.",
  "Ease over to the hard shoulder or the nearest exit — no sudden braking.": "Rejoignez doucement la bande d'arrêt d'urgence ou la sortie la plus proche, sans freinage brusque.",
  "Stop as far from moving traffic as you can.": "Arrêtez-vous le plus loin possible de la circulation.",
  "Get out on the side away from traffic, and stand behind the barrier if there is one.": "Sortez du côté opposé à la circulation et placez-vous derrière la glissière s'il y en a une.",
  "Call for roadside help.": "Appelez une assistance routière.",
  "Have you noticed smoke, a burning smell, an unusual noise, or a change in how the car drives?": "Avez-vous remarqué de la fumée, une odeur de brûlé, un bruit inhabituel ou un changement de comportement de la voiture ?",
  "What you have just described matters more than the lamp. Stop somewhere safe, switch the engine off, and call for help — whatever this reading says.": "Ce que vous venez de décrire compte plus que le témoin. Arrêtez-vous en lieu sûr, coupez le moteur et appelez de l'aide, quoi que dise ce résultat.",
  "This is why the verdict above changed: what you can see and hear outranks what the lamp shows.": "C'est pourquoi le verdict ci-dessus a changé : ce que vous voyez et entendez prime sur ce qu'indique le témoin.",
  "Then this reading stands. If anything changes while you drive, stop.": "Alors ce résultat reste valable. Si quelque chose change en roulant, arrêtez-vous.",
  "This reading is from the lamp alone. If you see smoke, smell burning, hear an unusual noise, or the car handles differently — stop, whatever this says.": "Ce résultat repose uniquement sur le témoin. Si vous voyez de la fumée, sentez le brûlé, entendez un bruit inhabituel ou si la voiture réagit autrement, arrêtez-vous, quoi qu'il dise.",
};

export default t;
