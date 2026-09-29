"""Is the GPU (DirectML) artifact only in the top end? Compare CPU vs GPU band by band, raw and filtered."""
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import kokoro_server as ks  # noqa: E402

TEXTS = ["Three enemies dead for 45 seconds. Baron is up, take it.", "Darius is a level up. Don't trade until you catch up."]
BANDS = [(80, 1000), (1000, 2000), (2000, 3000), (3000, 4000), (4000, 5000), (5000, 6000), (6000, 8000), (8000, 12000)]


def bands(x, rate):
    spec = np.abs(np.fft.rfft(x.astype(np.float64) * np.hanning(len(x)))) ** 2
    f = np.fft.rfftfreq(len(x), 1 / rate)
    tot = spec.sum()
    return [spec[(f >= lo) & (f < hi)].sum() / tot * 100 for lo, hi in BANDS]


cpu = ks.load(2, device="cpu")
gpu = ks.load(2, device="gpu")
print("band (Hz)        " + "  ".join(f"{lo // 1000 if lo >= 1000 else lo}-{hi // 1000}k".rjust(7) for lo, hi in BANDS))
for i, t in enumerate(TEXTS):
    c, r = cpu.create(t, voice="af_heart", speed=1.05, lang="en-us")
    g, _ = gpu.create(t, voice="af_heart", speed=1.05, lang="en-us")
    for name, x in (("cpu", c), ("gpu", g), ("cpu+6k", ks.soften(c, r, 6000)), ("gpu+6k", ks.soften(g, r, 6000))):
        print(f"{i} {name:14s} " + "  ".join(f"{v:7.2f}" for v in bands(x, r)))
    if i == 0:
        open(os.path.join(HERE, "ab-gpu-heart-soft6k.wav"), "wb").write(ks.to_wav(ks.soften(g, r, 6000), r))
