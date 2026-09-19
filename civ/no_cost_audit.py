#!/usr/bin/env python3
"""IS THERE A NO-COST REAL MODEL HERE?  python3 no_cost_audit.py

The question is not "could a local model work" — `LocalProvider` has always
been able to drive one. It is whether a real model is actually reachable from
*this* machine without paying for it. That is a fact about the environment, not
about the code, so it is answered by looking rather than by assuming.

Nothing here spends anything. It makes no call to any paid endpoint: the
reachability probes are bare HTTPS connections to hosts that distribute weights
or serve free inference, and they carry no credential, so a host that answers
is proving it is *reachable*, not being used.

    $ python3 no_cost_audit.py
    ...
    NO-COST REAL INFERENCE REACHABLE BUT NOT USABLE — no key

It exits 0 when a usable no-cost model is found and 1 when it is not, so it can
gate a script.

The verdict distinguishes four states, because "no" covers two very different
situations and conflating them would be the dishonest part:

    AVAILABLE                  something is serving, or a free-tier key is set
    REACHABLE BUT NOT USABLE   a free endpoint answers; it wants a key nobody set
    NOT YET RUNNING            a runtime is here, or weights can be fetched
    NOT AVAILABLE              none of the above: only paid endpoints answer

Every one of those is a fact about the MACHINE, not about this code. Any of
them can change without a line of this repository changing.
"""
import argparse
import json
import os
import shutil
import socket
import sys
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

BAR = "─" * 78

# Runtimes that would mean a model can already be run locally.
RUNTIMES = ("ollama", "llama-server", "llama-cli", "vllm", "localai", "jan",
            "gpt4all", "koboldcpp", "mlx_lm", "lmstudio")

# Python packages that would mean the same.
PACKAGES = ("llama_cpp", "ctransformers", "gpt4all", "onnxruntime_genai",
            "vllm", "mlx_lm", "transformers", "torch")

# Ports the common local servers listen on. `llama-server`, LM Studio, vLLM and
# LocalAI all speak the OpenAI wire format; Ollama speaks its own.
PORTS = ((11434, "ollama"), (8080, "llama-server"), (1234, "lm-studio"),
         (8000, "vllm/localai"), (5000, "text-generation-webui"), (8001, "other"))

# Hosts that distribute model weights. Reachability only — no credential is
# sent and nothing is downloaded.
WEIGHT_HOSTS = ("huggingface.co", "cdn-lfs.huggingface.co", "registry.ollama.ai",
                "ollama.com", "gpt4all.io", "hf-mirror.com", "modelscope.cn",
                "openaipublic.blob.core.windows.net", "dl.fbaipublicfiles.com")

# Hosts that serve inference. Reachability only — no request is made to any of
# them, because a request to a paid endpoint is a charge.
INFERENCE_HOSTS = ("api.groq.com", "openrouter.ai", "api.together.xyz",
                   "api.cohere.ai", "generativelanguage.googleapis.com",
                   "api.openai.com", "api.mistral.ai")

PAID = {"api.anthropic.com", "api.openai.com", "api.cohere.ai", "api.mistral.ai"}

# Endpoints with a real free tier: no payment method, no credit, no card. Each
# still needs a key, which the Owner creates and this project cannot.
FREE_TIER = {
    "generativelanguage.googleapis.com":
        ("Google AI Studio", ("GEMINI_API_KEY", "GOOGLE_API_KEY"), "gemini"),
    "api.groq.com": ("Groq", ("GROQ_API_KEY",), "openai-compat"),
    "openrouter.ai": ("OpenRouter (free models)", ("OPENROUTER_API_KEY",),
                      "openai-compat"),
}


def say(s=""):
    print(s, flush=True)


def head(t):
    say("\n" + BAR)
    say(t)
    say(BAR)


def reachable(host, timeout=8):
    """Can we open a TLS connection at all? No request is sent."""
    try:
        req = urllib.request.Request("https://%s/" % host, method="HEAD")
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return True, "HTTP %s" % r.status
    except urllib.error.HTTPError as e:
        return True, "HTTP %s" % e.code          # answered, so it is reachable
    except (urllib.error.URLError, OSError, ValueError) as e:
        return False, str(getattr(e, "reason", e))[:44]


def listening(port, host="127.0.0.1", timeout=1.0):
    s = socket.socket()
    s.settimeout(timeout)
    try:
        s.connect((host, port))
        return True
    except OSError:
        return False
    finally:
        s.close()


def audit(check_network=True):
    found = {"runtimes": [], "packages": [], "weights": [], "ports": [],
             "weight_hosts": [], "inference_hosts": [], "free_inference": []}

    head("1. A LOCAL RUNTIME ALREADY INSTALLED")
    for b in RUNTIMES:
        p = shutil.which(b)
        if p:
            found["runtimes"].append(b)
        say("  %-16s %s" % (b, p or "-"))

    import importlib.util as iu
    say("")
    for m in PACKAGES:
        try:
            spec = iu.find_spec(m)
        except (ImportError, ValueError):
            spec = None
        if spec:
            found["packages"].append(m)
        say("  %-16s %s" % (m, "installed" if spec else "-"))

    head("2. MODEL WEIGHTS ON DISK")
    roots = [os.path.expanduser("~/.ollama"), os.path.expanduser("~/.cache/huggingface"),
             "/opt/models", "/models", os.path.join(HERE, "models")]
    for r in roots:
        there = os.path.isdir(r)
        if there:
            found["weights"].append(r)
        say("  %-34s %s" % (r, "present" if there else "-"))

    head("3. SOMETHING ALREADY LISTENING")
    for port, what in PORTS:
        up = listening(port)
        if up:
            found["ports"].append((port, what))
        say("  127.0.0.1:%-6d %-24s %s" % (port, what, "OPEN" if up else "closed"))

    if not check_network:
        return found

    head("4. CAN WEIGHTS BE FETCHED AT ALL?")
    for h in WEIGHT_HOSTS:
        ok, why = reachable(h)
        if ok:
            found["weight_hosts"].append(h)
        say("  %-36s %s" % (h, why if ok else "unreachable (%s)" % why))

    head("5. IS ANY FREE INFERENCE ENDPOINT REACHABLE?")
    say("  Reachability only. No request is made and no credential is sent —")
    say("  a call to a paid endpoint is a charge, and this audit does not spend.")
    say("")
    for h in INFERENCE_HOSTS:
        ok, why = reachable(h)
        if ok:
            found["inference_hosts"].append(h)
            if h not in PAID:
                found["free_inference"].append(h)
        say("  %-36s %-14s %s" % (h, why if ok else "unreachable",
                                  "(paid)" if h in PAID else ""))
    return found


def key_for(host):
    """Is a credential for this free-tier host already in the environment?"""
    _, names, _ = FREE_TIER.get(host, (None, (), None))
    return next((n for n in names if os.environ.get(n)), None)


def verdict(found):
    head("VERDICT")
    usable = bool(found["runtimes"] or found["packages"] or found["ports"])
    can_get = bool(found["weight_hosts"])
    free_ready = [h for h in found["free_inference"] if key_for(h)]
    free_waiting = [h for h in found["free_inference"]
                    if h in FREE_TIER and not key_for(h)]

    say("  a runtime is installed           %s"
        % (", ".join(found["runtimes"] + found["packages"]) or "NO"))
    say("  something is listening           %s"
        % (", ".join("%d/%s" % p for p in found["ports"]) or "NO"))
    say("  weights are on disk              %s"
        % (", ".join(found["weights"]) or "NO"))
    say("  a weight host is reachable       %s"
        % (", ".join(found["weight_hosts"]) or "NO"))
    say("  free inference is reachable      %s"
        % (", ".join(found["free_inference"]) or "NO"))
    say("")

    if found["ports"]:
        say("  NO-COST REAL INFERENCE AVAILABLE")
        port, what = found["ports"][0]
        say("")
        say("    Something is already serving on 127.0.0.1:%d (%s)." % (port, what))
        if what == "ollama":
            say("      CIV_PROVIDER=local LOCAL_MODEL_NAME=<model> \\")
            say("          python3 real_inference_gate.py")
        else:
            say("      CIV_PROVIDER=openai-compat OPENAI_COMPAT_URL=http://127.0.0.1:%d \\" % port)
            say("          LOCAL_MODEL_NAME=<model> python3 real_inference_gate.py")
        return 0

    if free_ready:
        h = free_ready[0]
        label, _, sel = FREE_TIER[h]
        say("  NO-COST REAL INFERENCE AVAILABLE")
        say("")
        say("    %s is reachable and a key is already set." % label)
        say("      CIV_PROVIDER=%s python3 real_inference_gate.py" % sel)
        return 0

    if free_waiting:
        say("  NO-COST REAL INFERENCE REACHABLE BUT NOT USABLE — no key")
        say("")
        say("    A free-tier endpoint answers from this machine. It is not a")
        say("    paid-only situation: these tiers need no payment method and no")
        say("    credit. They need a key, which the Owner creates and which")
        say("    nothing in this project will invent.")
        say("")
        for h in free_waiting:
            label, names, sel = FREE_TIER[h]
            say("      %-22s set %s, then:" % (label, " or ".join(names)))
            say("      %-22s   CIV_PROVIDER=%s python3 real_inference_gate.py"
                % ("", sel))
        return 1

    if usable or can_get:
        say("  NO-COST REAL INFERENCE NOT YET RUNNING")
        say("")
        if usable:
            say("    A runtime is here but nothing is serving. Start it, then re-run.")
        if can_get:
            say("    Weights can be fetched from: %s"
                % ", ".join(found["weight_hosts"][:3]))
        return 1

    say("  NO-COST REAL INFERENCE NOT AVAILABLE")
    say("")
    say("    Nothing is installed, nothing is listening, no weights are on disk,")
    say("    no host that distributes models is reachable, and no free-tier")
    say("    endpoint answers. The only inference endpoints this machine can")
    say("    reach are paid ones, which this project does not call.")
    say("")
    say("    This is a fact about the machine, not about the code. Put a model")
    say("    where the world can reach it and nothing here has to change:")
    say("")
    say("      # anything speaking the OpenAI wire format — llama-server, vLLM,")
    say("      # LM Studio, LocalAI — on this host or one on the private network")
    say("      CIV_PROVIDER=openai-compat OPENAI_COMPAT_URL=http://127.0.0.1:8080 \\")
    say("          LOCAL_MODEL_NAME=<model> python3 real_inference_gate.py")
    say("")
    say("      # or Ollama")
    say("      CIV_PROVIDER=local LOCAL_MODEL_NAME=<model> \\")
    say("          python3 real_inference_gate.py")
    return 1


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true",
                    help="skip reachability probes and look only at this machine")
    ap.add_argument("--json", action="store_true", help="machine-readable result")
    a = ap.parse_args(argv)

    if not a.json:
        say(BAR)
        say("NO-COST MODEL AUDIT")
        say(BAR)
        say("  Nothing here spends anything, and nothing here is downloaded.")

    found = audit(check_network=not a.offline)
    if a.json:
        print(json.dumps(found, indent=2, sort_keys=True))
        return 0 if found["ports"] else 1
    return verdict(found)


if __name__ == "__main__":
    sys.exit(main())
