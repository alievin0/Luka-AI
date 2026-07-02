"""الأفعال المتاحة للعقل — كل أداة هنا تُنفّذ عبر واجهة الجسم.

إضافة قدرة جديدة للروبوت = أداة جديدة هنا + دالة في RobotBody.
"""

TOOLS = [
    {
        "name": "move",
        "description": "تحرك للأمام أو للخلف لمدة محددة. الجسم يتوقف تلقائياً "
                       "إذا اقترب عائق، وسترى في النتيجة ما حدث فعلاً.",
        "input_schema": {
            "type": "object",
            "properties": {
                "direction": {"type": "string", "enum": ["forward", "backward"]},
                "duration_s": {"type": "number", "description": "المدة بالثواني (0.5 إلى 5)"},
            },
            "required": ["direction", "duration_s"],
        },
    },
    {
        "name": "rotate",
        "description": "در في مكانك يميناً أو يساراً بعدد درجات محدد.",
        "input_schema": {
            "type": "object",
            "properties": {
                "direction": {"type": "string", "enum": ["left", "right"]},
                "degrees": {"type": "number", "description": "الدرجات (مثلاً 45 أو 90)"},
            },
            "required": ["direction", "degrees"],
        },
    },
    {
        "name": "look",
        "description": "حرّك رأس/كاميرا الروبوت. pan: يمين/يسار (-90 إلى 90)، "
                       "tilt: فوق/تحت (-45 إلى 45). صفر,صفر = للأمام.",
        "input_schema": {
            "type": "object",
            "properties": {
                "pan_degrees": {"type": "number"},
                "tilt_degrees": {"type": "number"},
            },
            "required": ["pan_degrees", "tilt_degrees"],
        },
    },
    {
        "name": "speak",
        "description": "انطق جملة بصوت مسموع للناس حولك. استخدمها للترحيب "
                       "والرد ووصف ما تفعله.",
        "input_schema": {
            "type": "object",
            "properties": {"text": {"type": "string"}},
            "required": ["text"],
        },
    },
    {
        "name": "remember",
        "description": "احفظ ملاحظة دائمة في ذاكرتك طويلة المدى (تبقى بين "
                       "الجلسات). احفظ ما تتعلمه عن المكان والناس، لا الأحداث العابرة.",
        "input_schema": {
            "type": "object",
            "properties": {"note": {"type": "string", "description": "الملاحظة بسطر واحد"}},
            "required": ["note"],
        },
    },
    {
        "name": "wait",
        "description": "انتظر بهدوء ثم افحص الحساسات من جديد. استخدمها عندما "
                       "لا يوجد ما تفعله الآن أو تنتظر شيئاً يتغير.",
        "input_schema": {
            "type": "object",
            "properties": {"seconds": {"type": "number", "description": "1 إلى 30"}},
            "required": ["seconds"],
        },
    },
]
