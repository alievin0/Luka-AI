"""THE MODEL GATE — the world does not belong to a model vendor.

A world wired to one paid provider is a world whose real infrastructure belongs
to that provider. Everything above this file — identities, contracts, memory,
projects, tasks, events, policies, budgets, the factory, the UI — is the
Owner's, runs locally, and must keep running when no model exists at all.

Below this file the model is an interchangeable execution engine. Nothing above
it may name a vendor.

Three modes, chosen by environment and nothing else:

    OFFLINE      no network call of any kind is attempted, by anyone
    LOCAL_ONLY   only a local inference endpoint may be used; cloud is refused
    OPEN         local is tried FIRST, cloud only if the Owner configured one

`OPEN` is not "prefer cloud". Local comes first in every mode that permits it,
because the dependency must never be the other way round.

**No fake autonomy.** When no engine answers, work that needs inference is
parked as WAITING_FOR_MODEL. It is not failed, not retried into an error, and
above all not simulated: an agent that did not run did not run, and the world
says so on its own screen.
"""
import os

from . import provider as P

OFFLINE, LOCAL_ONLY, OPEN = "OFFLINE", "LOCAL_ONLY", "OPEN"

# The names the Owner sets. Vendor-neutral, and neither has a default model:
# guessing a model name means guessing what the Owner installed.
URL_VARS = ("LOCAL_MODEL_URL", "OLLAMA_URL")          # second is legacy
NAME_VARS = ("LOCAL_MODEL_NAME", "CIV_LOCAL_MODEL")   # second is legacy
DEFAULT_LOCAL_URL = "http://127.0.0.1:11434"


def _truthy(v):
    return str(v or "").strip().lower() in ("1", "true", "yes", "on")


def mode():
    """Which mode this process is in. Environment only — never inferred."""
    if _truthy(os.environ.get("OFFLINE_MODE")):
        return OFFLINE
    if _truthy(os.environ.get("LOCAL_ONLY")):
        return LOCAL_ONLY
    return OPEN


def local_url():
    for v in URL_VARS:
        if os.environ.get(v):
            return os.environ[v].rstrip("/")
    return DEFAULT_LOCAL_URL


def local_name():
    """The model the Owner asked for, or None.

    Deliberately no default. A hardcoded model name is a guess about someone
    else's machine, and a guess that is wrong looks exactly like a broken
    world."""
    for v in NAME_VARS:
        if os.environ.get(v):
            return os.environ[v]
    return None


def discover_local(timeout=2.0):
    """Ask a local runtime what it has. Returns [] when nothing answers.

    This is the only network call this module ever makes, it goes to localhost,
    and OFFLINE refuses even that."""
    if mode() == OFFLINE:
        return []
    import json
    import urllib.error
    import urllib.request
    base = local_url()
    for path, key in (("/api/tags", "models"), ("/v1/models", "data")):
        try:
            with urllib.request.urlopen(base + path, timeout=timeout) as r:
                out = json.loads(r.read().decode("utf-8"))
        except (urllib.error.URLError, OSError, ValueError):
            continue
        rows = out.get(key) or []
        names = [(m.get("name") or m.get("id") or "").strip() for m in rows
                 if isinstance(m, dict)]
        return [n for n in names if n]
    return []


def select(force=None):
    """Return (provider, why). Local first, cloud never mandatory, no guessing.

    The return is always a Provider — `NotConfigured` when nothing is available
    — so callers never branch on None and never accidentally proceed."""
    m = force or mode()
    if m == OFFLINE:
        return P.NotConfigured("OFFLINE_MODE: no inference engine may be contacted"), \
               "offline by configuration"

    name = local_name()
    if name is None:
        found = discover_local()
        name = found[0] if found else None
    if name:
        lp = P.LocalProvider(model=name, url=local_url() + "/api/generate")
        if lp.available():
            return lp, "local runtime at %s serving %r" % (local_url(), name)

    if m == LOCAL_ONLY:
        return P.NotConfigured(
            "LOCAL_ONLY: no local inference engine answering at %s" % local_url()), \
            "local only, and nothing local is running"

    want = (os.environ.get("CIV_PROVIDER") or "").strip().lower()
    if want and want not in ("local", "mock"):
        # A cloud provider is an ADAPTER the Owner opted into by name. It is
        # never selected because a key happens to be lying around in the
        # environment — that is how a world acquires a vendor by accident.
        p = P.from_env()
        if p.available():
            return p, "cloud adapter %r, explicitly configured" % want
        return p, p.why_unavailable()
    return P.NotConfigured(
        "no local engine, and no cloud adapter was explicitly configured"), \
        "nothing configured; the world runs, inference does not"


def available(force=None):
    p, _ = select(force)
    return bool(p.available())


def status(con=None):
    """What the Owner should be told, in four lines that cannot flatter.

    WORLD and RUNTIME are ONLINE because this process is running and the
    database answered. MODEL is whatever actually answered, which is usually
    OFFLINE, and WORK says WAITING_FOR_MODEL when anything is parked."""
    p, why = select()
    ok = bool(p.available())
    waiting = 0
    if con is not None:
        try:
            waiting = con.execute(
                "SELECT COUNT(*) c FROM world_queue WHERE state='WAITING_FOR_MODEL'"
            ).fetchone()["c"]
        except Exception:                                   # noqa: BLE001
            waiting = 0
    return {
        "mode": mode(),
        "world": "ONLINE",
        "runtime": "ONLINE",
        "agents": "PERSISTENT",
        "model": "ONLINE" if ok else "OFFLINE",
        "provider": p.name,
        "engine": getattr(p, "model", None),
        "why": why if not ok else "",
        "work": "WAITING_FOR_MODEL" if waiting else ("READY" if ok else "IDLE"),
        "waiting": waiting,
        "local_url": local_url(),
        "local_name": local_name(),
        "cloud_configured": bool((os.environ.get("CIV_PROVIDER") or "").strip()
                                 and mode() == OPEN),
    }
