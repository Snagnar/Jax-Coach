"""Make Kokoro run on DirectML (any DirectX 12 GPU).

DirectML rejects the model's upsampling ConvTranspose layers (pads 1,1 + output_padding 1). Rewriting them as
pads 1,0 without output_padding gives the same output length and the same numbers (checked below on the CPU):
out = (L-1)*2 - pad_begin - pad_end + 3 + output_padding  ->  2L either way.

python patch_dml.py   -> writes models/kokoro-v1.0.dml.onnx, then compares CPU outputs and times the GPU
"""
import os
import time

import numpy as np
import onnx
import onnxruntime as ort
from kokoro_onnx import Kokoro

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "models", "kokoro-v1.0.onnx")
DST = os.path.join(HERE, "models", "kokoro-v1.0.dml.onnx")
VOICES = os.path.join(HERE, "models", "voices-v1.0.bin")

m = onnx.load(SRC)
patched = 0
for node in m.graph.node:
    if node.op_type != "ConvTranspose":
        continue
    attrs = {a.name: a for a in node.attribute}
    op = list(attrs["output_padding"].ints) if "output_padding" in attrs else []
    pads = list(attrs["pads"].ints) if "pads" in attrs else []
    if op == [1] and pads == [1, 1]:
        attrs["pads"].ints[:] = [1, 0]
        node.attribute.remove(attrs["output_padding"])
        patched += 1
        print("patched", node.name)
onnx.save(m, DST)
print(f"{patched} layers patched -> {DST}")


def session(path, providers):
    o = ort.SessionOptions()
    o.enable_mem_pattern = False
    o.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    o.intra_op_num_threads = 2
    return ort.InferenceSession(path, sess_options=o, providers=providers)


text = "Three enemies dead for 45 seconds. Baron is up, take it."
cpu_a = Kokoro.from_session(session(SRC, ["CPUExecutionProvider"]), VOICES)
cpu_b = Kokoro.from_session(session(DST, ["CPUExecutionProvider"]), VOICES)
a, _ = cpu_a.create(text, voice="af_heart", speed=1.05, lang="en-us")
b, _ = cpu_b.create(text, voice="af_heart", speed=1.05, lang="en-us")
n = min(len(a), len(b))
print(f"CPU original vs patched: lengths {len(a)} / {len(b)}, max difference {np.max(np.abs(a[:n] - b[:n])):.2e}")

gpu = Kokoro.from_session(session(DST, ["DmlExecutionProvider", "CPUExecutionProvider"]), VOICES)
g, rate = gpu.create(text, voice="af_heart", speed=1.05, lang="en-us")   # first run compiles shaders
n = min(len(a), len(g))
print(f"GPU vs CPU: lengths {len(a)} / {len(g)}, correlation {np.corrcoef(a[:n], g[:n])[0, 1]:.4f}")
lines = ["Darius is a level up.", "Don't trade until you catch up.", "Careful. Vi showed top side.",
         "Crash your wave and back.", "You can buy Sheen and Control Ward."]
tot = aud = 0
for line in lines:
    t0 = time.time()
    s, r = gpu.create(line, voice="af_heart", speed=1.05, lang="en-us")
    dt = time.time() - t0; tot += dt; aud += len(s) / r
    print(f"  GPU {dt:.2f}s for {len(s) / r:.1f}s of audio")
print(f"  => GPU {tot / len(lines):.2f}s per sentence")
tot = 0
for line in lines:
    t0 = time.time(); cpu_b.create(line, voice="af_heart", speed=1.05, lang="en-us"); tot += time.time() - t0
print(f"  => CPU {tot / len(lines):.2f}s per sentence")
