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
  // The lecture app takes no photos and keeps no scans, so the scanner
  // wording above would be describing something it does not do — in a
  // consent screen, which is the one place that must be accurate.
  aiNoticeAudio: L(
    "Your lecture is turned into text on your device as it's spoken. To summarise it, that text is sent to be analysed by AI.",
    "كلام المحاضرة بينحوّل لنص على جهازك أول بأول. وعشان يتلخّص، بينبعت النص ليتحلل بالذكاء الاصطناعي.",
  ),
  privacyNoticeAudio: L(
    "The recording stays on your device. We don't store your lectures on our servers or link them to you.",
    "التسجيل بيضل على جهازك. ما بنخزّن محاضراتك على خوادمنا وما بنربطها باسمك.",
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
  sectionSubscription: L("Subscription", "الاشتراك"),
  sectionData: L("Your data", "بياناتك"),
  sectionAbout: L("About", "عن التطبيق"),
  dataStaysLocalProgram: L(
    "Your progress is saved on this device only.",
    "تقدّمك محفوظ على جهازك بس.",
  ),
  dataStaysLocalScanner: L(
    "Scans are saved on this device only. We don't store your photos on our servers.",
    "الفحوصات بتنحفظ على جهازك بس. ما بنخزّن صورك على خوادمنا.",
  ),
  dataStaysLocalAudio: L(
    "Your lectures and recordings are saved on this device only.",
    "محاضراتك وتسجيلاتك محفوظة على جهازك بس.",
  ),
  couldNotOpen: L("Couldn't open the link", "ما قدرنا نفتح الرابط"),
  privacyPolicy: L("Privacy policy", "سياسة الخصوصية"),
  readPrivacyPolicy: L("Read the privacy policy", "اقرأ سياسة الخصوصية"),
  terms: L("Terms of Use", "شروط الاستخدام"),
  language: L("Language", "اللغة"),

  // navigation
  tabHome: L("Today", "اليوم"),
  tabLibrary: L("Lectures", "المحاضرات"),
  navTasks: L("Tasks", "المهام"),
  tabRecord: L("Record", "سجّل"),

  // tasks across lectures
  overdue: L("Overdue", "متأخر"),
  dueToday: L("Today", "اليوم"),
  dueSoon: L("This week", "هالأسبوع"),
  dueLater: L("Later", "بعدين"),
  noDeadline: L("No deadline", "بدون موعد"),
  completed2: L("Done", "خلصت"),
  fromLecture: L("from", "من"),
  saidAt: L("said at", "قالها بـ"),
  jumpToMoment: L("Play this moment", "شغّل هاللحظة"),
  statedByLecturer: L("The lecturer said this", "الدكتور قالها"),
  inferredByAI: L("Worked out from the lecture", "مستنتجة من المحاضرة"),
  deadlineInferred: L("date worked out", "التاريخ مستنتج"),
  noTasksYet: L(
    "Nothing to do yet. Assignments the lecturer sets will land here on their own.",
    "ما في إشي عليك. الواجبات اللي بيحطها الدكتور بتوصل لهون لحالها.",
  ),
  noLecturesYet: L(
    "No lectures yet. Record one and it will be waiting here.",
    "ما في محاضرات بعد. سجّل وحدة وبتلاقيها مستنية هون.",
  ),
  searchLectures: L("Search lectures", "دوّر بالمحاضرات"),
  resumeStudy: L("Resume", "كمّل"),
  continueStudying: L("Pick up where you stopped", "كمّل من وين وقفت"),
  todaysWork: L("What today needs", "شو بده اليوم"),
  recentLectures: L("Latest lectures", "آخر المحاضرات"),
  seeAll: L("See all", "شوف الكل"),
  lecturesCount: L("lectures", "محاضرات"),
  openTasks: L("open", "مفتوحة"),
  needsReview: L("needs another pass", "بدها إعادة"),
  switchToArabic: L("العربية", "العربية"),
  switchToEnglish: L("English", "English"),
  languageChanged: L("Language changed", "تغيّرت اللغة"),
  restartToApply: L(
    "Close the app and open it again to apply it.",
    "سكّر التطبيق وافتحه من جديد عشان تنطبّق.",
  ),
  confirmSwitchLanguage: L(
    "The app will restart to change language.",
    "التطبيق رح يعيد التشغيل عشان يغيّر اللغة.",
  ),
  support: L("Support", "المساعدة"),
  /* Apple requires the renewal terms on the purchase screen itself, not
     only in a linked document. Missing this is a routine rejection. */
  renewalTerms: L(
    "Payment is charged to your account at confirmation. The subscription renews automatically unless you turn off auto-renewal at least 24 hours before the period ends, and your account is charged for renewal within 24 hours before that. Manage or cancel it any time in your account settings.",
    "بينخصم المبلغ من حسابك عند التأكيد. الاشتراك بيتجدّد تلقائياً إلا إذا أوقفت التجديد قبل ٢٤ ساعة على الأقل من نهاية المدة، وبينخصم التجديد خلال الـ٢٤ ساعة اللي قبلها. تقدر تدير الاشتراك أو تلغيه أي وقت من إعدادات حسابك.",
  ),
  linkFailed: L("Couldn't open", "ما فتحت"),

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

  // ---------------------------------------------------------------- lectures
  recording: L("Recording", "بيسجّل"),
  processing: L("Studying", "بيذاكر"),
  failed: L("Failed", "فشل"),
  endLecture: L("End the lecture", "إنهاء المحاضرة"),
  endLectureConfirm: L(
    "End the lecture and study it now? The recording stops here.",
    "ننهي المحاضرة ونذاكرها هلق؟ التسجيل بيوقف هون.",
  ),
  stillProcessing: L(
    "This lecture was left mid-study. Run it again to finish.",
    "هالمحاضرة وقفت بنص المذاكرة. شغّلها كمان مرة تخلص.",
  ),
  interrupted: L(
    "The recording stopped before the lecture ended.",
    "التسجيل وقف قبل ما تخلص المحاضرة.",
  ),
  textAfterLecture: L(
    "Recording. The text is written up once the lecture ends.",
    "عم يسجّل. النص بينكتب بعد ما تخلص المحاضرة.",
  ),
  liveWriterOff: L(
    "The live writer isn't running — the lecture is still recording, and the text comes after it ends.",
    "الكاتب المباشر مش شغال — المحاضرة عم تنسجّل، والنص بيجي بعد ما تخلص.",
  ),
  markImportant: L("Mark this important", "علّمها مهمة"),
  importantMoments: L("Important moments", "اللقطات المهمة"),
  markedByYou: L("you marked it", "علّمتها إنت"),
  newLecture: L("New lecture", "محاضرة جديدة"),
  lectureTitle: L("Lecture title", "عنوان المحاضرة"),
  untitledLecture: L("Untitled lecture", "محاضرة بدون عنوان"),
  pasteTitle: L("Paste lecture text", "لصق نص محاضرة"),
  pasteHint: L(
    "Paste a transcript you already have and Mahdar will study it the same way — minus the tone of voice, which only recording can hear.",
    "الصق نص محاضرة عندك ومَحضَر بيذاكرها بنفس الطريقة — بدون النبرة، لأن النبرة بس التسجيل بيسمعها.",
  ),
  pasteHere: L("Paste the lecture text here…", "الصق نص المحاضرة هون..."),
  study: L("Study it", "ذاكرها"),
  needMoreText: L("That's too short to study. Paste more of the lecture.", "النص قصير كتير. الصق مقطع أطول من المحاضرة."),
  micDenied: L(
    "Mahdar needs the microphone to record the lecture. Allow it in Settings and come back.",
    "مَحضَر محتاج المايك عشان يسجل المحاضرة. اسمح فيه من الإعدادات وارجع.",
  ),

  // review screen
  home: L("Home", "الرئيسية"),
  copyAll: L("Copy all", "نسخ الكل"),
  downloadMd: L("Download .md", "تحميل .md"),
  retranscribe: L("Re-transcribe from the recording", "أعد التفريغ من التسجيل"),
  reanalyse: L("Re-analyse", "أعد التحليل"),
  deleteLecture: L("Delete", "حذف"),
  deleteLectureConfirm: L(
    "Delete this lecture and its recording? This can't be undone.",
    "نحذف المحاضرة وتسجيلها؟ ما في رجعة.",
  ),
  copied: L("Copied", "اننسخ"),
  playerHint: L(
    "The lecture recording — tap any moment of emphasis to hear it again",
    "تسجيل المحاضرة — اضغط أي لحظة نبرة ترجع تسمعها",
  ),
  minShort: L("min", "د"),
  tasksCount: L("tasks", "المهام"),
  termsCount: L("concepts", "المفاهيم"),

  // tabs
  tabSummary: L("Summary", "الملخص"),
  tabTasks: L("Tasks", "المهام"),
  tabTerms: L("Concepts", "المفاهيم"),
  tabExam: L("Exam predictions", "توقعات الامتحان"),
  tabMap: L("Lecture map", "خريطة المحاضرة"),
  tabTone: L("Tone", "النبرة"),
  tabTranscript: L("Full text", "النص الكامل"),

  downloadIcs: L("Download calendar (.ics)", "تحميل التقويم (.ics)"),
  enableReminders: L("Turn on reminders", "فعّل التذكيرات"),
  remindersOn: L("Reminders on", "التذكيرات شغالة"),
  easy: L("Easy", "بسيط"),
  medium: L("Medium", "متوسط"),
  hard: L("Hard", "صعب"),
  confHigh: L("High", "عالية"),
  confMedium: L("Medium", "متوسطة"),
  confLow: L("Low", "منخفضة"),
  noTasks: L("The lecturer didn't set anything.", "الدكتور ما حط إشي."),
  noTerms: L("No new terms were introduced.", "ما في مصطلحات جديدة."),
  noExam: L(
    "The lecturer never signalled what would be examined — nothing to predict from.",
    "الدكتور ما أشّر على إشي للامتحان — ما في من وين نتوقع.",
  ),
  noTone: L(
    "Nothing stood out in the lecturer's voice this time.",
    "ما في إشي برز بصوت الدكتور هالمرة.",
  ),
  keyPoints: L("Key points", "النقاط الأساسية"),
  transcribeFailed: L(
    "We couldn't transcribe the recording. The audio is kept — you can try again.",
    "ما قدرنا نفرّغ التسجيل. الصوت محفوظ — فيك تجرّب كمان مرة.",
  ),
  freeLectureUsed: L(
    "You've used your free lecture. Subscribe to keep recording.",
    "استعملت محاضرتك المجانية. اشترك عشان تكمّل تسجيل.",
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
