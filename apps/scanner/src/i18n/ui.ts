import { L } from "./index";

/** Every string in the shared screens. Pack content lives with its pack. */
export const ui = {
  // onboarding
  letsStart: L("Get started", "لنبدأ"),
  continueLabel: L("Continue", "متابعة"),
  agreeAndStart: L("Agree and continue", "موافق، لنبدأ"),
  quickQuestions: L(
    "A few quick questions, then you're in.",
    "أسئلة سريعة، ثم نبدأ.",
  ),
  questionOf: L("Question", "سؤال"),
  of: L("of", "من"),
  beforeWeStart: L("Before we start", "قبل أن نبدأ"),
  whereAreYou: L("Where are you?", "أين تقيم؟"),
  whyCountryCost: L(
    "So we can estimate costs in your currency.",
    "لتقدير التكلفة بعملة بلدك.",
  ),
  whyCountryRegion: L(
    "So results match your region.",
    "لضبط النتائج على منطقتك.",
  ),
  searchCountry: L("Search your country…", "اكتب اسم بلدك…"),
  noCountry: L("No country matches that.", "لم نجد بلداً بهذا الاسم."),
  aiNotice: L(
    "When you take a photo, it's analysed by AI and you get the result in seconds.",
    "عند التصوير تُحلَّل الصورة بالذكاء الاصطناعي وتصلك النتيجة خلال ثوانٍ.",
  ),
  privacyNotice: L(
    "We don't store your photos on our servers or link them to you. Scans are saved on your device only.",
    "لا نخزّن صورك على خوادمنا ولا نربطها باسمك. وتُحفظ الفحوصات على جهازك فقط.",
  ),
  // The lecture app takes no photos and keeps no scans, so the scanner
  // wording above would be describing something it does not do — in a
  // consent screen, which is the one place that must be accurate.
  aiNoticeAudio: L(
    "Your lecture is turned into text on your device as it's spoken. To summarise it, that text is sent to be analysed by AI.",
    "يُحوَّل كلام المحاضرة إلى نص على جهازك أولاً بأول، ولتلخيصه يُرسل النص ليُحلَّل بالذكاء الاصطناعي.",
  ),
  privacyNoticeAudio: L(
    "The recording stays on your device. We don't store your lectures on our servers or link them to you.",
    "يبقى التسجيل على جهازك. ولا نخزّن محاضراتك على خوادمنا ولا نربطها باسمك.",
  ),
  progressLocal: L(
    "Your progress is saved on your device only.",
    "تقدّمك محفوظ على جهازك فقط.",
  ),

  // camera
  history: L("History", "السجل"),
  guide: L("Guide", "الدليل"),
  gallery: L("Gallery", "المعرض"),
  analysing: L("Analysing…", "نحلل الصورة…"),
  upgrade: L("Upgrade", "ترقية"),
  cameraNeeded: L("Camera access needed", "نحتاج إذن الكاميرا"),
  allowCamera: L("Allow camera", "اسمح بالوصول"),
  orPickPhoto: L("Or pick a photo instead", "أو اختر صورة من المعرض"),
  couldNotIdentify: L("Couldn't identify it", "تعذّر التعرّف"),
  tryClearerPhoto: L("Try a closer, clearer photo.", "جرّب صورة أوضح وأقرب."),
  somethingWrong: L("That didn't work", "لم تنجح المحاولة"),
  tryAgain: L("Something went wrong. Try again.", "حدث خطأ. حاول مرة أخرى."),

  // result
  result: L("Result", "النتيجة"),
  scanAgain: L("Scan again", "افحص مرة أخرى"),
  share: L("Share", "مشاركة"),
  alsoDetected: L("Also lit in this photo", "مضاء أيضاً في الصورة"),
  estimatedCost: L("Estimated repair", "تقدير الإصلاح"),
  // The three things a range does not say on its own. Which of the first two
  // shows is decided by the light's own severity, so neither is ever a guess.
  costLikelySmall: L("Often a small job", "غالباً إصلاح بسيط"),
  costDontDelay: L("Don't put the check off", "لا تأجّل الفحص"),
  costVaries: L("Varies by country, workshop and car", "يختلف حسب البلد ومركز الصيانة والسيارة"),
  confidenceHigh: L("High confidence", "ثقة عالية"),
  confidenceMedium: L("Medium confidence", "ثقة متوسطة"),
  confidenceLow: L(
    "Low confidence — confirm with a professional",
    "ثقة منخفضة — تأكد من مختص",
  ),
  notFound: L("We couldn't find that scan.", "لم نجد هذا الفحص."),

  ifIgnored: L("If you ignore it", "إذا تجاهلتها"),
  onYourCar: L("On your car", "على سيارتك تحديداً"),
  forYourCar: L("For your {car}", "لسيارتك {car}"),
  forYourCarYear: L("For your {year} {car}", "لسيارتك {car} {year}"),

  // history
  pastScans: L("Past scans", "الفحوصات السابقة"),
  noScansYet: L("No scans yet", "لا توجد فحوصات بعد"),
  longPressDelete: L("Long-press any scan to delete it", "اضغط مطوّلاً على أي فحص لمسحه"),
  deleteScan: L("Delete this scan?", "امسح هذا الفحص؟"),

  // library
  searchGuide: L("Search the guide…", "ابحث في الدليل…"),
  noMatch: L("Nothing matches that.", "لا توجد نتائج."),
  sevCritical: L("Critical — stop", "خطر — توقّف"),
  sevWarning: L("Warning — check soon", "تحذير — افحص قريباً"),
  sevInfo: L("Info", "معلومة"),

  // program
  settings: L("Settings", "الإعدادات"),
  todaySession: L("Today's session", "تمرين اليوم"),
  doneToday: L("Done for today — keep going if you want", "أنجزت تمرين اليوم — تابع إن أردت"),
  startNow: L("Start now", "ابدأ الآن"),
  startNext: L("Start next", "ابدأ التالي"),
  dayStreak: L("day streak", "يوم متواصل"),
  completed: L("completed", "مكتملة"),
  ofPlan: L("of plan", "من الخطة"),
  tipOfDay: L("Tip of the day", "نصيحة اليوم"),
  seeFullPlan: L("See the full plan", "اعرض الخطة كاملة"),
  howToDoIt: L("How to do it", "طريقة الأداء"),
  commonMistakes: L("Common mistakes", "أخطاء شائعة"),
  rest: L("Rest", "راحة"),
  nextUp: L("Next", "التالي"),
  pause: L("Pause", "إيقاف مؤقت"),
  resume: L("Resume", "متابعة"),
  next: L("Next", "التالي"),
  finish: L("Finish", "خلّصت"),
  finished: L("Finished", "خلّصت"),
  backHome: L("Back to home", "العودة إلى الرئيسية"),
  reps: L("reps", "تكرار"),
  minutes: L("min", "دقيقة"),
  sessionNotFound: L("We couldn't find that session.", "لم نجد هذا التمرين."),
  noPlan: L("This app has no plan.", "لا توجد خطة لهذا التطبيق."),

  // settings
  general: L("General", "عام"),
  yourCountry: L("Your country", "بلدك"),
  changeCountry: L("Change your country", "غيّر بلدك"),
  notSet: L("Not set", "غير محدد"),
  cancel: L("Cancel", "إلغاء"),
  subscription: L("Subscription", "الاشتراك"),
  restorePurchase: L("Restore a purchase", "استعادة عملية شراء"),
  restored: L("Restored", "تمت الاستعادة"),
  restoredBody: L("Your subscription is active again.", "عاد اشتراكك فعّالاً."),
  noSubscription: L("No subscription found", "لم نجد اشتراكاً"),
  noSubscriptionBody: L(
    "There's no previous purchase on this account.",
    "لا يوجد اشتراك سابق على هذا الحساب.",
  ),
  unavailable: L("Not available", "غير متاح"),
  purchasesOff: L("Purchases aren't enabled in this build.", "الاشتراكات غير مفعّلة في هذه النسخة."),
  dailyReminder: L("Daily reminder", "التذكير اليومي"),
  reminderOn: L("Reminder on", "التذكير مفعّل"),
  enableReminder: L("Turn on daily reminder", "فعّل التذكير اليومي"),
  reminderOff: L("Off", "متوقف"),
  shiftHour: L("Push back an hour", "أخّر ساعة"),
  reminderLocal: L(
    "A local reminder on your device — it never touches a server.",
    "تذكير محلي على جهازك، لا يمر بأي خادم.",
  ),
  notificationsBlocked: L("Notifications are off", "الإشعارات معطّلة"),
  notificationsBlockedBody: L(
    "Turn on notifications for this app in your device settings to use reminders.",
    "فعّل الإشعارات لهذا التطبيق من إعدادات جهازك ليعمل التذكير.",
  ),
  data: L("Data", "البيانات"),
  clearScans: L("Delete all scans", "امسح كل الفحوصات"),
  clearScansBody: L(
    "Every saved scan on this device will be deleted. This can't be undone.",
    "ستُمحى كل الفحوصات المحفوظة على جهازك، ولا يمكن التراجع.",
  ),
  resetProgress: L("Reset progress", "صفّر التقدّم"),
  resetProgressBody: L(
    "Everything goes back to the start and your streak resets.",
    "سيعود كل شيء إلى البداية، وتنقطع السلسلة.",
  ),
  delete: L("Delete", "امسح"),
  reset: L("Reset", "صفّر"),
  deleted: L("Deleted", "تم المسح"),
  nothingLeft: L("Nothing saved is left.", "لم يبقَ أي فحص محفوظ."),
  resetDone: L("Reset", "تم التصفير"),
  backToStart: L("You're back at the start.", "عاد كل شيء إلى البداية."),
  about: L("About", "عن التطبيق"),
  version: L("Version", "النسخة"),
  sectionSubscription: L("Subscription", "الاشتراك"),
  sectionData: L("Your data", "بياناتك"),
  sectionAbout: L("About", "عن التطبيق"),
  dataStaysLocalProgram: L(
    "Your progress is saved on this device only.",
    "تقدّمك محفوظ على جهازك فقط.",
  ),
  dataStaysLocalScanner: L(
    "Scans are saved on this device only. We don't store your photos on our servers.",
    "تُحفظ الفحوصات على جهازك فقط، ولا نخزّن صورك على خوادمنا.",
  ),
  dataStaysLocalAudio: L(
    "Your lectures and recordings are saved on this device only.",
    "محاضراتك وتسجيلاتك محفوظة على جهازك فقط.",
  ),
  // The destructive row on an audio pack. Worded for lectures *and*
  // recordings: the recordings are by far the largest thing being destroyed,
  // and the row used to say "scans", which Mahdar has none of.
  clearLectures: L("Delete all lectures", "احذف كل المحاضرات"),
  clearLecturesQ: L("Delete every lecture?", "حذف كل المحاضرات؟"),
  clearLecturesBody: L(
    "Every lecture on this device will be deleted, and its recording with it. This can't be undone.",
    "ستُحذف كل محاضرة على جهازك ومعها تسجيلها، ولا يمكن التراجع.",
  ),
  clearLecturesDoneBody: L(
    "No saved lectures or recordings are left.",
    "لم يبقَ أي محاضرة أو تسجيل محفوظ.",
  ),
  couldNotOpen: L("Couldn't open the link", "تعذّر فتح الرابط"),
  privacyPolicy: L("Privacy policy", "سياسة الخصوصية"),
  readPrivacyPolicy: L("Read the privacy policy", "اقرأ سياسة الخصوصية"),
  terms: L("Terms of Use", "شروط الاستخدام"),
  language: L("Language", "اللغة"),

  // navigation
  tabHome: L("Today", "اليوم"),
  tabLibrary: L("Lectures", "المحاضرات"),
  navTasks: L("Tasks", "المهام"),
  tabRecord: L("Record", "سجّل"),
  tabSearch: L("Search", "بحث"),
  searchEverything: L("Search your lectures", "ابحث في محاضراتك"),
  searchHint: L(
    "Search what was said, the concepts, the tasks — anything from any lecture.",
    "ابحث في كلام المحاضر وفي المفاهيم وفي المهام — أي شيء من أي محاضرة.",
  ),
  inConcepts: L("Concepts", "مفاهيم"),
  inTasks: L("Tasks", "مهام"),
  inTranscript: L("Said in the lecture", "قيل في المحاضرة"),
  aboutThisLecture: L("What this lecture was about", "موضوع المحاضرة"),
  keyConcepts: L("Key concepts", "المفاهيم الأساسية"),
  importantMomentsTitle: L("Important moments", "اللحظات المهمة"),
  tasksAndAssignments: L("Tasks & assignments", "المهام والواجبات"),
  viewAllMoments: L("See all moments", "اعرض كل اللحظات"),
  mentionedAt: L("Mentioned at", "ذُكرت في"),
  lectureMap: L("Lecture map", "خريطة المحاضرة"),
  tabOverview: L("Overview", "نظرة عامة"),
  showLess: L("Show less", "أقل"),
  keyPointsTitle: L("The main points", "أهم النقاط"),
  playFromMoment: L("Play from this moment", "شغّل من هنا"),

  // tasks across lectures
  overdue: L("Overdue", "متأخر"),
  dueToday: L("Today", "اليوم"),
  dueSoon: L("This week", "هذا الأسبوع"),
  dueLater: L("Later", "لاحقاً"),
  noDeadline: L("No deadline", "بدون موعد"),
  completed2: L("Done", "مكتملة"),
  fromLecture: L("from", "من"),
  saidAt: L("said at", "قالها في"),
  jumpToMoment: L("Play this moment", "شغّل هذه اللحظة"),
  statedByLecturer: L("The lecturer said this", "قالها المحاضر"),
  inferredByAI: L("Worked out from the lecture", "مستنتجة من المحاضرة"),
  deadlineInferred: L("date worked out", "التاريخ مستنتج"),
  noTasksYet: L(
    "Nothing to do yet. Assignments the lecturer sets will land here on their own.",
    "لا شيء عليك. والواجبات التي يكلّف بها المحاضر تصل إلى هنا تلقائياً.",
  ),
  noLecturesYet: L(
    "No lectures yet. Record one and it will be waiting here.",
    "لا توجد محاضرات بعد. سجّل واحدة وستجدها في انتظارك هنا.",
  ),
  searchLectures: L("Search lectures", "ابحث في المحاضرات"),
  resumeStudy: L("Resume", "تابع"),
  continueStudying: L("Pick up where you stopped", "تابع من حيث توقفت"),
  todaysWork: L("What today needs", "ما يحتاجه اليوم"),
  recentLectures: L("Latest lectures", "آخر المحاضرات"),
  seeAll: L("See all", "اعرض الكل"),
  lecturesCount: L("lectures", "محاضرات"),
  openTasks: L("open", "مفتوحة"),
  needsReview: L("needs another pass", "تحتاج مراجعة"),
  switchToArabic: L("العربية", "العربية"),
  switchToEnglish: L("English", "English"),
  languageChanged: L("Language changed", "تغيّرت اللغة"),
  restartToApply: L(
    "Close the app and open it again to apply it.",
    "أغلق التطبيق وافتحه من جديد ليُطبَّق التغيير.",
  ),
  confirmSwitchLanguage: L(
    "The app will restart to change language.",
    "سيُعاد تشغيل التطبيق لتغيير اللغة.",
  ),
  support: L("Support", "المساعدة"),
  /* Apple requires the renewal terms on the purchase screen itself, not
     only in a linked document. Missing this is a routine rejection. */
  renewalTerms: L(
    "Payment is charged to your account at confirmation. The subscription renews automatically unless you turn off auto-renewal at least 24 hours before the period ends, and your account is charged for renewal within 24 hours before that. Manage or cancel it any time in your account settings.",
    "يُخصم المبلغ من حسابك عند التأكيد. ويتجدّد الاشتراك تلقائياً ما لم توقف التجديد قبل 24 ساعة على الأقل من نهاية المدة، ويُخصم مبلغ التجديد خلال الـ24 ساعة السابقة لها. ويمكنك إدارة الاشتراك أو إلغاؤه في أي وقت من إعدادات حسابك.",
  ),
  linkFailed: L("Couldn't open", "لم تُفتح"),

  trialLine: L(
    "Try {n} days free — cancel any time before it ends",
    "جرّب {n} أيام مجاناً — يمكنك الإلغاء في أي وقت قبل انتهائها",
  ),

  // paywall
  startNowCta: L("Start now", "ابدأ الآن"),
  // ---- paywall ----------------------------------------------------------
  paywallSub: L(
    "Know at once whether to stop, what to do, and what the repair will cost.",
    "اعرف فوراً هل يجب أن تتوقف، وما العمل، وكم سيكلّفك الإصلاح.",
  ),
  youGet: L("What you get", "ما الذي تحصل عليه"),

  // The severity language, taught here before it is met in anger.
  cardStopTitle: L("DANGER", "خطر"),
  cardStopLine: L("Stop the car now", "أوقف السيارة الآن"),
  cardCautionTitle: L("WARNING", "تحذير"),
  cardCautionLine: L("Keep going, carefully", "يمكنك المتابعة بحذر"),
  cardOkTitle: L("ALL CLEAR", "لا داعي للقلق"),
  cardOkLine: L("No need to stop", "لا يوجد ما يستدعي التوقف"),

  trialSafeTitle: L("Try {n} days free — no risk", "جرّب {n} أيام مجاناً — دون أي مخاطرة"),
  trialSafeBody: L(
    "Cancel any time before the trial ends and you are charged nothing.",
    "يمكنك الإلغاء في أي وقت قبل انتهاء التجربة دون أن يُخصم منك شيء.",
  ),

  trustCancel: L("Cancel any time", "إلغاء سهل في أي وقت"),
  trustArabic: L("Arabic throughout", "بالعربية بالكامل"),
  trustPrivate: L("Private and secure", "آمن وخاص"),
  restorePrior: L("Restore a previous purchase", "استعادة عملية شراء سابقة"),
  purchaseFailed: L("Purchase didn't complete", "لم تكتمل العملية"),
  purchaseFailedBody: L(
    "The subscription didn't activate. Try again.",
    "لم يُفعَّل الاشتراك. حاول مرة أخرى.",
  ),
  devMode: L("Test mode", "وضع تجريبي"),

  reminderBody: L(
    "Time for today's session — keep the streak alive",
    "حان وقت تمرين اليوم — لا تقطع السلسلة",
  ),
  reminderBodyScanner: L("Open the app and see what's new", "افتح التطبيق واطّلع على الجديد"),

  // gold assistant
  priceCheck: L("Price check", "فحص السعر"),
  todaysRate: L("Today's gold rate", "سعر الذهب اليوم"),
  perGram24k: L("per gram, 24K", "للغرام، عيار 24"),
  rateStale: L("Rate is over a day old — update it", "السعر أقدم من يوم — حدّثه"),
  setRate: L("Set rate", "حدّد السعر"),
  weightGrams: L("Weight in grams", "الوزن بالغرام"),
  karat: L("Karat", "العيار"),
  askingPrice: L("Price they're asking", "السعر المطلوب"),
  optional: L("optional", "اختياري"),
  metalValue: L("Gold value", "قيمة الذهب"),
  makingCharge: L("Making charge", "المصنعية"),
  ofGoldValue: L("of gold value", "من قيمة الذهب"),
  sellBackToday: L("If you sold it back today", "إن بعتها اليوم"),
  pureGoldIn: L("Pure gold in the piece", "الذهب الصافي في القطعة"),
  verdictFair: L("Fair — this is a normal making charge", "معقول — مصنعية طبيعية"),
  verdictHigh: L("High — worth negotiating", "مرتفعة — تستحق التفاوض"),
  verdictVeryHigh: L("Very high — you're paying for the shop, not the gold", "مرتفعة جداً — أنت تدفع للمحل لا للذهب"),
  verdictBelow: L("Below metal value — check the karat and weight again", "أقل من قيمة المعدن — راجع العيار والوزن"),
  enterRateFirst: L("Enter today's gold rate to check a price", "أدخل سعر الذهب اليوم لفحص السعر"),
  goldDisclaimer: L(
    "A photo cannot prove gold is solid rather than plated — only an acid, XRF or density test can. This reads the stamp and checks the maths on the price.",
    "لا تستطيع الصورة إثبات أن الذهب خالص وليس مطلياً، وإنما يثبت ذلك فحص الحمض أو XRF أو الكثافة. وهذا يقرأ الدمغة ويتحقق من حساب السعر.",
  ),

  // ---------------------------------------------------------------- lectures
  recording: L("Recording", "يسجّل"),
  processing: L("Studying", "يذاكر"),
  failed: L("Failed", "فشل"),
  endLecture: L("End the lecture", "إنهاء المحاضرة"),
  endLectureConfirm: L(
    "End the lecture and study it now? The recording stops here.",
    "هل ننهي المحاضرة ونذاكرها الآن؟ سيتوقف التسجيل هنا.",
  ),
  stillProcessing: L(
    "This lecture was left mid-study. Run it again to finish.",
    "توقفت هذه المحاضرة في منتصف المذاكرة. شغّلها مرة أخرى لتكتمل.",
  ),
  interrupted: L(
    "The recording stopped before the lecture ended.",
    "توقف التسجيل قبل انتهاء المحاضرة.",
  ),
  textAfterLecture: L(
    "Recording. The text is written up once the lecture ends.",
    "التسجيل جارٍ. ويُكتب النص بعد انتهاء المحاضرة.",
  ),
  liveWriterOff: L(
    "The live writer isn't running — the lecture is still recording, and the text comes after it ends.",
    "الكاتب المباشر متوقف — المحاضرة تُسجَّل، ويصل النص بعد انتهائها.",
  ),
  markImportant: L("Mark this important", "علّمها مهمة"),
  importantMoments: L("Important moments", "اللقطات المهمة"),
  markedByYou: L("you marked it", "علّمتها أنت"),
  newLecture: L("New lecture", "محاضرة جديدة"),
  lectureTitle: L("Lecture title", "عنوان المحاضرة"),
  untitledLecture: L("Untitled lecture", "محاضرة بدون عنوان"),
  pasteTitle: L("Paste lecture text", "لصق نص محاضرة"),
  pasteHint: L(
    "Paste a transcript you already have and Mahdar will study it the same way — minus the tone of voice, which only recording can hear.",
    "الصق نص محاضرة لديك ويذاكرها مَحضَر بالطريقة نفسها — دون النبرة، لأن النبرة لا يسمعها إلا التسجيل.",
  ),
  pasteHere: L("Paste the lecture text here…", "الصق نص المحاضرة هنا..."),
  study: L("Study it", "ذاكرها"),
  needMoreText: L("That's too short to study. Paste more of the lecture.", "النص قصير جداً. الصق مقطعاً أطول من المحاضرة."),
  micDeniedTitle: L("Mahdar can't hear the lecture", "مَحضَر لا يسمع المحاضرة"),
  openSettings: L("Open Settings", "افتح الإعدادات"),
  micDenied: L(
    "Mahdar needs the microphone to record the lecture. Allow it in Settings and come back.",
    "يحتاج مَحضَر إلى الميكروفون لتسجيل المحاضرة. اسمح له من الإعدادات ثم عد.",
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
    "هل نحذف المحاضرة وتسجيلها؟ لا يمكن التراجع.",
  ),
  longPressDeleteLecture: L(
    "Long-press any lecture to delete it",
    "اضغط مطوّلاً على أي محاضرة لحذفها",
  ),
  copied: L("Copied", "تم النسخ"),
  playerHint: L(
    "The lecture recording — tap any moment of emphasis to hear it again",
    "تسجيل المحاضرة — اضغط أي لحظة نبرة لتستمع إليها مجدداً",
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
  remindersOn: L("Reminders on", "التذكيرات مفعّلة"),
  easy: L("Easy", "بسيط"),
  medium: L("Medium", "متوسط"),
  hard: L("Hard", "صعب"),
  confHigh: L("High", "عالية"),
  confMedium: L("Medium", "متوسطة"),
  confLow: L("Low", "منخفضة"),
  noTasks: L("The lecturer didn't set anything.", "لم يكلّف المحاضر بشيء."),
  noTerms: L("No new terms were introduced.", "لا توجد مصطلحات جديدة."),
  noExam: L(
    "The lecturer never signalled what would be examined — nothing to predict from.",
    "لم يشر المحاضر إلى شيء يخص الامتحان، فلا أساس للتوقع.",
  ),
  noTone: L(
    "Nothing stood out in the lecturer's voice this time.",
    "لم يبرز شيء في صوت المحاضر هذه المرة.",
  ),
  keyPoints: L("Key points", "النقاط الأساسية"),
  transcribeFailed: L(
    "We couldn't transcribe the recording. The audio is kept — you can try again.",
    "تعذّر تفريغ التسجيل. والصوت محفوظ، ويمكنك المحاولة مرة أخرى.",
  ),
  freeLectureUsed: L(
    "You've used your free lecture. Subscribe to keep recording.",
    "استخدمت محاضرتك المجانية. اشترك لمتابعة التسجيل.",
  ),

  // Errors the screens raise themselves. The ones a server route sends back
  // live in ./errors, which the routes share.
  offline: L(
    "We couldn't reach the server. Check your connection and try again.",
    "تعذّر الوصول إلى الخادم. تأكد من اتصالك بالإنترنت وحاول مرة أخرى.",
  ),
  serverError: L("Something went wrong. Try again.", "حدث خطأ في أثناء التحليل. حاول مرة أخرى."),

  // ---- redesign: home, study, states ----------------------------------
  // Greeting picks the time of day. It is the only place the app addresses
  // the student by name, so it stays warm and then gets out of the way.
  goodMorning: L("Good morning", "صباح الخير"),
  goodAfternoon: L("Good afternoon", "مساء الخير"),
  goodEvening: L("Good evening", "مساء الخير"),
  readyToContinue: L(
    "Ready to pick up where you left off?",
    "هل نتابع من حيث توقفنا؟",
  ),
  letsRecord: L(
    "Record the lecture. Let Mahdar study with you.",
    "سجّل المحاضرة، ودع مَحضَر يذاكر معك.",
  ),
  continueLearning: L("Continue learning", "تابع من حيث توقفت"),
  todayPriorities: L("Today's priorities", "أولويات اليوم"),
  insights: L("What Mahdar noticed", "ما لاحظه مَحضَر"),
  percentDone: L("done", "مكتمل"),

  // Priorities. Counts come from the student's own data — never a placeholder.
  tasksDueSoon: L("tasks due soon", "مهام اقترب موعدها"),
  taskDueSoon: L("task due soon", "مهمة اقترب موعدها"),
  lectureToReview: L("lecture waiting to be reviewed", "محاضرة تنتظر المراجعة"),
  lecturesToReview: L("lectures waiting to be reviewed", "محاضرات تنتظر المراجعة"),
  examSignalsFound: L("exam mentions to go over", "إشارات امتحان تستحق المراجعة"),
  nothingUrgent: L("Nothing urgent today.", "لا شيء عاجل اليوم."),

  // AI Study. Grounded answers only — every claim carries where it came from.
  aiStudy: L("Ask Mahdar", "اسأل مَحضَر"),
  askAboutLectures: L("Ask about your lectures", "اسأل عن محاضراتك"),
  askPlaceholder: L("What did the professor say about…", "ماذا قال المحاضر عن…"),
  foundIn: L("Found in", "وجدناها في"),
  jumpToSource: L("Open the source", "افتح المصدر"),
  askNeedsLectures: L(
    "Record a lecture first — Mahdar only answers from what you recorded.",
    "سجّل محاضرة أولاً — لا يجيب مَحضَر إلا مما سجّلته.",
  ),
  askThinking: L("Reading your lectures…", "يقرأ محاضراتك…"),
  askNoAnswer: L(
    "Nothing in your lectures covers that yet.",
    "لا يوجد في محاضراتك ما يتحدث عن هذا حتى الآن.",
  ),
  askFailed: L("Couldn't answer that right now. Try again.", "تعذّرت الإجابة الآن. حاول مرة أخرى."),
  askSuggestion: L("What did the lecturer say about {term}?", "ماذا قال المحاضر عن {term}؟"),
  askYou: L("You asked", "سألت"),
  askAboutLine: L(
    "What did the lecturer mean by: “{text}”?",
    "ماذا قصد المحاضر بـ«{text}»؟",
  ),
  askClear: L("Start over", "من جديد"),

  // Task candidates. Extracted, then confirmed — never silently committed.
  newTaskFound: L("New task found", "وجدنا مهمة جديدة"),
  newTasksFound: L("New tasks found", "وجدنا مهام جديدة"),
  addTask: L("Add task", "أضفها"),
  dismissTask: L("Not a task", "ليست مهمة"),
  addedTask: L("Added", "أُضيفت"),
  filterAll: L("All", "الكل"),
  filterDueSoon: L("Due soon", "اقترب موعدها"),
  filterDone: L("Completed", "المكتملة"),
  source: L("Source", "المصدر"),

  // Concepts panel.
  whereItAppeared: L("Where it came up", "أين ذُكر"),
  relatedConcepts: L("Related", "مرتبط به"),
  mentionsCount: L("mentions", "مرات ذكر"),

  // Transcript tools.
  playFromHere: L("Play from here", "شغّل من هنا"),
  askAboutThis: L("Ask about this", "اسأل عن هذه"),
  nowPlaying: L("Playing", "قيد التشغيل"),
  transcriptHint: L(
    "Tap a line to hear it. Hold it to ask about it.",
    "اضغط السطر لتستمع إليه، واضغط مطوّلاً لتسأل عنه.",
  ),

  // Recording lifecycle, named stage by stage rather than as one spinner.
  mahdarIsListening: L("Mahdar is listening", "مَحضَر يستمع"),
  stepSaved: L("Recording saved", "حُفظ التسجيل"),
  stepTranscribing: L("Turning speech into text", "يحوّل الصوت إلى نص"),
  stepMoments: L("Finding the important moments", "يحدد اللحظات المهمة"),
  stepTasks: L("Listening for assignments", "يبحث عن الواجبات"),
  stepStudyView: L("Building your study view", "يجهّز صفحة المذاكرة"),
  lectureIsReady: L("The lecture is ready.", "المحاضرة جاهزة."),

  // Empty states. The room is quiet, not broken.
  emptyLecturesTitle: L("Your lecture hall is quiet — for now.", "قاعة محاضراتك هادئة… حتى الآن."),
  emptyTasksTitle: L("Nothing is waiting for you.", "لا شيء في انتظارك."),
  emptyTasksBody: L(
    "Assignments your lecturer mentions will land here on their own.",
    "الواجبات التي يذكرها المحاضر تصل إلى هنا تلقائياً.",
  ),
  emptySearchTitle: L("Search everything you recorded.", "ابحث في كل ما سجّلته."),

  // Errors that keep the recording safe.
  savedButOffline: L(
    "Your lecture is saved. We'll finish processing when you're back online.",
    "محاضرتك محفوظة. وسنكمل التحليل عند عودة الاتصال.",
  ),
  savedButAnalysisFailed: L(
    "The lecture was saved, but the analysis couldn't finish yet.",
    "حُفظت المحاضرة، لكن التحليل لم يكتمل.",
  ),
  retryAnalysis: L("Try analysing again", "أعد المحاولة"),

  // Plan status in the sidebar. Stated once, never sold.
  planPro: L("Full access", "اشتراك كامل"),
  planFree: L("Free plan", "الخطة المجانية"),
  lecturesLeft: L("lectures left", "محاضرات باقية"),

  // Insight sentences. Whole sentences per language rather than fragments
  // glued around a number — Arabic puts the count somewhere else entirely.
  insightRepeated: L(
    "Your lecturer kept coming back to “{term}” across {n} lectures.",
    "عاد محاضرك إلى «{term}» في {n} محاضرات.",
  ),
  insightExam: L(
    "Your lecturer said “{topic}” may come up in the exam.",
    "ذكر محاضرك أن «{topic}» قد يرد في الامتحان.",
  ),
  insightTasks: L(
    "{n} pieces of work came out of this week's lectures.",
    "{n} واجبات استُخرجت من محاضرات هذا الأسبوع.",
  ),

  // ---- Dash Light redesign --------------------------------------------
  // The result screen's four views. Short labels: four have to fit across a
  // small phone without any of them being cut off.
  resultTitle: L("Result", "النتيجة"),
  scanTab: L("Scan", "افحص"),
  // Counted properly rather than glued together: "0 free scan left" is the
  // kind of line that makes an app look unfinished on the first screen.
  scanQuotaNone: L("No free scans left", "لم يبقَ فحص مجاني"),
  scanQuotaOne: L("1 free scan left", "بقي فحص مجاني واحد"),
  // Arabic counts two as its own grammatical form, and two is now where every
  // driver starts — so "2 فحوصات" would be wrong on the first screen they see.
  scanQuotaTwo: L("2 free scans left", "بقي فحصان مجانيان"),
  scanQuotaMany: L("{n} free scans left", "بقيت {n} فحوصات مجانية"),
  // The grade of a light, as a word. Colour alone is not a signal a
  // colour-blind driver can read, and this is the screen where being misread
  // has a physical consequence.
  gradeCritical: L("CRITICAL", "خطورة عالية"),
  gradeWarning: L("WARNING", "تحذير"),
  gradeInfo: L("INFO", "معلومة"),
  resTabSummary: L("Summary", "الخلاصة"),
  resTabCauses: L("Causes", "الأسباب"),
  resTabActions: L("What to do", "ما العمل"),
  resTabAlso: L("Also lit", "مصابيح أخرى"),

  // The camera screen.
  torchOn: L("Light on", "الإضاءة جيدة"),
  torchOff: L("Light", "إضاءة"),
  holdSteady: L("Hold steady", "ثبّت الهاتف"),
  takesSeconds: L("This takes a few seconds", "يستغرق ثوانٍ"),

  // Nothing usable in the photo. Never phrased as the driver's mistake.
  notDetectedTitle: L("We couldn't read a warning light", "تعذّرت قراءة المصباح"),
  tipsToTry: L("Try again like this", "جرّب هكذا"),
  retakePhoto: L("Retake the photo", "صوّر مرة أخرى"),
  chooseFromGallery: L("Choose from gallery", "اختر من المعرض"),

  // The light guide.
  searchLights: L("Search {n} lights", "ابحث في {n} مصباحاً"),
  // Short enough to sit in a filter chip. The grade words above are the full
  // labels used where there is room for them.
  filterCritical: L("Danger", "خطر"),
  filterWarning: L("Warning", "تحذير"),
  filterInfo: L("Normal", "عادي"),
  severityLevel: L("Severity", "مستوى الخطورة"),
  whatItMeans: L("What it means", "ما معناها"),
  commonCauses: L("Common causes", "الأسباب الشائعة"),
  whatToDoNow: L("What to do now", "ما العمل الآن"),

  /* The report behind the paywall.
     Each line names something this particular result actually contains — an
     empty promise on a locked panel is a worse sale than no panel at all. */
  fullReport: L("The full report", "التقرير الكامل"),
  fullReportSub: L(
    "We know which light it is. There are details worth reading before you act.",
    "عرفنا المصباح. لكن هناك تفاصيل مهمة قبل أن تتصرّف.",
  ),
  openFullReport: L("Open the full report", "افتح التقرير الكامل"),

  /* ---- the roadside decision ------------------------------------------
     The model picks one of four classes; these are the words for them. They
     live here, not in the model's output, because an instruction that can get
     somebody hurt should be the same every time for the same class, written
     once, in reviewed Arabic. */
  roadDoNotMoveTitle: L("Do not move the car", "لا تحرّك السيارة"),
  roadDoNotMoveLine: L(
    "Leaving it where it is does less harm than driving it.",
    "تركها مكانها أقل ضرراً من تحريكها.",
  ),
  roadMoveToSafetyTitle: L("Move only to somewhere safe", "تحرّك إلى مكان آمن فقط"),
  roadMoveToSafetyLine: L(
    "Do not continue the journey. Get off the carriageway and stop.",
    "لا تُكمل الرحلة. اخرج عن مسار السير وتوقّف.",
  ),
  roadDriveWithCareTitle: L("You can continue, carefully", "يمكنك المتابعة بحذر"),
  roadDriveWithCareLine: L(
    "Ease off the speed and book a check soon.",
    "خفّف السرعة واحجز موعد فحص قريباً.",
  ),
  roadMonitorTitle: L("Keep an eye on it", "راقب الوضع"),
  roadMonitorLine: L("Nothing to change right now.", "لا حاجة إلى تغيير شيء الآن."),

  safePlaceQuestion: L("Are you somewhere safe?", "هل أنت في مكان آمن؟"),
  safePlaceYes: L("Yes", "نعم"),
  safePlaceNo: L("No", "لا"),
  safePlaceGood: L(
    "Good. Switch the engine off and stay clear of moving traffic.",
    "جيد. أطفئ المحرّك وابقَ بعيداً عن مسار السير.",
  ),
  safePlaceSteps: [
    L("Turn your hazard lights on now.", "شغّل أضواء التحذير الآن."),
    L(
      "Ease over to the hard shoulder or the nearest exit — no sudden braking.",
      "اتّجه تدريجياً إلى كتف الطريق أو أقرب مخرج، دون فرملة مفاجئة.",
    ),
    L(
      "Stop as far from moving traffic as you can.",
      "توقّف بعيداً عن مسار السير قدر المستطاع.",
    ),
    L(
      "Get out on the side away from traffic, and stand behind the barrier if there is one.",
      "اخرج من الجهة البعيدة عن السير، وقف خلف الحاجز إن وُجد.",
    ),
    L("Call for roadside help.", "اطلب المساعدة على الطريق."),
  ],

  /* Sits with the verdict, in the verdict's own colour — not in the footer.
     The app read a lamp; the driver is sitting in the whole car. */
  lampOnly: L(
    "This reading is from the lamp alone. If you see smoke, smell burning, hear an unusual noise, or the car handles differently — stop, whatever this says.",
    "هذه القراءة مبنيّة على المصباح وحده. فإن رأيت دخاناً أو شممت رائحة احتراق أو سمعت صوتاً غير معتاد أو تغيّرت استجابة السيارة — فأوقفها مهما قالت هذه النتيجة.",
  ),

  /* The day before the trial converts. Deliberately plain: this exists so
     that nobody pays because they lost track of a date. */
  trialEndsTitle: L("Your trial ends tomorrow", "تنتهي تجربتك غداً"),
  trialEndsBody: L(
    "The subscription starts at {price} unless you cancel first. You can cancel from your account settings.",
    "يبدأ الاشتراك بـ {price} ما لم تُلغِ قبل ذلك. ويمكنك الإلغاء من إعدادات حسابك.",
  ),
  trialEndsBodyNoPrice: L(
    "The paid subscription starts unless you cancel first. You can cancel from your account settings.",
    "يبدأ الاشتراك المدفوع ما لم تُلغِ قبل ذلك. ويمكنك الإلغاء من إعدادات حسابك.",
  ),
  reportCauses: L("The likely causes", "الأسباب المحتملة"),
  reportIfIgnored: L("What happens if you ignore it", "ما الذي يحدث إذا أهملتها"),
  reportActions: L("What to do, step by step", "خطوات التصرّف، واحدة تلو الأخرى"),
  reportCost: L("What the repair should cost", "تقدير تكلفة الإصلاح"),
  reportCar: L("What it means on your own car", "ماذا تعني في سيارتك تحديداً"),
  reportAlso: L("Every other light that is lit", "بقية المصابيح المضيئة في الصورة"),
  backToList: L("Back to the list", "العودة إلى القائمة"),
  allLights: L("All", "الكل"),

  // Onboarding and paywall.
  skipQuestion: L("Skip", "تخطّى"),
  startTrialDays: L("Start {n}-day trial", "ابدأ تجربة {n} أيام"),
  /* Stated once, above the plans, because Apple grants one introductory offer
     per subscription group — not one per plan. Printing "3 days free" on both
     rows describes two offers that do not exist. */
  trialOnceTitle: L("Start {n} days free", "ابدأ {n} أيام مجاناً"),
  trialOnceBody: L("Then the plan you pick below. Cancel any time before it ends.", "ثم الخطة التي تختارها أدناه. ويمكنك الإلغاء في أي وقت قبل انتهائها."),
  perWeekEquivalent: L("{price} a week", "{price} أسبوعياً"),
  subscribeNow: L("Subscribe", "اشترك"),
  bestValue: L("Best value", "الأوفر"),

  // ---- settings ---------------------------------------------------------
  // These were hardcoded Arabic, which left the English build showing Arabic
  // section headers to someone who had chosen English.
  reminderEnable: L("Turn on the daily reminder", "فعّل التذكير اليومي"),
  reminderLater: L("An hour later", "أخّر ساعة"),
  reminderLocalNote: L(
    "The reminder is local to your device — it never passes through a server.",
    "تذكير محلي على جهازك، لا يمر بأي خادم.",
  ),
  resetProgressQ: L("Reset your progress?", "تصفير التقدّم؟"),
  resetDo: L("Reset", "صفّر"),
  resetDoneBody: L("You're back at the start.", "عاد كل شيء إلى البداية."),
  clearScansQ: L("Delete every scan?", "مسح كل الفحوصات؟"),
  clearDo: L("Delete", "امسح"),
  clearDone: L("Deleted", "تم المسح"),
  clearDoneBody: L("No saved scans are left.", "لم يبقَ أي فحص محفوظ."),
  noPriorPurchase: L("No subscription found", "لم نجد اشتراكاً"),
  noPriorPurchaseBody: L(
    "There's no earlier subscription on this account.",
    "لا يوجد اشتراك سابق على هذا الحساب.",
  ),
};
