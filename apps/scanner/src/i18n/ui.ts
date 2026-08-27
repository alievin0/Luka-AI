import { L } from "./index";

/** Every string in the shared screens. Pack content lives with its pack. */
export const ui = {
  // onboarding
  letsStart: L("Get started", "يلا نبدأ"),
  agreeAndStart: L("Agree and continue", "موافق، ابدأ"),
  quickQuestions: L(
    "A few quick questions, then you're in.",
    "كم سؤال سريع، وبعدها ابدأ.",
  ),
  questionOf: L("Question", "سؤال"),
  of: L("of", "من"),
  beforeWeStart: L("Before we start", "قبل ما نبدأ"),
  whereAreYou: L("Where are you?", "من وين إنت؟"),
  whyCountryCost: L(
    "So we can estimate costs in your currency.",
    "منشان نقدّر التكلفة بعملة بلدك.",
  ),
  whyCountryRegion: L(
    "So results match your region.",
    "منشان نضبط النتائج على منطقتك.",
  ),
  searchCountry: L("Search your country…", "اكتب اسم بلدك…"),
  noCountry: L("No country matches that.", "ما لقينا بلد بهذا الاسم."),
  aiNotice: L(
    "When you take a photo, it's analysed by AI and you get the result in seconds.",
    "لما تصوّر، بتتحلل الصورة بالذكاء الاصطناعي وبترجعلك النتيجة خلال ثواني.",
  ),
  privacyNotice: L(
    "We don't store your photos on our servers or link them to you. Scans are saved on your device only.",
    "ما بنخزّن صورك على خوادمنا وما بنربطها باسمك. الفحوصات بتنحفظ على جهازك بس.",
  ),
  progressLocal: L(
    "Your progress is saved on your device only.",
    "تقدّمك محفوظ على جهازك بس.",
  ),

  // camera
  history: L("History", "السجل"),
  guide: L("Guide", "الدليل"),
  gallery: L("Gallery", "المعرض"),
  analysing: L("Analysing…", "عم نحلل الصورة…"),
  scansLeft: L("free scan left", "فحص مجاني"),
  upgrade: L("Upgrade", "ترقية"),
  cameraNeeded: L("Camera access needed", "بدنا إذن الكاميرا"),
  allowCamera: L("Allow camera", "اسمح بالوصول"),
  orPickPhoto: L("Or pick a photo instead", "أو اختر صورة من المعرض"),
  couldNotIdentify: L("Couldn't identify it", "ما قدرنا نتعرّف"),
  tryClearerPhoto: L("Try a closer, clearer photo.", "جرّب صورة أوضح وأقرب."),
  somethingWrong: L("That didn't work", "ما زبطت"),
  tryAgain: L("Something went wrong. Try again.", "صار خطأ. جرّب كمان مرة."),

  // result
  result: L("Result", "النتيجة"),
  scanAgain: L("Scan again", "افحص كمان مرة"),
  share: L("Share", "مشاركة"),
  alsoDetected: L("Also lit in this photo", "كمان طالع بالصورة"),
  estimatedCost: L("Estimated cost", "الكلفة التقديرية"),
  confidenceHigh: L("High confidence", "ثقة عالية"),
  confidenceMedium: L("Medium confidence", "ثقة متوسطة"),
  confidenceLow: L(
    "Low confidence — confirm with a professional",
    "ثقة منخفضة — تأكد من مختص",
  ),
  notFound: L("We couldn't find that scan.", "ما لقينا هذا الفحص."),

  ifIgnored: L("If you ignore it", "إذا تجاهلتها"),
  onYourCar: L("On your car", "على سيارتك إنت"),

  // history
  pastScans: L("Past scans", "الفحوصات السابقة"),
  noScansYet: L("No scans yet", "ما في فحوصات بعد"),
  longPressDelete: L("Long-press any scan to delete it", "اضغط مطوّلاً على أي فحص لمسحه"),
  deleteScan: L("Delete this scan?", "امسح هذا الفحص؟"),

  // library
  searchGuide: L("Search the guide…", "دوّر بالدليل…"),
  noMatch: L("Nothing matches that.", "ما في نتيجة."),
  sevCritical: L("Critical — stop", "خطر — اوقف"),
  sevWarning: L("Warning — check soon", "تحذير — افحص قريباً"),
  sevInfo: L("Info", "معلومة"),

  // program
  settings: L("Settings", "الإعدادات"),
  todaySession: L("Today's session", "تمرين اليوم"),
  doneToday: L("Done for today — keep going if you want", "خلصت اليوم — كمّل إذا بدك"),
  startNow: L("Start now", "ابدأ الآن"),
  startNext: L("Start next", "ابدأ التالي"),
  dayStreak: L("day streak", "يوم متواصل"),
  completed: L("completed", "خلصت"),
  ofPlan: L("of plan", "من الخطة"),
  tipOfDay: L("Tip of the day", "نصيحة اليوم"),
  seeFullPlan: L("See the full plan", "شوف الخطة كاملة"),
  howToDoIt: L("How to do it", "كيف تعملها"),
  commonMistakes: L("Common mistakes", "أخطاء شائعة"),
  rest: L("Rest", "راحة"),
  nextUp: L("Next", "الجاي"),
  pause: L("Pause", "إيقاف مؤقت"),
  resume: L("Resume", "متابعة"),
  next: L("Next", "التالي"),
  finish: L("Finish", "خلّصت"),
  finished: L("Finished", "خلّصت"),
  backHome: L("Back to home", "رجوع للرئيسية"),
  reps: L("reps", "تكرار"),
  minutes: L("min", "دقيقة"),
  sessionNotFound: L("We couldn't find that session.", "ما لقينا هذا التمرين."),
  noPlan: L("This app has no plan.", "ما في خطة لهذا التطبيق."),

  // settings
  general: L("General", "عام"),
  yourCountry: L("Your country", "بلدك"),
  notSet: L("Not set", "غير محدد"),
  changeCountry: L("Change your country", "غيّر بلدك"),
  cancel: L("Cancel", "إلغاء"),
  subscription: L("Subscription", "الاشتراك"),
  restorePurchase: L("Restore a purchase", "استعادة عملية شراء"),
  restored: L("Restored", "تمت الاستعادة"),
  restoredBody: L("Your subscription is active again.", "اشتراكك رجع فعّال."),
  noSubscription: L("No subscription found", "ما لقينا اشتراك"),
  noSubscriptionBody: L(
    "There's no previous purchase on this account.",
    "ما في اشتراك سابق على هذا الحساب.",
  ),
  unavailable: L("Not available", "غير متاح"),
  purchasesOff: L("Purchases aren't enabled in this build.", "الاشتراكات مش مفعّلة بهالنسخة."),
  dailyReminder: L("Daily reminder", "التذكير اليومي"),
  reminderOn: L("Reminder on", "التذكير مفعّل"),
  enableReminder: L("Turn on daily reminder", "فعّل التذكير اليومي"),
  reminderOff: L("Off", "مطفي"),
  shiftHour: L("Push back an hour", "أخّر ساعة"),
  reminderLocal: L(
    "A local reminder on your device — it never touches a server.",
    "تذكير محلي على جهازك — ما بيمر على أي خادم.",
  ),
  notificationsBlocked: L("Notifications are off", "الإشعارات مقفولة"),
  notificationsBlockedBody: L(
    "Turn on notifications for this app in your device settings to use reminders.",
    "فعّل الإشعارات لهذا التطبيق من إعدادات جهازك عشان يشتغل التذكير.",
  ),
  data: L("Data", "البيانات"),
  clearScans: L("Delete all scans", "امسح كل الفحوصات"),
  clearScansBody: L(
    "Every saved scan on this device will be deleted. This can't be undone.",
    "رح تنمسح كل الفحوصات المحفوظة على جهازك. ما في رجعة.",
  ),
  resetProgress: L("Reset progress", "صفّر التقدّم"),
  resetProgressBody: L(
    "Everything goes back to the start and your streak resets.",
    "رح يرجع كل شي للبداية، والسلسلة رح تنكسر.",
  ),
  delete: L("Delete", "امسح"),
  reset: L("Reset", "صفّر"),
  deleted: L("Deleted", "انمسحت"),
  nothingLeft: L("Nothing saved is left.", "ما ضل ولا فحص محفوظ."),
  resetDone: L("Reset", "انصفّر"),
  backToStart: L("You're back at the start.", "رجعت للبداية."),
  about: L("About", "عن التطبيق"),
  version: L("Version", "النسخة"),
  privacyPolicy: L("Privacy policy", "سياسة الخصوصية"),
  linkFailed: L("Couldn't open", "ما فتحت"),
  addPrivacyUrl: L(
    "Add a real privacy policy URL before launch.",
    "ضيف رابط سياسة الخصوصية قبل الإطلاق.",
  ),

  trialLine: L(
    "Try {n} days free — cancel any time before it ends",
    "جرّب {n} أيام مجاناً — بتقدر تلغي بأي وقت قبل ما ينتهي",
  ),

  // paywall
  startNowCta: L("Start now", "ابدأ الآن"),
  restorePrior: L("Restore a previous purchase", "استعادة عملية شراء سابقة"),
  purchaseFailed: L("Purchase didn't complete", "ما تمت العملية"),
  purchaseFailedBody: L(
    "The subscription didn't activate. Try again.",
    "ما انفعّل الاشتراك. جرّب كمان مرة.",
  ),
  purchaseCancelled: L(
    "The purchase was cancelled, or something went wrong.",
    "انلغى الشراء أو صار خطأ.",
  ),
  devMode: L("Test mode", "وضع تجريبي"),
  devModeBody: L(
    "Add RevenueCat keys and make a dev build to enable real purchases.",
    "ضيف مفاتيح RevenueCat واعمل dev build عشان يشتغل الشراء فعلياً.",
  ),
  purchaseOffBody: L("Purchases aren't enabled in this build.", "الشراء مش مفعّل بهالنسخة."),

  reminderBody: L(
    "Time for today's session — keep the streak alive",
    "وقت تمرين اليوم — لا تكسر السلسلة",
  ),
  reminderBodyScanner: L("Open the app and see what's new", "افتح التطبيق وشوف الجديد"),

  // gold assistant
  priceCheck: L("Price check", "فحص السعر"),
  todaysRate: L("Today's gold rate", "سعر الذهب اليوم"),
  perGram24k: L("per gram, 24K", "للغرام، عيار ٢٤"),
  rateStale: L("Rate is over a day old — update it", "السعر أقدم من يوم — حدّثه"),
  setRate: L("Set rate", "حدّد السعر"),
  weightGrams: L("Weight in grams", "الوزن بالغرام"),
  karat: L("Karat", "العيار"),
  askingPrice: L("Price they're asking", "السعر المطلوب"),
  optional: L("optional", "اختياري"),
  metalValue: L("Gold value", "قيمة الذهب"),
  makingCharge: L("Making charge", "المصنعية"),
  ofGoldValue: L("of gold value", "من قيمة الذهب"),
  sellBackToday: L("If you sold it back today", "لو بعتها اليوم"),
  pureGoldIn: L("Pure gold in the piece", "الذهب الصافي بالقطعة"),
  verdictFair: L("Fair — this is a normal making charge", "معقول — مصنعية طبيعية"),
  verdictHigh: L("High — worth negotiating", "عالية — تستاهل مفاوضة"),
  verdictVeryHigh: L("Very high — you're paying for the shop, not the gold", "عالية جداً — إنت بتدفع للمحل مش للذهب"),
  verdictBelow: L("Below metal value — check the karat and weight again", "أقل من قيمة المعدن — راجع العيار والوزن"),
  enterRateFirst: L("Enter today's gold rate to check a price", "حط سعر الذهب اليوم عشان تفحص السعر"),
  goldDisclaimer: L(
    "A photo cannot prove gold is solid rather than plated — only an acid, XRF or density test can. This reads the stamp and checks the maths on the price.",
    "الصورة ما بتقدر تثبت إن الذهب خالص مش مطلي — بس فحص الحمض أو XRF أو الكثافة بيقدر. هذا بيقرا الدمغة وبيفحص حساب السعر.",
  ),

  // errors
  rateLimited: L(
    "Too many scans in a short time. Try again shortly.",
    "كترت الفحوصات بوقت قصير. جرّب بعد شوي.",
  ),
  offline: L(
    "We couldn't reach the server. Check your connection and try again.",
    "ما قدرنا نوصل للخادم. تأكد من اتصالك بالإنترنت وجرّب كمان مرة.",
  ),
  serverError: L("Something went wrong. Try again.", "صار خطأ أثناء التحليل. جرّب كمان مرة."),
  noImage: L("No image received.", "ما وصلتنا صورة."),
  imageTooLarge: L("That image is too large.", "الصورة كبيرة كتير."),
};
