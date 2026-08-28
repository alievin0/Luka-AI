/**
 * Türkçe — the lines a driver acts on.
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
  "Stop the car now": "Aracı şimdi durdurun",
  "Keep going, carefully": "Dikkatli şekilde devam edebilirsiniz",
  "No need to stop": "Durmanıza gerek yok",
  "Do not move the car": "Aracı hareket ettirmeyin",
  "Leaving it where it is does less harm than driving it.": "Onu olduğu yerde bırakmak, sürmekten daha az zarar verir.",
  "Move only to somewhere safe": "Yalnızca güvenli bir yere kadar ilerleyin",
  "Do not continue the journey. Get off the carriageway and stop.": "Yolculuğa devam etmeyin. Şeritten çıkın ve durun.",
  "You can continue, carefully": "Dikkatli şekilde devam edebilirsiniz",
  "Ease off the speed and book a check soon.": "Hızınızı düşürün ve en kısa sürede kontrol ettirin.",
  "Keep an eye on it": "Takipte kalın",
  "Nothing to change right now.": "Şu an değiştirilecek bir şey yok.",
  "Are you somewhere safe?": "Güvenli bir yerde misiniz?",
  "Yes": "Evet",
  "No": "Hayır",
  "Good. Switch the engine off and stay clear of moving traffic.": "İyi. Motoru kapatın ve trafikten uzak durun.",
  "Turn your hazard lights on now.": "Dörtlüleri şimdi yakın.",
  "Ease over to the hard shoulder or the nearest exit — no sudden braking.": "Yavaşça emniyet şeridine veya en yakın çıkışa geçin; ani fren yapmayın.",
  "Stop as far from moving traffic as you can.": "Trafikten olabildiğince uzakta durun.",
  "Get out on the side away from traffic, and stand behind the barrier if there is one.": "Trafiğin karşı tarafından inin ve varsa bariyerin arkasında durun.",
  "Call for roadside help.": "Yol yardımı çağırın.",
  "Have you noticed smoke, a burning smell, an unusual noise, or a change in how the car drives?": "Duman, yanık kokusu, olağandışı bir ses veya aracın sürüşünde bir değişiklik fark ettiniz mi?",
  "What you have just described matters more than the lamp. Stop somewhere safe, switch the engine off, and call for help — whatever this reading says.": "Az önce anlattığınız şey, gösterge ışığından daha önemlidir. Güvenli bir yerde durun, motoru kapatın ve yardım çağırın; burada ne yazarsa yazsın.",
  "This is why the verdict above changed: what you can see and hear outranks what the lamp shows.": "Yukarıdaki karar bu yüzden değişti: gördüğünüz ve duyduğunuz şey, ışığın gösterdiğinden önce gelir.",
  "Then this reading stands. If anything changes while you drive, stop.": "O hâlde bu sonuç geçerlidir. Sürüş sırasında bir şey değişirse durun.",
  "This reading is from the lamp alone. If you see smoke, smell burning, hear an unusual noise, or the car handles differently — stop, whatever this says.": "Bu sonuç yalnızca gösterge ışığına dayanır. Duman görürseniz, yanık kokusu alırsanız, olağandışı bir ses duyarsanız veya araç farklı davranırsa, burada ne yazarsa yazsın durun.",
};

export default t;
