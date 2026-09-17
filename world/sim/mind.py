"""العقل: من أين يأتي كلام الوكيل.

ثلاثة أوضاع، ويُختار الوضع من البيئة لا من الكود:

  offline  (الافتراضي) — بلا إنترنت وبلا مفتاح. العالم يعيش ويشتغل ويرتّب،
           لكن نصّ الأعضاء يُركّب من المعاجم. صادق: هذا ليس تفكيراً، هذا تشغيل.
  ollama   — نموذج محلي على نفس اللابتوب. WORLD_MIND=ollama
  claude   — تفكير حقيقي. WORLD_MIND=claude + ANTHROPIC_API_KEY

كل استدعاء للنموذج يُحسب ويُسجَّل، لأن التكلفة على اللابتوب مسألة حقيقية.
"""
import json
import os
import urllib.error
import urllib.request

from . import names

MODE = (os.environ.get("WORLD_MIND") or "offline").strip().lower()
MODEL = os.environ.get("WORLD_MODEL") or "claude-sonnet-5"
OLLAMA_URL = os.environ.get("OLLAMA_URL") or "http://127.0.0.1:11434/api/generate"
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL") or "qwen2.5:7b"

CALLS = {"asked": 0, "served": 0, "failed": 0, "tokens_in": 0, "tokens_out": 0}


def available():
    if MODE == "claude":
        return bool(os.environ.get("ANTHROPIC_API_KEY"))
    return MODE == "ollama"


def describe():
    if MODE == "claude":
        return "claude · %s%s" % (MODEL, "" if os.environ.get("ANTHROPIC_API_KEY") else "  ⚠ بلا مفتاح — يرجع offline")
    if MODE == "ollama":
        return "ollama · %s" % OLLAMA_MODEL
    return "offline · بلا نموذج (تشغيل فقط، ليس تفكيراً)"


# ── الوضع بلا نموذج ────────────────────────────────────────────────
def _offline(agent, idea, organ, rng):
    """يركّب نصاً من المعاجم. قوته من مهارة الوكيل، لا من جودة النص."""
    sector = idea["sector"] or "قطاع"
    if organ == "frequency":
        text = rng.choice(["يومياً في وقت الإقفال", "كل أسبوع مع نهاية الدوام",
                           "كل شهر في أول خمسة أيام", "كل ربع مع الإقرار"])
    elif organ == "price":
        text = "يدفع اليوم %d–%d د.ك شهرياً عبر %s" % (
            rng.randrange(40, 180, 10), rng.randrange(200, 700, 25), rng.choice(names.COPING))
    elif organ == "proof":
        text = "%s في %s دفع فعلاً — ما زال يدفع" % (
            rng.choice(names.MALE + names.FEMALE) + " " + rng.choice(names.FAMILY), sector)
    elif organ == "cost":
        text = "خدمته تكلّفنا %d–%d د.ك شهرياً" % (rng.randrange(10, 50, 5), rng.randrange(60, 160, 10))
    elif organ == "channel":
        text = rng.choice(names.CHANNELS)
    elif organ == "moat":
        text = rng.choice(names.MOATS)
    else:
        # الوجع ليس عشوائياً: هو وجع هذه الفكرة بعينها، كما رآه الكشّاف
        own = (idea["title"].split(": ", 1) + [""])[1]
        text = own or rng.choice(names.PAINS)
    base = 0.22 + agent["skill"] * 0.55 + agent["eye"] * 0.18
    return text, max(0.05, min(0.96, base + rng.uniform(-0.12, 0.12)))


# ── النماذج ────────────────────────────────────────────────────────
def _post(url, payload, headers, timeout=60):
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def _claude(prompt, system):
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        raise RuntimeError("ANTHROPIC_API_KEY غير موجود")
    out = _post(
        "https://api.anthropic.com/v1/messages",
        {"model": MODEL, "max_tokens": 400, "system": system,
         "messages": [{"role": "user", "content": prompt}]},
        {"content-type": "application/json", "x-api-key": key,
         "anthropic-version": "2023-06-01"},
    )
    usage = out.get("usage") or {}
    CALLS["tokens_in"] += usage.get("input_tokens", 0)
    CALLS["tokens_out"] += usage.get("output_tokens", 0)
    parts = [b.get("text", "") for b in out.get("content", []) if b.get("type") == "text"]
    return "".join(parts).strip()


def _ollama(prompt, system):
    out = _post(OLLAMA_URL,
                {"model": OLLAMA_MODEL, "prompt": prompt, "system": system,
                 "stream": False, "options": {"num_predict": 400}},
                {"content-type": "application/json"}, timeout=180)
    return (out.get("response") or "").strip()


SYSTEM = (
    "أنت وكيل يعيش في عالم مغلق مهمته الوحيدة: بناء أفكار تجارية لها جسد حقيقي.\n"
    "تكتب بالعربية، بجملة أو جملتين، ملموسة ومحددة بالأرقام والأسماء.\n"
    "ممنوع: الكلام العام، «حلول مبتكرة»، «يوفر الوقت»، أي وعد بلا رقم.\n"
    "إن لم تكن تعرف، قل لا أعرف — الاعتراف أنفع من التلفيق، لأن فكرة تُبنى "
    "على رقم ملفّق تكلّف صاحبها سنة من عمره."
)


def _prompt(agent, idea, organ, bodytext):
    return (
        "أنت %s، %s في %s. طبعك: %s\n\n"
        "الفكرة: %s\nالقطاع: %s\n\n"
        "جسد الفكرة حتى الآن:\n%s\n\n"
        "المطلوب منك عضو واحد فقط: «%s» — %s\n\n"
        "أجب بـ JSON فقط بهذا الشكل، بلا أي نص قبله أو بعده:\n"
        '{"text": "جملة أو جملتين", "strength": 0.0-1.0, "why": "سبب الدرجة بكلمات قليلة"}\n'
        "strength = كم أنت واثق أن هذا العضو صحيح ومسنود، لا كم هو جميل."
        % (agent["name"], agent["role"], names.HOUSES[agent["house"]]["ar"], agent["trait"],
           idea["title"], idea["sector"] or "—", bodytext,
           names.ORGAN_AR.get(organ, organ), names.ORGAN_ASK.get(organ, ""))
    )


def think(agent, idea, organ, bodytext, rng):
    """يرجع (نص، قوة، مصدر). لا يرمي استثناء أبداً — العالم لا يتوقف."""
    CALLS["asked"] += 1
    if not available():
        t, s = _offline(agent, idea, organ, rng)
        return t, s, "offline"
    try:
        raw = _claude(_prompt(agent, idea, organ, bodytext), SYSTEM) if MODE == "claude" \
            else _ollama(_prompt(agent, idea, organ, bodytext), SYSTEM)
        start, end = raw.find("{"), raw.rfind("}")
        if start >= 0 and end > start:
            got = json.loads(raw[start:end + 1])
            text = str(got.get("text", "")).strip()
            strength = float(got.get("strength", 0.5))
            if text:
                CALLS["served"] += 1
                # مهارة الوكيل سقفٌ على ثقته: الضعيف لا يُصدَّق بالكامل
                cap = 0.45 + agent["skill"] * 0.55
                return text, max(0.05, min(cap, strength)), MODE
    except (urllib.error.URLError, urllib.error.HTTPError, ValueError,
            KeyError, TypeError, RuntimeError, OSError):
        pass
    CALLS["failed"] += 1
    t, s = _offline(agent, idea, organ, rng)
    return t, s, "offline"
