"""Jax Coach local voice: Kokoro-82M text-to-speech on 127.0.0.1:8788.

Kept light on purpose so it never competes with the game:
  * CPU only (the graphics card is left to League), 2 threads, below-normal process priority
  * every line is cached on disk (cache/tts), so a line is only ever generated once
  * one line at a time; live callouts go before cache warm-up ("priority": "low")
  * exits by itself when the Jax Coach server that started it goes away (--parent-pid)

The Jax Coach page talks to it directly, so the (single-threaded) Jax Coach server is never blocked.

POST /tts    {"text": "...", "voice": "af_heart", "speed": 1.0, "priority": "high|low"}  -> audio/wav
GET  /voices -> ["af_heart", ...]
GET  /health -> {"ok": true}
"""
import argparse
import ctypes
import hashlib
import io
import json
import os
import sys
import threading
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
import onnxruntime as ort
from kokoro_onnx import Kokoro

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL = os.path.join(HERE, "models", "kokoro-v1.0.onnx")
VOICES = os.path.join(HERE, "models", "voices-v1.0.bin")
CACHE = os.path.join(os.path.dirname(HERE), "cache", "tts")


if os.name == "nt":
    from ctypes import wintypes
    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    k32.GetCurrentProcess.restype = wintypes.HANDLE          # 64-bit handles: declare the types, or they get cut
    k32.SetPriorityClass.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    k32.SetPriorityClass.restype = wintypes.BOOL
    k32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    k32.OpenProcess.restype = wintypes.HANDLE
    k32.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    k32.WaitForSingleObject.restype = wintypes.DWORD


def lower_priority():
    if os.name == "nt":
        BELOW_NORMAL_PRIORITY_CLASS = 0x00004000
        k32.SetPriorityClass(k32.GetCurrentProcess(), BELOW_NORMAL_PRIORITY_CLASS)


def watch_parent(pid):
    """Quit when the process that started us is gone."""
    if not pid or os.name != "nt":
        return
    SYNCHRONIZE = 0x00100000
    h = k32.OpenProcess(SYNCHRONIZE, False, pid)
    if not h:
        os._exit(0)
    k32.WaitForSingleObject(h, 0xFFFFFFFF)   # blocks until the parent exits
    os._exit(0)


def load(threads, model=MODEL, device="cpu"):
    """device: "gpu" = DirectML (any DirectX 12 card) or "cpu" ("auto" = cpu).
    The model file is patched (patch_dml.py) so DirectML accepts it; on the CPU it gives identical output.
    DirectML is not the default: on a GTX 1070 it doubles the high-frequency buzz (sounds metallic)."""
    if device == "auto":
        device = "cpu"
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = threads
    opts.inter_op_num_threads = 1
    opts.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    opts.enable_mem_pattern = False                      # required by DirectML
    if device in ("gpu", "auto") and "DmlExecutionProvider" in ort.get_available_providers():
        try:
            session = ort.InferenceSession(model, sess_options=opts, providers=["DmlExecutionProvider", "CPUExecutionProvider"])
            k = Kokoro.from_session(session, VOICES)
            k.create("Ready.", voice="af_heart", speed=1.0, lang="en-us")   # compiles the GPU shaders once
            load.device = "gpu"
            return k
        except Exception as e:
            print("GPU (DirectML) failed, using the CPU:", e, flush=True)
    session = ort.InferenceSession(model, sess_options=opts, providers=["CPUExecutionProvider"])
    load.device = "cpu"
    return Kokoro.from_session(session, VOICES)


def soften(samples, rate, cutoff=7000.0, taps=127):
    """Gentle low-pass: Kokoro leaves a lot of hiss/'metallic' energy above ~7 kHz that speech doesn't need
    (Groq's Orpheus has almost none there). Windowed-sinc FIR, linear phase, so the voice itself is untouched."""
    n = np.arange(taps) - (taps - 1) / 2
    h = np.sinc(2 * cutoff / rate * n) * np.blackman(taps)
    h /= h.sum()
    return np.convolve(samples, h, mode="same").astype(np.float32)


def to_wav(samples, rate):
    pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


class Scheduler:
    """One generation at a time; low-priority (warm-up) requests wait while a live one is pending."""

    def __init__(self):
        self.cv = threading.Condition()
        self.busy = False
        self.high_waiting = 0

    def run(self, fn, high):
        with self.cv:
            if high:
                self.high_waiting += 1
            while self.busy or (not high and self.high_waiting):
                self.cv.wait()
            if high:
                self.high_waiting -= 1
            self.busy = True
        try:
            return fn()
        finally:
            with self.cv:
                self.busy = False
                self.cv.notify_all()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8788)
    ap.add_argument("--threads", type=int, default=2)
    ap.add_argument("--parent-pid", type=int, default=0)
    ap.add_argument("--app-port", type=int, default=8787)
    ap.add_argument("--device", choices=["auto", "gpu", "cpu"], default="auto")
    args = ap.parse_args()

    lower_priority()
    threading.Thread(target=watch_parent, args=(args.parent_pid,), daemon=True).start()
    os.makedirs(CACHE, exist_ok=True)
    kokoro = load(args.threads, device=args.device)
    voices = sorted(kokoro.get_voices())
    sched = Scheduler()
    origins = {f"http://localhost:{args.app_port}", f"http://127.0.0.1:{args.app_port}"}
    styles = {}

    def parse_voice(spec):
        """"af_heart" or a mix like "af_nicole:70+bf_isabella:30". A mix is the weighted average of the voices'
        style vectors: made once, then generation costs exactly the same as a single voice.
        Returns (voice or style array, normalized key, lang); the accent follows the heaviest voice."""
        parts = []
        for p in str(spec or "").split("+"):
            name, _, w = p.partition(":")
            name = name.strip()
            try:
                w = float(w) if w else 1.0
            except ValueError:
                w = 1.0
            if name in voices and w > 0:
                parts.append((name, w))
        if not parts:
            parts = [("af_heart", 1.0)]
        total = sum(w for _, w in parts)
        parts = sorted(((n, w / total) for n, w in parts), key=lambda x: -x[1])
        lang = "en-gb" if parts[0][0].startswith(("bf_", "bm_")) else "en-us"
        if len(parts) == 1:
            return parts[0][0], parts[0][0], lang
        key = "+".join(f"{n}:{round(w * 100)}" for n, w in parts)
        if key not in styles:
            styles[key] = sum(kokoro.get_voice_style(n) * w for n, w in parts)
        return styles[key], key, lang

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def cors(self):
            origin = self.headers.get("Origin")
            if origin in origins:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Access-Control-Allow-Headers", "Content-Type")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                self.send_header("Access-Control-Expose-Headers", "X-Cache, X-Gen-Ms")

        def send(self, code, body, ctype="application/json", extra=None):
            self.send_response(code)
            self.cors()
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self):
            self.send(204, b"")

        def do_GET(self):
            if self.path == "/health":
                self.send(200, json.dumps({"ok": True, "device": load.device}).encode())
            elif self.path == "/voices":
                self.send(200, json.dumps(voices).encode())
            else:
                self.send(404, b'{"error":"not_found"}')

        def do_POST(self):
            if self.path != "/tts":
                return self.send(404, b'{"error":"not_found"}')
            try:
                n = int(self.headers.get("Content-Length", 0))
                req = json.loads(self.rfile.read(n) or b"{}")
                text = " ".join(str(req.get("text", "")).split())[:400]
                voice, vkey, lang = parse_voice(req.get("voice"))
                speed = round(min(1.4, max(0.7, float(req.get("speed", 1.0)))), 2)
                cutoff = int(req.get("cutoff", 7000))           # low-pass against the metallic top end; 0 = off
                cutoff = 0 if cutoff <= 0 else min(11000, max(4000, cutoff))
                if not text:
                    return self.send(400, b'{"error":"empty_text"}')
                key = hashlib.sha1(f"kokoro-v2|{load.device}|{vkey}|{speed}|{cutoff}|{text}".encode("utf-8")).hexdigest()
                path = os.path.join(CACHE, f"k-{key}.wav")
                if os.path.exists(path):
                    with open(path, "rb") as f:
                        return self.send(200, f.read(), "audio/wav", {"X-Cache": "hit"})
                t0 = time.time()

                def gen():
                    if os.path.exists(path):          # made by another request while we waited
                        with open(path, "rb") as f:
                            return f.read()
                    samples, rate = kokoro.create(text, voice=voice, speed=speed, lang=lang)
                    if cutoff:
                        samples = soften(samples, rate, cutoff=cutoff)
                    data = to_wav(samples, rate)
                    tmp = path + ".tmp"
                    with open(tmp, "wb") as f:
                        f.write(data)
                    os.replace(tmp, path)
                    return data

                body = sched.run(gen, high=req.get("priority") != "low")
                self.send(200, body, "audio/wav", {"X-Cache": "miss", "X-Gen-Ms": str(int((time.time() - t0) * 1000))})
            except Exception as e:  # never take the helper down because of one line
                self.send(500, json.dumps({"error": str(e)}).encode())

    srv = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    srv.daemon_threads = True
    print(f"Kokoro voice ready on 127.0.0.1:{args.port} ({len(voices)} voices, {load.device})", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    sys.exit(main())
