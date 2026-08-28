import { L } from "../i18n";
import type { ProgramPack, ProgramItem, Session } from "./types";

/* A 4-week home plan built for women who train in a bedroom or living room:
 * no equipment, no jumping (downstairs neighbours, and joints), no music
 * required, and every cue written so it can be followed without watching a
 * video — which matters when someone trains with the phone face-down.
 *
 * The mistakes list on each movement is the part a free YouTube video does
 * not give you, and it is why this is worth a subscription.
 */

const m = (
  id: string,
  name: { en: string; ar: string },
  timing: { seconds?: number; reps?: number },
  restSeconds: number,
  cues: { en: string; ar: string }[],
  mistakes: { en: string; ar: string }[],
): ProgramItem => ({ id, name, ...timing, restSeconds, cues, mistakes });

/* ---------------------------------------------------------------- movements */

const WARMUP = [
  m("march", L("Marching in place", "مشي بالمكان"), { seconds: 45 }, 10,
    [L("Stand tall with your shoulders back", "قفي مستقيمة والكتفان إلى الخلف"), L("Lift each knee to waist height", "ارفعي كل ركبة لمستوى الخصر"), L("Breathe steadily — in through the nose, out through the mouth", "تنفّسي بانتظام — شهيق من الأنف وزفير من الفم")],
    [L("Don't lean forward at the waist", "لا تحني ظهرك للأمام"), L("Don't rush — this is a warm-up, not a workout", "لا تتسرّعي — الهدف إحماء لا إجهاد")]),
  m("arm-circles", L("Shoulder circles", "تدوير الأكتاف"), { seconds: 30 }, 10,
    [L("Extend your arms out to the sides", "افردي ذراعيك على الجانبين"), L("Small circles forward for 15 seconds", "أديري دوائر صغيرة إلى الأمام 15 ثانية"), L("Then backward for 15 seconds", "ثم إلى الخلف 15 ثانية")],
    [L("Don't let your shoulders creep toward your ears", "لا ترفعي كتفيك حتى أذنيك")]),
  m("hip-circles", L("Hip circles", "تدوير الحوض"), { seconds: 30 }, 10,
    [L("Hands on your hips, feet shoulder-width apart", "ضعي يديك على خصرك والقدمان بعرض الكتفين"), L("Circle your hips slowly and widely", "أديري حوضك بدائرة واسعة بطيئة")],
    [L("Don't over-arch your lower back", "لا تقوّسي أسفل ظهرك بشكل مبالغ")]),
  m("cat-cow", L("Cat–cow", "تقويس الظهر"), { seconds: 40 }, 10,
    [L("Come onto all fours, hands under your shoulders", "انزلي على أربع، واليدان تحت الكتفين"), L("Inhale as you drop your belly and lift your head", "مع الشهيق أنزلي بطنك وارفعي رأسك"), L("Exhale as you round your spine upward", "مع الزفير قوّسي ظهرك إلى الأعلى")],
    [L("Don't lock your elbows", "لا تقفلي مرفقيك بقوة"), L("Move from your spine, not your neck", "اجعلي الحركة من الظهر لا من الرقبة")]),
];

const CORE = [
  m("dead-bug", L("Dead bug", "الحشرة الميتة"), { reps: 12 }, 30,
    [L("Lie on your back, arms up, knees bent to 90 degrees", "استلقي على ظهرك، والذراعان إلى الأعلى والركبتان مثنيتان 90 درجة"),
     L("Lower your right arm overhead and extend your left leg", "أنزلي ذراعك اليمنى خلف رأسك ومدّي ساقك اليسرى"),
     L("Return slowly and switch sides", "أعيديهما ببطء وبدّلي الجهة"),
     L("Your lower back stays pressed to the floor throughout", "يجب أن يبقى ظهرك ملتصقاً بالأرض طوال الوقت")],
    [L("Letting the lower back lift off the floor — the biggest error, and it cancels the exercise", "ارتفاع أسفل الظهر عن الأرض — أهم خطأ، ويُلغي فائدة التمرين"),
     L("Holding your breath — breathe with every rep", "حبس النفس — تنفّسي مع كل حركة")]),
  m("glute-bridge", L("Glute bridge", "جسر المؤخرة"), { reps: 15 }, 30,
    [L("Lie on your back, knees bent, feet flat", "استلقي على ظهرك، والركبتان مثنيتان والقدمان على الأرض"),
     L("Drive through your heels and lift your hips", "اضغطي بكعبيك وارفعي حوضك إلى الأعلى"),
     L("Squeeze your glutes for a second at the top", "اضغطي عضلات المؤخرة ثانية في الأعلى"),
     L("Lower slowly without fully touching down", "أنزلي ببطء دون أن تلمسي الأرض تماماً")],
    [L("Pushing through your toes instead of your heels", "الدفع بأصابع القدم بدل الكعب"), L("Arching the lower back instead of squeezing the glutes", "تقويس أسفل الظهر بدل عصر المؤخرة")]),
  m("bird-dog", L("Bird dog", "الطائر والكلب"), { reps: 12 }, 30,
    [L("On all fours with a flat back", "على أربع، الظهر مستقيم"),
     L("Extend your right arm forward and your left leg back together", "مدّي ذراعك اليمنى إلى الأمام وساقك اليسرى إلى الخلف في الوقت نفسه"),
     L("Hold two seconds, then return", "اثبتي ثانيتين ثم عودي"),
     L("Switch sides", "بدّلي الجهة")],
    [L("Letting the hips rotate — keep them square to the floor", "التفاف الحوض جانباً — اجعلي حوضك موازياً للأرض"),
     L("Lifting the leg above hip level", "رفع الساق أعلى من مستوى الحوض")]),
  m("plank", L("Forearm plank", "البلانك"), { seconds: 30 }, 40,
    [L("Rest on your forearms and toes", "ارتكزي على ساعديك وأصابع قدميك"),
     L("Body in a straight line from shoulder to heel", "جسمك خط مستقيم من الكتف إلى الكعب"),
     L("Brace your abs and squeeze your glutes", "شدّي بطنك ومؤخرتك"),
     L("Breathe calmly — don't hold your breath", "تنفّسي بهدوء ولا تحبسي أنفاسك")],
    [L("Piking the hips up — it makes it easier and removes the benefit", "رفع المؤخرة إلى الأعلى — يسهّل التمرين ويُلغي فائدته"),
     L("Letting the hips sag — this strains the lower back", "نزول الحوض وتقويس الظهر — يؤذي أسفل الظهر")]),
  m("heel-taps", L("Heel taps", "لمس الكعب"), { reps: 20 }, 30,
    [L("Lie down, knees bent, head slightly lifted", "استلقي، والركبتان مثنيتان والرأس مرفوعة قليلاً"),
     L("Reach right and tap your right heel", "أميلي إلى اليمين وألمسي كعبك الأيمن بيدك"),
     L("Then reach left", "ثم إلى اليسار")],
    [L("Pulling on your neck with your hands", "شد الرقبة باليدين"), L("Rushing without control", "الحركة السريعة بدون تحكم")]),
];

const LOWER = [
  m("squat", L("Bodyweight squat", "السكوات"), { reps: 15 }, 40,
    [L("Feet shoulder-width, toes turned slightly out", "القدمان بعرض الكتفين وأصابع القدمين إلى الخارج قليلاً"),
     L("Sit back as if lowering onto a chair — hips travel backward", "انزلي كأنك تجلسين على كرسي — المؤخرة إلى الخلف"),
     L("Keep your chest up and knees tracking over your toes", "اجعلي صدرك مرفوعاً وركبتيك باتجاه أصابع قدميك"),
     L("Go until your thighs are parallel to the floor if you can", "انزلي حتى يوازي فخذك الأرض إن استطعتِ")],
    [L("Knees caving inward — the most common error and the hardest on your knees", "دخول الركبتين إلى الداخل — أشهر خطأ وأخطره على الركبة"),
     L("Heels lifting off the floor", "رفع الكعبين عن الأرض"), L("Rounding forward through the back", "انحناء الظهر للأمام")]),
  m("lunge", L("Reverse lunge", "الطعن"), { reps: 12 }, 40,
    [L("Take a long step backward with one leg", "خطوة كبيرة إلى الخلف بساق واحدة"),
     L("Lower until both knees reach 90 degrees", "انزلي حتى تصبح الركبتان بزاوية 90 درجة"),
     L("Push through the front heel to return", "ادفعي بالكعب الأمامي للعودة"),
     L("Alternate legs each rep", "بدّلي الساق مع كل تكرار")],
    [L("Stepping too short — it loads the knee", "الخطوة القصيرة — تُحمّل الركبة"),
     L("Leaning forward instead of dropping straight down", "ميلان الجسم للأمام بدل النزول عمودي")]),
  m("wall-sit", L("Wall sit", "الجلوس على الحائط"), { seconds: 40 }, 40,
    [L("Lean your back on the wall and slide into a seated position", "استندي بظهرك إلى الحائط وانزلي إلى وضعية الجلوس"),
     L("Thighs parallel to the floor, knees at 90 degrees", "الفخذ موازٍ للأرض والركبة بزاوية 90 درجة"),
     L("Keep your whole back flat against the wall", "الظهر ملتصق بالحائط تماماً")],
    [L("Not sinking to 90 degrees", "النزول أقل من 90 درجة"), L("Resting your hands on your thighs", "الاستناد باليدين على الفخذين")]),
  m("side-leg", L("Side leg raise", "رفع الساق الجانبي"), { reps: 15 }, 30,
    [L("Lie on your side, body in a straight line", "استلقي على جنبك، والجسم في خط مستقيم"),
     L("Raise the top leg slowly as high as is comfortable", "ارفعي ساقك العليا ببطء إلى أعلى نقطة مريحة"),
     L("Lower slowly without resting it on the other leg", "أنزليها ببطء دون أن تلمس الساق الأخرى")],
    [L("Rolling the hips backward", "التفاف الحوض إلى الخلف"), L("Using momentum instead of the muscle", "استخدام الزخم بدل العضلة")]),
  m("clamshell", L("Clamshell", "المحارة"), { reps: 15 }, 30,
    [L("Lie on your side with knees bent", "استلقي على جنبك والركبتان مثنيتان"),
     L("Keep your heels together and open the top knee", "اجعلي كعبيك ملتصقين وافتحي الركبة العليا إلى الأعلى"),
     L("Squeeze the side glute at the top", "اضغطي المؤخرة الجانبية في الأعلى")],
    [L("Rocking the hips back to make it easier", "إمالة الحوض إلى الخلف لتسهيل الحركة")]),
];

const UPPER = [
  m("knee-pushup", L("Knee push-up", "ضغط على الركبتين"), { reps: 10 }, 40,
    [L("On your knees, hands slightly wider than your shoulders", "على الركبتين، واليدان أوسع من الكتفين قليلاً"),
     L("Straight line from knees to head", "جسمك خط مستقيم من الركبة إلى الرأس"),
     L("Lower until your chest is close to the floor", "انزلي حتى يقترب صدرك من الأرض"),
     L("Press back up", "ادفعي إلى الأعلى")],
    [L("Letting the hips sag", "نزول الحوض"), L("Flaring the elbows out to 90 degrees — this strains the shoulder", "فتح المرفقين 90 درجة عن الجسم — يؤذي الكتف")]),
  m("wall-pushup", L("Wall push-up", "ضغط على الحائط"), { reps: 12 }, 30,
    [L("Stand a step from the wall and place your hands on it", "قفي على بعد خطوة من الحائط واسندي يديك عليه"),
     L("Lower your chest toward the wall", "قرّبي صدرك من الحائط"),
     L("Press back", "ادفعي للعودة")],
    [L("Letting your feet move", "تحريك القدمين"), L("Bending at the waist instead of moving as one unit", "ثني الخصر بدل الجسم كله")]),
  m("superman", L("Superman hold", "السوبرمان"), { seconds: 30 }, 30,
    [L("Lie face down, arms extended forward", "استلقي على بطنك والذراعان ممدودتان إلى الأمام"),
     L("Lift your arms, chest and legs off the floor", "ارفعي ذراعيك وصدرك وساقيك عن الأرض"),
     L("Hold and keep breathing", "اثبتي وتنفّسي")],
    [L("Craning the head too high — it strains the neck", "رفع الرأس أكثر من اللازم — يشدّ الرقبة")]),
  m("arm-pulse", L("Arm pulses", "نبضات الذراع"), { seconds: 40 }, 30,
    [L("Extend your arms to the sides at shoulder height", "افردي ذراعيك على الجانبين بمستوى الكتف"),
     L("Small fast pulses up and down", "نبضات صغيرة سريعة إلى الأعلى والأسفل"),
     L("Keep your shoulders down away from your ears", "أبعدي كتفيك عن أذنيك")],
    [L("Letting your arms drop below shoulder height", "إنزال الذراعين تحت مستوى الكتف")]),
];

const COOLDOWN = [
  m("hamstring", L("Hamstring stretch", "إطالة خلف الفخذ"), { seconds: 40 }, 5,
    [L("Sit and extend one leg", "اجلسي وافردي ساقاً واحدة"), L("Hinge forward from the hips", "أميلي إلى الأمام من الحوض"), L("Hold where you feel a gentle stretch", "توقفي عند الموضع الذي تشعرين فيه بشدّ خفيف")],
    [L("Stretching into pain — a stretch should never hurt", "الشدّ حتى الألم — الإطالة يجب ألّا تؤلم")]),
  m("child-pose", L("Child's pose", "وضعية الطفل"), { seconds: 45 }, 5,
    [L("Sit back on your heels and fold forward", "اجلسي على كعبيك وأميلي بجسمك إلى الأمام"), L("Extend your arms along the floor", "افردي ذراعيك على الأرض"), L("Breathe deeply", "تنفّسي بعمق")],
    [L("Holding your breath", "حبس النفس")]),
  m("hip-flexor", L("Hip flexor stretch", "إطالة مثنية الفخذ"), { seconds: 40 }, 5,
    [L("Drop into a half-kneeling position", "انزلي إلى وضعية ركبة على الأرض"), L("Gently push your hips forward", "ادفعي حوضك للأمام برفق"), L("Squeeze the glute of the kneeling leg", "اضغطي مؤخرة الساق التي على الأرض")],
    [L("Arching the lower back instead of driving the hips", "تقويس أسفل الظهر بدل دفع الحوض")]),
];

/* ----------------------------------------------------------------- sessions */

const s = (
  id: string,
  title: { en: string; ar: string },
  subtitle: { en: string; ar: string },
  minutes: number,
  level: Session["level"],
  focus: { en: string; ar: string },
  items: ProgramItem[],
): Session => ({ id, title, subtitle, minutes, level, focus, items });

export const WOMENSFIT_SESSIONS: Session[] = [
  s("d1", L("An easy start", "البداية اللطيفة"), L("Day one — get a feel for it", "اليوم الأول — تعرّفي على جسمك"), 12, "beginner", L("Full body", "الجسم كامل"),
    [...WARMUP.slice(0, 3), CORE[1], LOWER[0], UPPER[1], COOLDOWN[1]]),
  s("d2", L("Core and waist", "بطن وخصر"), L("Strengthen your midsection without loading your back", "شدّ عضلات الوسط بدون ضغط على الظهر"), 15, "beginner", L("Core", "البطن"),
    [...WARMUP.slice(0, 2), CORE[0], CORE[1], CORE[4], CORE[3], COOLDOWN[1]]),
  s("d3", L("Legs and glutes", "أرجل ومؤخرة"), L("Your biggest muscles, your biggest burn", "أكبر عضلات الجسم — أكبر حرق"), 18, "beginner", L("Legs", "الأرجل"),
    [...WARMUP.slice(1, 3), LOWER[0], LOWER[3], LOWER[4], LOWER[2], COOLDOWN[0]]),
  s("d4", L("Upper body", "الجزء العلوي"), L("Arms and back with no weights", "ذراعين وظهر بدون أوزان"), 15, "beginner", L("Upper body", "الجزء العلوي"),
    [WARMUP[1], WARMUP[3], UPPER[1], UPPER[3], UPPER[2], COOLDOWN[1]]),
  s("d5", L("Full body", "الجسم كامل"), L("Everything in one session", "كل شيء في جلسة واحدة"), 20, "intermediate", L("Full body", "الجسم كامل"),
    [...WARMUP.slice(0, 3), LOWER[0], UPPER[0], CORE[3], LOWER[1], COOLDOWN[1]]),
  s("d6", L("Core strength", "قوة الوسط"), L("Planks and stability", "بلانك وثبات"), 18, "intermediate", L("Core", "البطن"),
    [WARMUP[0], WARMUP[3], CORE[3], CORE[2], CORE[0], CORE[4], COOLDOWN[2]]),
  s("d7", L("Legs, level up", "أرجل متقدم"), L("A little more intensity", "نزيد الشدّة قليلاً"), 22, "intermediate", L("Legs", "الأرجل"),
    [...WARMUP.slice(0, 3), LOWER[0], LOWER[1], LOWER[2], LOWER[3], LOWER[4], COOLDOWN[0]]),
  s("d8", L("Stretch and recover", "إطالة واسترخاء"), L("An easy day — your body builds while it rests", "يوم خفيف — الجسم يُبنى في أثناء الراحة"), 10, "beginner", L("Recovery", "استرخاء"),
    [WARMUP[2], WARMUP[3], ...COOLDOWN]),
  s("d9", L("Burn without jumping", "حرق بدون قفز"), L("High intensity, zero noise", "شدّة عالية دون أي ضجيج"), 20, "intermediate", L("Full body", "الجسم كامل"),
    [...WARMUP.slice(0, 3), LOWER[2], CORE[1], UPPER[0], LOWER[1], CORE[3], COOLDOWN[1]]),
  s("d10", L("The full session", "الجلسة الكاملة"), L("End of week four", "نهاية الأسبوع الرابع"), 25, "advanced", L("Full body", "الجسم كامل"),
    [...WARMUP, LOWER[0], LOWER[1], UPPER[0], CORE[3], CORE[2], LOWER[2], ...COOLDOWN.slice(0, 2)]),
];

export const womensfit: ProgramPack = {
  kind: "program",
  id: "womensfit",
  appName: L("Home Workouts", "تمارين البيت"),
  tagline: L("No equipment, no jumping — a workout that fits in your bedroom", "تمارين منزلية دون معدّات ودون قفز — في غرفتك وعلى راحتك"),
  accent: "#C9738F",
  nouns: { session: L("workout", "تمرين"), item: L("move", "حركة"), plan: L("plan", "الخطة") },
  disclaimer:
    L("These are general exercises, not a medical programme. If you are pregnant, recently postpartum, injured, in chronic pain, or managing a health condition, talk to your doctor before starting. Stop immediately if you feel sharp pain, dizziness or shortness of breath.", "هذه تمارين عامة وليست برنامجاً طبياً. إن كنتِ حاملاً أو في فترة ما بعد الولادة أو لديكِ إصابة أو ألم مزمن أو حالة صحية، فاستشيري طبيبك قبل البدء. وتوقفي فوراً إن شعرتِ بألم حاد أو دوار أو ضيق في التنفس."),
  onboarding: [
    { key: "goal", question: L("What are you after?", "ما هدفك؟"),
      options: [L("Lose weight and tone up", "أن أنحف وأشدّ جسمي"), L("Get stronger", "أن أقوّي عضلاتي"), L("Ease my back pain", "أن أتخلص من ألم الظهر"), L("Build a routine and stick to it", "أن أبدأ روتيناً وألتزم به")] },
    { key: "level", question: L("Where are you starting from?", "ما مستواك حالياً؟"),
      options: [L("I don't exercise at all", "لا أتمرّن إطلاقاً"), L("I exercise now and then", "أتمرّن أحياناً"), L("I exercise regularly", "أتمرّن بانتظام")] },
    { key: "time", question: L("How much time do you have a day?", "كم من الوقت لديك يومياً؟"),
      options: [L("10 minutes", "10 دقائق"), L("15–20 minutes", "15–20 دقيقة"), L("Half an hour or more", "نصف ساعة أو أكثر")] },
    { key: "constraint", question: L("Anything we should work around?", "هل هناك ما يجب الانتباه له؟"),
      options: [L("I can't jump — neighbours below", "لا أستطيع القفز (الجيران في الأسفل)"), L("My knees bother me", "لديّ ألم في الركبة"), L("My back bothers me", "لديّ ألم في الظهر"), L("Nothing", "لا شيء")] },
  ],
  paywall: {
    headline: L("A four-week plan, in your room, with nothing but you", "خطة أربعة أسابيع — في غرفتك ودون معدّات"),
    bullets: [
      L("10 full workouts, 10 to 25 minutes each", "10 تمارين كاملة من 10 إلى 25 دقيقة"),
      L("No jumping, no noise — made for apartments", "دون قفز ودون ضجيج — مناسبة للشقق"),
      L("Every move explained, plus the mistakes people make", "شرح كل حركة بالعربية مع الأخطاء الشائعة"),
      L("A day streak that keeps you coming back", "عدّاد أيام متواصلة يساعدك على الالتزام"),
    ],
  },
  pricing: {
    entitlement: "pro",
    defaultProductId: "annual",
    products: [
      { id: "weekly", label: L("Weekly", "أسبوعي"), fallbackPrice: "$5.99", period: L("week", "أسبوع"), storeTrialDays: 7 },
      { id: "annual", label: L("Yearly", "سنوي"), fallbackPrice: "$34.99", period: L("year", "سنة"), note: L("Under $0.68 a week", "أقل من $0.68 أسبوعياً"), badge: L("Best value", "الأوفر") },
    ],
  },
  plan: { weeks: 4, daysPerWeek: 4, promise: L("Four weeks, four times a week, 10 to 25 minutes", "أربعة أسابيع، أربع مرات أسبوعياً، من 10 إلى 25 دقيقة") },
  sessions: WOMENSFIT_SESSIONS,
  tips: [
    L("Consistency beats intensity. Ten minutes daily does more than one hour a week.", "الالتزام أهم من الشدة. تمرين 10 دقائق كل يوم أفضل من ساعة مرة بالأسبوع."),
    L("Drink water half an hour before you train, not during.", "اشربي الماء قبل التمرين بنصف ساعة، لا في أثنائه."),
    L("Sore muscles a day or two later is normal. Sharp pain during a move is not — stop.", "ألم العضلات بعد يومين أمر طبيعي، أما الألم الحاد في أثناء التمرين فليس كذلك — توقفي."),
    L("You'll see it in the mirror before the scale. Muscle is denser than fat, so the scale lies.", "تظهر النتيجة في المرآة قبل الميزان، لأن العضلة أثقل من الدهون."),
    L("Missed a day? Pick up tomorrow. There's no need to start over.", "إن فاتك يوم، فأكملي في الغد، ولا داعي للبدء من الصفر."),
    L("Breathing matters more than you'd think — exhale on the effort, inhale on the return.", "التنفّس أهم مما تتوقعين — الزفير مع الجهد والشهيق مع العودة."),
    L("Under six hours of sleep erases most of what training gives you.", "النوم أقل من 6 ساعات يوقف نتائج التمرين تقريباً."),
  ],
};
