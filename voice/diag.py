"""A/B the local voice: same sentence on CPU and GPU, plus spectral numbers (metallic = too much energy /
ringing in the high band). Writes voice\ab-*.wav."""
import glob
import os
import sys
import wave

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import kokoro_server as ks  # noqa: E402

TEXT = "Three enemies dead for 45 seconds. Baron is up, take it."


def stats(x, rate):
    x = x.astype(np.float64)
    spec = np.abs(np.fft.rfft(x * np.hanning(len(x)))) ** 2
    f = np.fft.rfftfreq(len(x), 1 / rate)
    tot = spec.sum()
    band = lambda lo, hi: spec[(f >= lo) & (f < hi)].sum() / tot * 100
    # frame-wise spectral flatness in 4-10 kHz (buzzy/metallic sounds are "peaky" there)
    return f"4-8k {band(4000, 8000):5.2f}%  8-12k {band(8000, 12000):5.2f}%  peak {np.max(np.abs(x)):.2f}  rms {np.sqrt(np.mean(x ** 2)):.3f}"


def read(path):
    with wave.open(path) as w:
        rate, n = w.getframerate(), w.getnframes()
        d = np.frombuffer(w.readframes(n), dtype="<i2").astype(np.float32) / 32768
    return d, rate


out = {}
for dev in ("cpu", "gpu"):
    k = ks.load(2, device=dev)
    for speed in (1.0,):
        s, r = k.create(TEXT, voice="af_heart", speed=speed, lang="en-us")
        name = f"ab-{ks.load.device}-heart.wav"
        open(os.path.join(HERE, name), "wb").write(ks.to_wav(s, r))
        print(f"{name:26s} {stats(s, r)}")
        if ks.load.device == "cpu":
            for cut in (7000, 6000):
                f = ks.soften(s, r, cutoff=cut)
                name = f"ab-cpu-heart-soft{cut // 1000}k.wav"
                open(os.path.join(HERE, name), "wb").write(ks.to_wav(f, r))
                print(f"{name:26s} {stats(f, r)}")
# a Groq/Orpheus line from the cache as reference
groq = [p for p in glob.glob(os.path.join(os.path.dirname(HERE), "cache", "tts", "*.wav")) if not os.path.basename(p).startswith("k-")]
if groq:
    d, r = read(max(groq, key=os.path.getmtime))
    print(f"{'groq reference':26s} {stats(d, r)}  (rate {r})")
