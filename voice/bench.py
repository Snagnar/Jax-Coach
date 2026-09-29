"""Speed check for the local voice: python bench.py [cpu|dml] [threads]"""
import os
import sys
import time

import onnxruntime as ort
from kokoro_onnx import Kokoro

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import kokoro_server as ks  # noqa: E402

mode = sys.argv[1] if len(sys.argv) > 1 else "cpu"
threads = int(sys.argv[2]) if len(sys.argv) > 2 else 2
print("providers available:", ort.get_available_providers())
t0 = time.time()
if mode == "dml":
    opts = ort.SessionOptions()
    opts.enable_mem_pattern = False
    opts.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    sess = ort.InferenceSession(ks.MODEL, sess_options=opts, providers=["DmlExecutionProvider", "CPUExecutionProvider"])
    print("session providers:", sess.get_providers())
    k = Kokoro.from_session(sess, ks.VOICES)
elif mode == "int8":
    k = ks.load(threads, os.path.join(HERE, "models", "kokoro-v1.0.int8.onnx"))
else:
    k = ks.load(threads)
print(f"{mode} x{threads}: load {time.time() - t0:.2f}s")
lines = ["Three enemies dead for 45 seconds. Baron is up, take it.",
         "Darius is a level up. Don't trade until you catch up.",
         "Careful. Vi showed top side.",
         "Crash your wave and back. You can buy Sheen and Control Ward."]
k.create("Warm up.", voice="af_heart", speed=1.0, lang="en-us")
tot, aud = 0, 0
for line in lines:
    t0 = time.time()
    s, r = k.create(line, voice="af_heart", speed=1.0, lang="en-us")
    dt = time.time() - t0; tot += dt; aud += len(s) / r
    print(f"  {dt:.2f}s for {len(s) / r:.1f}s of audio")
print(f"  => {tot / len(lines):.2f}s per line, {aud / tot:.1f}x real time")
if mode == "int8" and "--samples" in sys.argv:
    for v in ["af_heart", "af_bella", "af_nicole", "bf_emma"]:
        s, r = k.create(lines[0], voice=v, speed=1.0, lang="en-gb" if v.startswith("bf") else "en-us")
        open(os.path.join(HERE, f"sample-int8-{v}.wav"), "wb").write(ks.to_wav(s, r))
if mode == "cpu" and "--samples" in sys.argv:
    for v in ["af_heart", "af_bella", "af_nicole", "bf_emma"]:
        s, r = k.create(lines[0], voice=v, speed=1.0, lang="en-gb" if v.startswith("bf") else "en-us")
        open(os.path.join(HERE, f"sample-{v}.wav"), "wb").write(ks.to_wav(s, r))
    print("voices:", ", ".join(v for v in sorted(k.get_voices()) if v[:2] in ("af", "bf")))
