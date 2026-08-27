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
    [L("Stand tall with your shoulders back", "اوقفي مستقيمة والكتفين للورا"), L("Lift each knee to waist height", "ارفعي كل ركبة لمستوى الخصر"), L("Breathe steadily — in through the nose, out through the mouth", "تنفّسي بانتظام — شهيق من الأنف وزفير من الفم")],
    [L("Don't lean forward at the waist", "لا تحني ظهرك للأمام"), L("Don't rush — this is a warm-up, not a workout", "لا تسرّعي — الهدف تسخين مش تعب")]),
  m("arm-circles", L("Shoulder circles", "تدوير الأكتاف"), { seconds: 30 }, 10,
    [L("Extend your arms out to the sides", "افردي ذراعيك على الجانبين"), L("Small circles forward for 15 seconds", "دوّري دوائر صغيرة للأمام 15 ثانية"), L("Then backward for 15 seconds", "بعدين للورا 15 ثانية")],
    [L("Don't let your shoulders creep toward your ears", "لا ترفعي كتفيك لعند أذنيك")]),
  m("hip-circles", L("Hip circles", "تدوير الحوض"), { seconds: 30 }, 10,
    [L("Hands on your hips, feet shoulder-width apart", "حطي يديك على خصرك والقدمين بعرض الكتفين"), L("Circle your hips slowly and widely", "دوّري حوضك بدائرة واسعة وبطيئة")],
    [L("Don't over-arch your lower back", "لا تقوّسي أسفل ظهرك بشكل مبالغ")]),
  m("cat-cow", L("Cat–cow", "تقويس الظهر"), { seconds: 40 }, 10,
    [L("Come onto all fours, hands under your shoulders", "انزلي على أربع، اليدين تحت الكتفين"), L("Inhale as you drop your belly and lift your head", "مع الشهيق نزّلي بطنك وارفعي رأسك"), L("Exhale as you round your spine upward", "مع الزفير قوّسي ظهرك لفوق")],
    [L("Don't lock your elbows", "لا تقفلي مرفقيك بقوة"), L("Move from your spine, not your neck", "خلّي الحركة من الظهر مش من الرقبة")]),
];

const CORE = [
  m("dead-bug", L("Dead bug", "الحشرة الميتة"), { reps: 12 }, 30,
    [L("Lie on your back, arms up, knees bent to 90 degrees", "استلقي على ظهرك، الذراعين لفوق والركبتين مثنيتين 90 درجة"),
     L("Lower your right arm overhead and extend your left leg", "نزّلي ذراعك اليمنى وراء رأسك ومدّي رجلك اليسرى"),
     L("Return slowly and switch sides", "رجّعي ببطء وبدّلي الجهة"),
     L("Your lower back stays pressed to the floor throughout", "ظهرك لازم يضل ملتصق بالأرض طول الوقت")],
    [L("Letting the lower back lift off the floor — the biggest error, and it cancels the exercise", "ارتفاع أسفل الظهر عن الأرض — أهم غلط، وبيلغي فايدة التمرين"),
     L("Holding your breath — breathe with every rep", "حبس النفس — تنفّسي مع كل حركة")]),
  m("glute-bridge", L("Glute bridge", "جسر المؤخرة"), { reps: 15 }, 30,
    [L("Lie on your back, knees bent, feet flat", "استلقي على ظهرك، الركبتين مثنيتين والقدمين على الأرض"),
     L("Drive through your heels and lift your hips", "اضغطي بكعبيك وارفعي حوضك لفوق"),
     L("Squeeze your glutes for a second at the top", "اعصري عضلات المؤخرة ثانية بالأعلى"),
     L("Lower slowly without fully touching down", "نزّلي ببطء بدون ما تلمسي الأرض تماماً")],
    [L("Pushing through your toes instead of your heels", "الدفع بأصابع القدم بدل الكعب"), L("Arching the lower back instead of squeezing the glutes", "تقويس أسفل الظهر بدل عصر المؤخرة")]),
  m("bird-dog", L("Bird dog", "الطائر والكلب"), { reps: 12 }, 30,
    [L("On all fours with a flat back", "على أربع، الظهر مستقيم"),
     L("Extend your right arm forward and your left leg back together", "مدّي ذراعك اليمنى للأمام ورجلك اليسرى للورا بنفس الوقت"),
     L("Hold two seconds, then return", "ثبّتي ثانيتين وارجعي"),
     L("Switch sides", "بدّلي الجهة")],
    [L("Letting the hips rotate — keep them square to the floor", "لف الحوض للجنب — خلّي حوضك موازي للأرض"),
     L("Lifting the leg above hip level", "رفع الرجل أعلى من مستوى الحوض")]),
  m("plank", L("Forearm plank", "البلانك"), { seconds: 30 }, 40,
    [L("Rest on your forearms and toes", "ارتكزي على ساعديك وأصابع قدميك"),
     L("Body in a straight line from shoulder to heel", "جسمك خط مستقيم من الكتف للكعب"),
     L("Brace your abs and squeeze your glutes", "شدّي بطنك ومؤخرتك"),
     L("Breathe calmly — don't hold your breath", "تنفّسي بهدوء ولا تحبسي نفسك")],
    [L("Piking the hips up — it makes it easier and removes the benefit", "رفع المؤخرة لفوق — بيسهّل التمرين ويلغي فايدته"),
     L("Letting the hips sag — this strains the lower back", "نزول الحوض وتقويس الظهر — بيأذي أسفل الظهر")]),
  m("heel-taps", L("Heel taps", "لمس الكعب"), { reps: 20 }, 30,
    [L("Lie down, knees bent, head slightly lifted", "استلقي، الركبتين مثنيتين والرأس مرفوعة قليلاً"),
     L("Reach right and tap your right heel", "ميلي لليمين ولمسي كعبك اليمين بيدك"),
     L("Then reach left", "بعدين لليسار")],
    [L("Pulling on your neck with your hands", "شد الرقبة باليدين"), L("Rushing without control", "الحركة السريعة بدون تحكم")]),
];

const LOWER = [
  m("squat", L("Bodyweight squat", "السكوات"), { reps: 15 }, 40,
    [L("Feet shoulder-width, toes turned slightly out", "القدمين بعرض الكتفين وأصابع القدم للخارج شوي"),
     L("Sit back as if lowering onto a chair — hips travel backward", "انزلي كأنك بتقعدي على كرسي — المؤخرة للورا"),
     L("Keep your chest up and knees tracking over your toes", "خلّي صدرك مرفوع وركبتيك باتجاه أصابع قدميك"),
     L("Go until your thighs are parallel to the floor if you can", "انزلي لحد ما فخذك يوازي الأرض إذا بتقدري")],
    [L("Knees caving inward — the most common error and the hardest on your knees", "دخول الركبتين لجوا — أشهر غلط وأخطرها على الركبة"),
     L("Heels lifting off the floor", "رفع الكعبين عن الأرض"), L("Rounding forward through the back", "انحناء الظهر للأمام")]),
  m("lunge", L("Reverse lunge", "الطعن"), { reps: 12 }, 40,
    [L("Take a long step backward with one leg", "خطوة كبيرة للورا برجل وحدة"),
     L("Lower until both knees reach 90 degrees", "انزلي لحد ما الركبتين 90 درجة"),
     L("Push through the front heel to return", "ادفعي بالكعب الأمامي للرجوع"),
     L("Alternate legs each rep", "بدّلي الرجل كل تكرار")],
    [L("Stepping too short — it loads the knee", "الخطوة القصيرة — بتحمّل الركبة"),
     L("Leaning forward instead of dropping straight down", "ميلان الجسم للأمام بدل النزول عمودي")]),
  m("wall-sit", L("Wall sit", "القعدة على الحائط"), { seconds: 40 }, 40,
    [L("Lean your back on the wall and slide into a seated position", "استندي بظهرك على الحائط وانزلي لوضعية القعود"),
     L("Thighs parallel to the floor, knees at 90 degrees", "الفخذ موازي للأرض والركبة 90 درجة"),
     L("Keep your whole back flat against the wall", "الظهر ملتصق بالحائط تماماً")],
    [L("Not sinking to 90 degrees", "النزول أقل من 90 درجة"), L("Resting your hands on your thighs", "الاستناد باليدين على الفخذين")]),
  m("side-leg", L("Side leg raise", "رفع الرجل الجانبي"), { reps: 15 }, 30,
    [L("Lie on your side, body in a straight line", "استلقي على جنبك، الجسم بخط مستقيم"),
     L("Raise the top leg slowly as high as is comfortable", "ارفعي رجلك العليا ببطء لأعلى نقطة مريحة"),
     L("Lower slowly without resting it on the other leg", "نزّليها ببطء بدون ما تلمس الرجل التانية")],
    [L("Rolling the hips backward", "لف الحوض للورا"), L("Using momentum instead of the muscle", "استخدام الزخم بدل العضلة")]),
  m("clamshell", L("Clamshell", "المحارة"), { reps: 15 }, 30,
    [L("Lie on your side with knees bent", "استلقي على جنبك والركبتين مثنيتين"),
     L("Keep your heels together and open the top knee", "خلّي كعبيك ملتصقين وافتحي الركبة العليا لفوق"),
     L("Squeeze the side glute at the top", "اعصري المؤخرة الجانبية بالأعلى")],
    [L("Rocking the hips back to make it easier", "لف الحوض للورا لتسهيل الحركة")]),
];

const UPPER = [
  m("knee-pushup", L("Knee push-up", "ضغط على الركبتين"), { reps: 10 }, 40,
    [L("On your knees, hands slightly wider than your shoulders", "على الركبتين، اليدين أوسع من الكتفين شوي"),
     L("Straight line from knees to head", "جسمك خط مستقيم من الركبة للرأس"),
     L("Lower until your chest is close to the floor", "انزلي لحد ما صدرك قريب من الأرض"),
     L("Press back up", "ادفعي لفوق")],
    [L("Letting the hips sag", "نزول الحوض"), L("Flaring the elbows out to 90 degrees — this strains the shoulder", "فتح المرفقين 90 درجة عن الجسم — بيأذي الكتف")]),
  m("wall-pushup", L("Wall push-up", "ضغط على الحائط"), { reps: 12 }, 30,
    [L("Stand a step from the wall and place your hands on it", "اوقفي على بعد خطوة من الحائط واسندي يديك عليه"),
     L("Lower your chest toward the wall", "انزلي بصدرك باتجاه الحائط"),
     L("Press back", "ادفعي للرجوع")],
    [L("Letting your feet move", "تحريك القدمين"), L("Bending at the waist instead of moving as one unit", "ثني الخصر بدل الجسم كله")]),
  m("superman", L("Superman hold", "السوبرمان"), { seconds: 30 }, 30,
    [L("Lie face down, arms extended forward", "استلقي على بطنك والذراعين ممدودين للأمام"),
     L("Lift your arms, chest and legs off the floor", "ارفعي ذراعيك وصدرك ورجليك عن الأرض"),
     L("Hold and keep breathing", "ثبّتي وتنفّسي")],
    [L("Craning the head too high — it strains the neck", "رفع الرأس عالي كتير — بيشد الرقبة")]),
  m("arm-pulse", L("Arm pulses", "نبضات الذراع"), { seconds: 40 }, 30,
    [L("Extend your arms to the sides at shoulder height", "افردي ذراعيك على الجانبين بمستوى الكتف"),
     L("Small fast pulses up and down", "نبضات صغيرة سريعة لفوق ولتحت"),
     L("Keep your shoulders down away from your ears", "خلّي كتفيك بعيدين عن أذنيك")],
    [L("Letting your arms drop below shoulder height", "إنزال الذراعين تحت مستوى الكتف")]),
];

const COOLDOWN = [
  m("hamstring", L("Hamstring stretch", "إطالة خلف الفخذ"), { seconds: 40 }, 5,
    [L("Sit and extend one leg", "اقعدي وافردي رجل وحدة"), L("Hinge forward from the hips", "ميلي للأمام من الحوض"), L("Hold where you feel a gentle stretch", "امسكي المكان اللي بتحسي فيه شد خفيف")],
    [L("Stretching into pain — a stretch should never hurt", "الشد لحد الألم — الإطالة مش لازم توجع")]),
  m("child-pose", L("Child's pose", "وضعية الطفل"), { seconds: 45 }, 5,
    [L("Sit back on your heels and fold forward", "اقعدي على كعبيك وميلي بجسمك للأمام"), L("Extend your arms along the floor", "افردي ذراعيك على الأرض"), L("Breathe deeply", "تنفّسي عميق")],
    [L("Holding your breath", "حبس النفس")]),
  m("hip-flexor", L("Hip flexor stretch", "إطالة مثنية الفخذ"), { seconds: 40 }, 5,
    [L("Drop into a half-kneeling position", "انزلي بوضعية ركبة على الأرض"), L("Gently push your hips forward", "ادفعي حوضك للأمام برفق"), L("Squeeze the glute of the kneeling leg", "اعصري مؤخرة الرجل اللي على الأرض")],
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
  s("d1", L("An easy start", "البداية اللطيفة"), L("Day one — get a feel for it", "أول يوم — تعرّفي على جسمك"), 12, "beginner", L("Full body", "الجسم كامل"),
    [...WARMUP.slice(0, 3), CORE[1], LOWER[0], UPPER[1], COOLDOWN[1]]),
  s("d2", L("Core and waist", "بطن وخصر"), L("Strengthen your midsection without loading your back", "شدّ عضلات الوسط بدون ضغط على الظهر"), 15, "beginner", L("Core", "البطن"),
    [...WARMUP.slice(0, 2), CORE[0], CORE[1], CORE[4], CORE[3], COOLDOWN[1]]),
  s("d3", L("Legs and glutes", "أرجل ومؤخرة"), L("Your biggest muscles, your biggest burn", "أكبر عضلات الجسم — أكبر حرق"), 18, "beginner", L("Legs", "الأرجل"),
    [...WARMUP.slice(1, 3), LOWER[0], LOWER[3], LOWER[4], LOWER[2], COOLDOWN[0]]),
  s("d4", L("Upper body", "الجزء العلوي"), L("Arms and back with no weights", "ذراعين وظهر بدون أوزان"), 15, "beginner", L("Upper body", "الجزء العلوي"),
    [WARMUP[1], WARMUP[3], UPPER[1], UPPER[3], UPPER[2], COOLDOWN[1]]),
  s("d5", L("Full body", "الجسم كامل"), L("Everything in one session", "كل شي بجلسة وحدة"), 20, "intermediate", L("Full body", "الجسم كامل"),
    [...WARMUP.slice(0, 3), LOWER[0], UPPER[0], CORE[3], LOWER[1], COOLDOWN[1]]),
  s("d6", L("Core strength", "قوة الوسط"), L("Planks and stability", "بلانك وثبات"), 18, "intermediate", L("Core", "البطن"),
    [WARMUP[0], WARMUP[3], CORE[3], CORE[2], CORE[0], CORE[4], COOLDOWN[2]]),
  s("d7", L("Legs, level up", "أرجل متقدم"), L("A little more intensity", "نزيد الشدة شوي"), 22, "intermediate", L("Legs", "الأرجل"),
    [...WARMUP.slice(0, 3), LOWER[0], LOWER[1], LOWER[2], LOWER[3], LOWER[4], COOLDOWN[0]]),
  s("d8", L("Stretch and recover", "إطالة واسترخاء"), L("An easy day — your body builds while it rests", "يوم خفيف — الجسم بيبني بالراحة"), 10, "beginner", L("Recovery", "استرخاء"),
    [WARMUP[2], WARMUP[3], ...COOLDOWN]),
  s("d9", L("Burn without jumping", "حرق بدون قفز"), L("High intensity, zero noise", "شدة عالية وضجة صفر"), 20, "intermediate", L("Full body", "الجسم كامل"),
    [...WARMUP.slice(0, 3), LOWER[2], CORE[1], UPPER[0], LOWER[1], CORE[3], COOLDOWN[1]]),
  s("d10", L("The full session", "الجلسة الكاملة"), L("End of week four", "نهاية الأسبوع الرابع"), 25, "advanced", L("Full body", "الجسم كامل"),
    [...WARMUP, LOWER[0], LOWER[1], UPPER[0], CORE[3], CORE[2], LOWER[2], ...COOLDOWN.slice(0, 2)]),
];

export const womensfit: ProgramPack = {
  kind: "program",
  id: "womensfit",
  appName: L("Home Workouts", "تمارين البيت"),
  tagline: L("No equipment, no jumping — a workout that fits in your bedroom", "تمارين بيتية بدون معدات وبدون قفز — بغرفتك وبراحتك"),
  accent: "#C9738F",
  nouns: { session: L("workout", "تمرين"), item: L("move", "حركة"), plan: L("plan", "الخطة") },
  disclaimer:
    L("These are general exercises, not a medical programme. If you are pregnant, recently postpartum, injured, in chronic pain, or managing a health condition, talk to your doctor before starting. Stop immediately if you feel sharp pain, dizziness or shortness of breath.", "هذي تمارين عامة وليست برنامجاً طبياً. إذا كنتِ حامل أو بعد ولادة قريبة أو عندك إصابة أو ألم مزمن أو حالة صحية — استشيري طبيبك قبل ما تبدأي. وقفي فوراً إذا حسيتي بألم حاد أو دوخة أو ضيق نفس."),
  onboarding: [
    { key: "goal", question: L("What are you after?", "شو هدفك؟"),
      options: [L("Lose weight and tone up", "أنحف وأشد جسمي"), L("Get stronger", "أقوّى عضلاتي"), L("Ease my back pain", "أتخلص من ألم الظهر"), L("Build a routine and stick to it", "أبدأ روتين وألتزم فيه")] },
    { key: "level", question: L("Where are you starting from?", "قديش مستواك حالياً؟"),
      options: [L("I don't exercise at all", "ما بتمرن أبداً"), L("I exercise now and then", "بتمرن أحياناً"), L("I exercise regularly", "بتمرن بانتظام")] },
    { key: "time", question: L("How much time do you have a day?", "قديش وقتك باليوم؟"),
      options: [L("10 minutes", "10 دقايق"), L("15–20 minutes", "15–20 دقيقة"), L("Half an hour or more", "نص ساعة أو أكثر")] },
    { key: "constraint", question: L("Anything we should work around?", "في شي لازم ننتبهله؟"),
      options: [L("I can't jump — neighbours below", "ما بقدر أقفز (جيران تحت)"), L("My knees bother me", "عندي ألم بالركبة"), L("My back bothers me", "عندي ألم بالظهر"), L("Nothing", "ما في شي")] },
  ],
  paywall: {
    headline: L("A four-week plan, in your room, with nothing but you", "خطة أربع أسابيع — بغرفتك وبدون معدات"),
    bullets: [
      L("10 full workouts, 10 to 25 minutes each", "10 تمارين كاملة من 10 لـ 25 دقيقة"),
      L("No jumping, no noise — made for apartments", "بدون قفز وبدون ضجة — مناسبة للشقق"),
      L("Every move explained, plus the mistakes people make", "شرح كل حركة بالعربي + الأخطاء الشائعة"),
      L("A day streak that keeps you coming back", "عدّاد أيام متواصلة يخليكي تلتزمي"),
    ],
  },
  pricing: {
    entitlement: "pro",
    defaultProductId: "annual",
    products: [
      { id: "weekly", label: L("Weekly", "أسبوعي"), fallbackPrice: "$5.99", period: L("week", "أسبوع"), trialDays: 7 },
      { id: "annual", label: L("Yearly", "سنوي"), fallbackPrice: "$34.99", period: L("year", "سنة"), note: L("Under $0.68 a week", "أقل من $0.68 بالأسبوع"), badge: L("Best value", "الأوفر") },
    ],
  },
  plan: { weeks: 4, daysPerWeek: 4, promise: L("Four weeks, four times a week, 10 to 25 minutes", "أربع أسابيع، أربع مرات بالأسبوع، من 10 لـ 25 دقيقة") },
  sessions: WOMENSFIT_SESSIONS,
  tips: [
    L("Consistency beats intensity. Ten minutes daily does more than one hour a week.", "الالتزام أهم من الشدة. تمرين 10 دقايق كل يوم أفضل من ساعة مرة بالأسبوع."),
    L("Drink water half an hour before you train, not during.", "اشربي ماء قبل التمرين بنص ساعة، مش خلاله."),
    L("Sore muscles a day or two later is normal. Sharp pain during a move is not — stop.", "وجع العضلات بعد يومين طبيعي. الوجع الحاد أثناء التمرين لأ — وقفي."),
    L("You'll see it in the mirror before the scale. Muscle is denser than fat, so the scale lies.", "النتيجة بتبين بالمرايا قبل الميزان. الميزان بيكذب لأن العضلة أثقل من الدهون."),
    L("Missed a day? Pick up tomorrow. There's no need to start over.", "لو فاتك يوم، كمّلي من بكرا. ما في داعي تعيدي من الصفر."),
    L("Breathing matters more than you'd think — exhale on the effort, inhale on the return.", "التنفّس أهم مما تتوقعي — الزفير مع الجهد والشهيق مع الرجوع."),
    L("Under six hours of sleep erases most of what training gives you.", "النوم أقل من 6 ساعات بيوقف نتايج التمرين تقريباً."),
  ],
};
