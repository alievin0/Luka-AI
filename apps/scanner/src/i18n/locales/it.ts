/**
 * Italiano — the lines a driver acts on.
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
  "Stop the car now": "Fermi l'auto adesso",
  "Keep going, carefully": "Può proseguire, con prudenza",
  "No need to stop": "Non serve fermarsi",
  "Do not move the car": "Non muova l'auto",
  "Leaving it where it is does less harm than driving it.": "Lasciarla dov'è fa meno danni che guidarla.",
  "Move only to somewhere safe": "Si sposti solo fino a un luogo sicuro",
  "Do not continue the journey. Get off the carriageway and stop.": "Non prosegua il viaggio. Esca dalla carreggiata e si fermi.",
  "You can continue, carefully": "Può continuare, con prudenza",
  "Ease off the speed and book a check soon.": "Riduca la velocità e faccia controllare l'auto a breve.",
  "Keep an eye on it": "La tenga d'occhio",
  "Nothing to change right now.": "Per ora non c'è nulla da cambiare.",
  "Are you somewhere safe?": "Si trova in un luogo sicuro?",
  "Yes": "Sì",
  "No": "No",
  "Good. Switch the engine off and stay clear of moving traffic.": "Bene. Spenga il motore e resti lontano dal traffico.",
  "Turn your hazard lights on now.": "Accenda subito le quattro frecce.",
  "Ease over to the hard shoulder or the nearest exit — no sudden braking.": "Si porti lentamente sulla corsia d'emergenza o alla prima uscita, senza frenate brusche.",
  "Stop as far from moving traffic as you can.": "Si fermi il più lontano possibile dal traffico.",
  "Get out on the side away from traffic, and stand behind the barrier if there is one.": "Scenda dal lato opposto al traffico e si metta dietro il guard rail, se c'è.",
  "Call for roadside help.": "Chiami il soccorso stradale.",
  "Have you noticed smoke, a burning smell, an unusual noise, or a change in how the car drives?": "Ha notato fumo, odore di bruciato, un rumore insolito o un cambiamento nella guida?",
  "What you have just described matters more than the lamp. Stop somewhere safe, switch the engine off, and call for help — whatever this reading says.": "Quello che ha appena descritto conta più della spia. Si fermi in un luogo sicuro, spenga il motore e chieda aiuto, qualunque cosa dica questo risultato.",
  "This is why the verdict above changed: what you can see and hear outranks what the lamp shows.": "È per questo che il giudizio qui sopra è cambiato: ciò che vede e sente conta più di ciò che mostra la spia.",
  "Then this reading stands. If anything changes while you drive, stop.": "Allora questo risultato resta valido. Se qualcosa cambia mentre guida, si fermi.",
  "This reading is from the lamp alone. If you see smoke, smell burning, hear an unusual noise, or the car handles differently — stop, whatever this says.": "Questo risultato si basa solo sulla spia. Se vede fumo, sente odore di bruciato, ode un rumore insolito o l'auto si comporta diversamente, si fermi, qualunque cosa dica.",
};

export default t;
