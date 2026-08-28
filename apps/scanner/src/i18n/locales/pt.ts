/**
 * Português — the lines a driver acts on.
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
  "Stop the car now": "Pare o carro agora",
  "Keep going, carefully": "Pode seguir, com cuidado",
  "No need to stop": "Não é preciso parar",
  "Do not move the car": "Não mova o carro",
  "Leaving it where it is does less harm than driving it.": "Deixá-lo onde está causa menos dano do que dirigi-lo.",
  "Move only to somewhere safe": "Mova-o apenas até um lugar seguro",
  "Do not continue the journey. Get off the carriageway and stop.": "Não continue a viagem. Saia da pista e pare.",
  "You can continue, carefully": "Você pode continuar, com cuidado",
  "Ease off the speed and book a check soon.": "Reduza a velocidade e agende uma revisão em breve.",
  "Keep an eye on it": "Fique de olho",
  "Nothing to change right now.": "Não há nada a mudar agora.",
  "Are you somewhere safe?": "Você está num lugar seguro?",
  "Yes": "Sim",
  "No": "Não",
  "Good. Switch the engine off and stay clear of moving traffic.": "Bom. Desligue o motor e fique longe do trânsito.",
  "Turn your hazard lights on now.": "Ligue o pisca-alerta agora.",
  "Ease over to the hard shoulder or the nearest exit — no sudden braking.": "Vá devagar para o acostamento ou para a saída mais próxima, sem frear bruscamente.",
  "Stop as far from moving traffic as you can.": "Pare o mais longe possível do trânsito.",
  "Get out on the side away from traffic, and stand behind the barrier if there is one.": "Saia pelo lado oposto ao trânsito e fique atrás da barreira, se houver.",
  "Call for roadside help.": "Chame o socorro na estrada.",
  "Have you noticed smoke, a burning smell, an unusual noise, or a change in how the car drives?": "Você notou fumaça, cheiro de queimado, um barulho estranho ou uma mudança na direção do carro?",
  "What you have just described matters more than the lamp. Stop somewhere safe, switch the engine off, and call for help — whatever this reading says.": "O que você acabou de descrever importa mais do que a luz. Pare num lugar seguro, desligue o motor e chame ajuda, seja qual for este resultado.",
  "This is why the verdict above changed: what you can see and hear outranks what the lamp shows.": "Foi por isso que o veredito acima mudou: o que você vê e ouve pesa mais do que a luz mostra.",
  "Then this reading stands. If anything changes while you drive, stop.": "Então este resultado continua valendo. Se algo mudar enquanto dirige, pare.",
  "This reading is from the lamp alone. If you see smoke, smell burning, hear an unusual noise, or the car handles differently — stop, whatever this says.": "Este resultado vem apenas da luz. Se você vir fumaça, sentir cheiro de queimado, ouvir um barulho estranho ou o carro responder diferente, pare, seja qual for este resultado.",
};

export default t;
