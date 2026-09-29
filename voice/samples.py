"""Voice samples to listen to: python samples.py -> voice/samples/*.wav (CPU, 7 kHz filter, like the app)."""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import kokoro_server as ks  # noqa: E402

TEXT = "Three enemies dead for 45 seconds. Baron is up, take it."
OUT = os.path.join(HERE, "samples")
os.makedirs(OUT, exist_ok=True)
k = ks.load(2, device="cpu")

voices = {
    "1-heart (current)": "af_heart",
    "2-nicole (soft, headphones)": "af_nicole",
    "3-aoede (calm)": "af_aoede",
    "4-kore": "af_kore",
    "5-sarah": "af_sarah",
    "6-emma (British)": "bf_emma",
    # blends: mix the style vectors
    "7-heart+nicole 50-50": [("af_heart", 0.5), ("af_nicole", 0.5)],
    "8-heart+nicole 70-30": [("af_heart", 0.7), ("af_nicole", 0.3)],
}
for label, v in voices.items():
    if isinstance(v, list):
        style = sum(k.get_voice_style(name) * w for name, w in v)
        lang = "en-us"
    else:
        style = v
        lang = "en-gb" if v.startswith("bf_") else "en-us"
    s, r = k.create(TEXT, voice=style, speed=1.05, lang=lang)
    path = os.path.join(OUT, f"{label}.wav")
    with open(path, "wb") as f:
        f.write(ks.to_wav(ks.soften(s, r, 7000), r))
    print(path)
