/**
 * Español — the lines a driver acts on.
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
  "Stop the car now": "Detenga el coche ahora",
  "Keep going, carefully": "Puede seguir, con precaución",
  "No need to stop": "No hace falta detenerse",
  "Do not move the car": "No mueva el coche",
  "Leaving it where it is does less harm than driving it.": "Dejarlo donde está hace menos daño que conducirlo.",
  "Move only to somewhere safe": "Muévalo solo hasta un lugar seguro",
  "Do not continue the journey. Get off the carriageway and stop.": "No continúe el viaje. Salga de la calzada y deténgase.",
  "You can continue, carefully": "Puede continuar, con precaución",
  "Ease off the speed and book a check soon.": "Reduzca la velocidad y pida una revisión pronto.",
  "Keep an eye on it": "Manténgalo vigilado",
  "Nothing to change right now.": "No hay nada que cambiar ahora mismo.",
  "Are you somewhere safe?": "¿Está en un lugar seguro?",
  "Yes": "Sí",
  "No": "No",
  "Good. Switch the engine off and stay clear of moving traffic.": "Bien. Apague el motor y manténgase lejos del tráfico.",
  "Turn your hazard lights on now.": "Encienda las luces de emergencia ahora.",
  "Ease over to the hard shoulder or the nearest exit — no sudden braking.": "Diríjase despacio al arcén o a la salida más cercana, sin frenar de golpe.",
  "Stop as far from moving traffic as you can.": "Deténgase lo más lejos posible del tráfico.",
  "Get out on the side away from traffic, and stand behind the barrier if there is one.": "Salga por el lado opuesto al tráfico y colóquese detrás de la barrera si la hay.",
  "Call for roadside help.": "Llame a la asistencia en carretera.",
  "Have you noticed smoke, a burning smell, an unusual noise, or a change in how the car drives?": "¿Ha notado humo, olor a quemado, un ruido extraño o un cambio en la conducción?",
  "What you have just described matters more than the lamp. Stop somewhere safe, switch the engine off, and call for help — whatever this reading says.": "Lo que acaba de describir importa más que el testigo. Deténgase en un lugar seguro, apague el motor y pida ayuda, diga lo que diga este resultado.",
  "This is why the verdict above changed: what you can see and hear outranks what the lamp shows.": "Por eso ha cambiado el veredicto de arriba: lo que usted ve y oye pesa más que lo que muestra el testigo.",
  "Then this reading stands. If anything changes while you drive, stop.": "Entonces este resultado se mantiene. Si algo cambia mientras conduce, deténgase.",
  "This reading is from the lamp alone. If you see smoke, smell burning, hear an unusual noise, or the car handles differently — stop, whatever this says.": "Este resultado se basa solo en el testigo. Si ve humo, huele a quemado, oye un ruido extraño o el coche responde de otra forma, deténgase, diga lo que diga esto.",
};

export default t;
