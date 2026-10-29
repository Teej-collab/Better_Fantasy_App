# Procedural score + sound design for the showreel. 120 BPM, D minor.
# usage: python3 synth.py <out.wav> [duration]
import sys, subprocess, wave
import numpy as np

SR = 48000
DUR = float(sys.argv[2]) if len(sys.argv) > 2 else 60.5
N = int(SR * DUR)
rng = np.random.default_rng(7)
L = np.zeros(N); R = np.zeros(N)
VERB = np.zeros((2, N))  # send bus

def t_(n): return np.arange(n) / SR
def add(sig, at, gain=1.0, pan=0.0, verb=0.0):
    i = int(at * SR)
    if i >= N: return
    sig = sig[: N - i]
    l = gain * sig * np.sqrt(0.5 * (1 - pan)); r = gain * sig * np.sqrt(0.5 * (1 + pan))
    L[i:i + len(sig)] += l; R[i:i + len(sig)] += r
    if verb:
        VERB[0, i:i + len(sig)] += l * verb; VERB[1, i:i + len(sig)] += r * verb

def env_adsr(n, a=0.01, d=0.1, s=0.7, r=0.2):
    e = np.ones(n) * s
    na, nd, nr = int(a * SR), int(d * SR), int(r * SR)
    na = min(na, n); e[:na] = np.linspace(0, 1, na)
    nd = min(nd, n - na); e[na:na + nd] = np.linspace(1, s, nd)
    if nr > 0 and nr < n: e[-nr:] *= np.linspace(1, 0, nr)
    return e

def onepole_lp(x, fc):
    # fc may be array (time-varying)
    fc = np.broadcast_to(np.asarray(fc, dtype=float), x.shape)
    a = np.exp(-2 * np.pi * fc / SR)
    y = np.empty_like(x); z = 0.0
    for i in range(len(x)):
        z = (1 - a[i]) * x[i] + a[i] * z; y[i] = z
    return y

def lp_fft(x, fc, order=4):
    X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / SR)
    X *= 1 / np.sqrt(1 + (f / fc) ** (2 * order)); return np.fft.irfft(X, len(x))
def hp_fft(x, fc, order=4):
    X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / SR)
    X *= 1 / np.sqrt(1 + (fc / np.maximum(f, 1)) ** (2 * order)); return np.fft.irfft(X, len(x))
def bp_fft(x, lo, hi): return hp_fft(lp_fft(x, hi), lo)

def saw(freq, n, detune=0.0):
    tt = t_(n); out = np.zeros(n)
    for d in ([0.0] if not detune else [-detune, 0.0, detune]):
        ph = (freq * (1 + d) * tt + rng.random()) % 1.0
        out += 2 * ph - 1
    return out / (1 if not detune else 3)

def note(m): return 440.0 * 2 ** ((m - 69) / 12)
BEAT = 0.5; BAR = 2.0
# chords (midi) per bar: Dm | Bb | F | C
PROG = [[50, 53, 57, 62], [46, 50, 53, 58], [41, 45, 48, 53], [48, 52, 55, 60]]
ROOT = [38, 34, 41, 36]

# ------------------------------------------------------------------ instruments
def kick(g=1.0):
    n = int(0.45 * SR); tt = t_(n)
    f = 45 + 110 * np.exp(-tt * 28)
    ph = 2 * np.pi * np.cumsum(f) / SR
    s = np.sin(ph) * np.exp(-tt * 7.5)
    click = rng.standard_normal(n) * np.exp(-tt * 300) * 0.25
    return (s + click) * g
def sub_boom(dur=3.0):
    n = int(dur * SR); tt = t_(n)
    f = 32 + 60 * np.exp(-tt * 6)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 1.3)
    return s
def snare():
    n = int(0.3 * SR); tt = t_(n)
    nz = bp_fft(rng.standard_normal(n), 900, 9000) * np.exp(-tt * 16)
    tone = np.sin(2 * np.pi * 185 * tt) * np.exp(-tt * 25)
    return nz * 0.9 + tone * 0.6
def clap():
    n = int(0.35 * SR); tt = t_(n); e = np.zeros(n)
    for k, off in enumerate([0, 0.011, 0.022, 0.034]):
        i = int(off * SR); e[i:] += np.exp(-(tt[: n - i]) * (60 if k < 3 else 13))
    return bp_fft(rng.standard_normal(n), 1000, 7000) * e
def hat(open_=False):
    n = int((0.25 if open_ else 0.06) * SR); tt = t_(n)
    return hp_fft(rng.standard_normal(n), 7000) * np.exp(-tt * (12 if open_ else 70))
def tom(freq):
    n = int(0.5 * SR); tt = t_(n)
    f = freq * (1 + 0.6 * np.exp(-tt * 20))
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 6) + 0.15 * bp_fft(rng.standard_normal(n), 200, 3000) * np.exp(-tt * 30)
def pad(chord, dur, bright=900):
    n = int(dur * SR); s = np.zeros(n)
    for m in chord: s += saw(note(m), n, detune=0.004)
    s = lp_fft(s / len(chord), bright, 2)
    return s * env_adsr(n, 0.6, 0.2, 0.9, 0.8)
def stab(chord, dur=0.35):
    n = int(dur * SR); tt = t_(n); s = np.zeros(n)
    for m in chord: s += saw(note(m + 12), n, detune=0.006)
    s /= len(chord)
    # brassy: filter envelope via blending two lowpasses
    bright = lp_fft(s, 3500, 2); dark = lp_fft(s, 700, 2)
    fe = np.exp(-tt * 9)
    return (bright * fe + dark * (1 - fe)) * env_adsr(n, 0.005, 0.08, 0.6, 0.12)
def bass(m, dur):
    n = int(dur * SR); tt = t_(n)
    s = 0.6 * np.sin(2 * np.pi * note(m) * tt) + 0.5 * lp_fft(saw(note(m), n), 420, 2)
    return s * env_adsr(n, 0.005, 0.05, 0.8, 0.04)
def pluck(m, dur=0.2, bright=2500):
    n = int(dur * SR); tt = t_(n)
    s = lp_fft(saw(note(m), n), bright, 2) * np.exp(-tt * 14)
    return s
def noise_riser(dur, lo=300, hi=9000):
    n = int(dur * SR); tt = t_(n)
    x = rng.standard_normal(n)
    # sweep bandpass via short-time chunks
    out = np.zeros(n); ch = 2048
    for i in range(0, n, ch):
        p = i / n; fc = lo * (hi / lo) ** p
        seg = x[i:i + ch]
        out[i:i + ch] = bp_fft(np.pad(seg, (0, ch - len(seg)))[:ch], fc * 0.6, fc * 1.6)[: len(seg)]
    return out * (tt / dur) ** 2
def whoosh(dur=0.6, rev=False):
    n = int(dur * SR); tt = t_(n)
    x = rng.standard_normal(n); out = np.zeros(n); ch = 1024
    for i in range(0, n, ch):
        p = i / n; fc = 400 + 5000 * np.sin(np.pi * p)
        seg = x[i:i + ch]
        out[i:i + ch] = bp_fft(np.pad(seg, (0, ch - len(seg)))[:ch], fc * 0.5, fc * 1.5)[: len(seg)]
    e = np.sin(np.pi * np.clip(tt / dur, 0, 1)) ** 2
    if rev: e = (tt / dur) ** 3
    return out * e
def crowd(dur, swell_at=None):
    n = int(dur * SR); tt = t_(n)
    x = bp_fft(rng.standard_normal(n), 250, 3500)
    # babble modulation
    mod = 0.6 + 0.4 * np.abs(np.sin(2 * np.pi * 0.7 * tt) * np.sin(2 * np.pi * 1.13 * tt + 1))
    return x * mod
def blip(f1=1200, f2=1800, dur=0.14):
    n = int(dur * SR); tt = t_(n); half = n // 2
    s = np.concatenate([np.sin(2 * np.pi * f1 * tt[:half]), np.sin(2 * np.pi * f2 * tt[half:])])
    return s * np.exp(-tt * 18) * env_adsr(n, 0.002, 0.02, 1, 0.02)
def bell(f=880, dur=1.2):
    n = int(dur * SR); tt = t_(n)
    return (np.sin(2 * np.pi * f * tt) + 0.5 * np.sin(2 * np.pi * f * 2.76 * tt) * np.exp(-tt * 3) + 0.3 * np.sin(2 * np.pi * f * 5.4 * tt) * np.exp(-tt * 6)) * np.exp(-tt * 3.2)
def tick():
    n = int(0.03 * SR); tt = t_(n)
    return hp_fft(rng.standard_normal(n), 3000) * np.exp(-tt * 250) + np.sin(2 * np.pi * 2400 * tt) * np.exp(-tt * 200) * 0.5
def buzz(dur):
    n = int(dur * SR); tt = t_(n)
    s = np.sign(np.sin(2 * np.pi * 120 * tt)) * 0.3 + lp_fft(rng.standard_normal(n), 3000) * 0.4
    return lp_fft(s, 2500) * env_adsr(n, 0.003, 0.02, 0.8, 0.02)

def load_app_sound(path):
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", path, "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"], capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(float)
APP = "/Users/tjoverlin/dev/Better_Fantasy_App/frontend/public/audio/"
light = load_app_sound(APP + "light-switch.m4a"); can = load_app_sound(APP + "can-opening.m4a"); pour = load_app_sound(APP + "intro-pour.m4a")

# ------------------------------------------------------------------ A: anticipation 0-8
for k in range(7):  # heartbeat, 60bpm lub-dub
    b = 0.2 + k * 1.0
    g = 0.55 + 0.1 * k
    for off, gg in [(0, 1.0), (0.24, 0.7)]:
        n = int(0.35 * SR); tt = t_(n)
        s = np.sin(2 * np.pi * (48 + 20 * np.exp(-tt * 30)) * tt) * np.exp(-tt * 14)
        add(s, b + off, 0.9 * g * gg)
drone_n = int(8.2 * SR); dt = t_(drone_n)
drone = lp_fft(saw(note(26), drone_n, detune=0.003) + 0.6 * saw(note(38), drone_n, detune=0.004), 260, 2)
drone *= np.clip(dt / 5.0, 0, 1) ** 2 * np.clip((8.2 - dt) / 0.3, 0, 1)
add(drone, 0.0, 0.35, verb=0.3)
shimmer = hp_fft(rng.standard_normal(drone_n), 6000) * 0.02 * np.clip(dt / 6, 0, 1)
add(shimmer, 0.0, 1.0, verb=0.6)
for t in [1.53, 2.85, 3.97]:  # the app's own light-switch cue per word
    add(light, t - 0.03, 0.9, pan=0.0, verb=0.25)
add(can, 5.62, 0.8, verb=0.2); add(pour, 6.02, 0.55, verb=0.15)
add(sub_boom(3.0), 6.0, 0.9)
add(pad(PROG[0], 2.2, 600), 6.0, 0.25, verb=0.5)

# ------------------------------------------------------------------ B: the world 8-12
add(whoosh(0.7), 7.55, 0.35, verb=0.3)
for bar in range(2):
    t0 = 8.0 + bar * BAR
    add(pad(PROG[bar], 2.1, 800 + 700 * bar), t0, 0.32, verb=0.5)
    add(bass(ROOT[bar], 1.9), t0, 0.25)
    for s16 in range(16):
        m = PROG[bar][s16 % 4] + 12
        add(pluck(m, 0.18, 1000 + 700 * (bar * 16 + s16) / 8), t0 + s16 * 0.125, 0.11 + 0.03 * bar, pan=0.35 * np.sin(s16), verb=0.35)
    if bar == 1:
        for b in range(4): add(kick(0.55), t0 + b * BEAT, 0.5)
cr = crowd(22.0); ct = t_(len(cr))
add(cr * np.interp(ct, [0, 1.5, 3.5, 4.0, 6, 8, 20, 22], [0, 0.12, 0.14, 0.9, 0.3, 0.12, 0.1, 0]), 8.0, 0.35, verb=0.3)
add(noise_riser(2.0), 10.0, 0.4, verb=0.4)
add(whoosh(0.9, rev=True), 11.1, 0.45)

# ------------------------------------------------------------------ C: game day 12-32
def groove_bar(t0, bar_idx, fill=False, drop_first=False, half=False):
    ch = PROG[bar_idx % 4]; rt = ROOT[bar_idx % 4]
    kicks = [0, 1.25] if half else [0, 0.5, 1.0, 1.5]
    for kb in kicks:
        if drop_first and kb == 0: continue
        add(kick(), t0 + kb, 0.95)
    snares = [1.0] if half else [0.5, 1.5]
    for sb in snares:
        add(snare(), t0 + sb, 0.45, verb=0.25); add(clap(), t0 + sb, 0.35, verb=0.3)
    for e in range(8):
        add(hat(open_=(e in (3, 7))), t0 + e * 0.25, 0.16 if e % 2 else 0.11, pan=0.3)
    for e in range(8):
        add(bass(rt + (12 if e in (3, 6) else 0), 0.22), t0 + e * 0.25, 0.42)
    add(stab(ch, 0.4), t0, 0.32, pan=-0.15, verb=0.3)
    add(stab(ch, 0.25), t0 + 1.5, 0.22, pan=0.15, verb=0.3)
    add(stab(ch, 0.25), t0 + 1.75, 0.18, pan=-0.1, verb=0.3)
    add(pad(ch, 2.05, 1400), t0, 0.14, verb=0.4)
    if fill:
        for k, f in enumerate([220, 196, 165, 147, 130, 110, 98, 82]):
            add(tom(f), t0 + 1.0 + k * 0.125, 0.45, pan=-0.4 + 0.1 * k, verb=0.3)

add(sub_boom(2.5), 12.0, 1.0); add(stab(PROG[0], 0.8), 12.0, 0.5, verb=0.5)
for bar in range(10):  # 12 -> 32
    t0 = 12.0 + bar * BAR
    groove_bar(t0, bar, fill=(t0 == 16.0), drop_first=(t0 == 26.0))
# TOUCHDOWN at 19.0
add(sub_boom(2.0), 19.0, 0.9); add(bell(988), 19.0, 0.3, verb=0.5); add(bell(1318), 19.08, 0.22, verb=0.5)
add(bp_fft(rng.standard_normal(int(0.8 * SR)), 200, 6000) * np.exp(-t_(int(0.8 * SR)) * 5), 19.0, 0.35, verb=0.6)
add(crowd(4.0) * np.interp(t_(int(4 * SR)), [0, 0.3, 1.5, 4], [0, 1, 0.6, 0]), 18.95, 0.7, verb=0.5)
add(blip(900, 1350), 16.4, 0.18)
add(noise_riser(1.0, 800, 8000), 18.0, 0.3)
add(bell(1567, 0.8), 22.5, 0.18, verb=0.4)          # fantasy impact refresh
add(sub_boom(1.5), 24.5, 0.7); add(whoosh(0.4), 24.25, 0.3)
add(blip(1400, 2100), 26.72, 0.22, pan=0.2, verb=0.2)
add(blip(1250, 1650, 0.1), 29.6, 0.2, pan=-0.2, verb=0.2)
for t in [13.85, 15.85, 20.85, 23.85, 25.85]:
    add(whoosh(0.45), t - 0.2, 0.22)

# ------------------------------------------------------------------ D: chug analyzer 32-44
add(sub_boom(2.0), 32.0, 0.8); add(whoosh(0.6), 31.6, 0.3)
for bar in range(6):  # 32 -> 44, half-time swagger
    t0 = 32.0 + bar * BAR
    groove_bar(t0, bar, half=(bar < 2))
add(blip(700, 1050, 0.12), 33.38, 0.2)                 # file dropped in
k = 0; t = 33.5
while t < 35.95:                                       # "Analyzing your chug…" scan
    add(np.sin(2 * np.pi * (600 + 900 * (t - 33.5) / 2.45) * t_(int(0.05 * SR))) * np.exp(-t_(int(0.05 * SR)) * 60), t, 0.12, pan=0.3 * np.sin(k), verb=0.2)
    t += 0.125; k += 1
add(noise_riser(1.4, 600, 9000), 34.6, 0.3)
add(sub_boom(1.8), 36.0, 0.9); add(bell(784, 1.5), 36.0, 0.28, verb=0.6); add(bell(1175, 1.5), 36.06, 0.2, verb=0.6)
add(crowd(3.0) * np.interp(t_(int(3 * SR)), [0, 0.25, 1.2, 3], [0, 1, 0.5, 0]), 35.95, 0.55, verb=0.5)
for t in [39.8, 41.8]:
    add(whoosh(0.45), t - 0.2, 0.2)

# ------------------------------------------------------------------ E: your rules 44-56
add(sub_boom(1.8), 44.0, 0.8); add(stab(PROG[1], 0.6), 44.0, 0.4, verb=0.5)
for bar in range(6):  # 44 -> 56
    t0 = 44.0 + bar * BAR
    groove_bar(t0, bar + 1)
add(blip(1100, 1500, 0.1), 46.4, 0.16)                 # tap Scoring Rules
for t in [48.5, 48.72]: add(tick() * 2.0, t, 0.35)     # typing "1", "5"
add(blip(1500, 2250, 0.16), 52.0, 0.25, verb=0.3); add(bell(1318, 0.9), 52.02, 0.18, verb=0.4)  # Saved.
for t in [46.85, 50.35, 53.85]:
    add(whoosh(0.45), t - 0.2, 0.2)

# ------------------------------------------------------------------ F: montage + final 56-65
for i, t in enumerate([56.0, 56.5, 57.0, 57.5]):
    add(kick(), t, 1.0); add(stab(PROG[i % 4], 0.3), t, 0.35, verb=0.3)
roll_t = 56.0
while roll_t < 57.85:
    gap = 0.125 if roll_t < 57.0 else 0.0625
    add(snare(), roll_t, 0.15 + 0.25 * (roll_t - 56) / 1.85, verb=0.3); roll_t += gap
add(noise_riser(2.0, 200, 10000), 56.0, 0.55, verb=0.4)
add(sub_boom(4.0), 58.0, 1.1)
add(bp_fft(rng.standard_normal(int(1.5 * SR)), 100, 8000) * np.exp(-t_(int(1.5 * SR)) * 3), 58.0, 0.45, verb=0.9)
for k2, on in enumerate([1, 0, 1, 0, 1, 1, 0, 1, 1, 1]):
    if on: add(buzz(0.07), 58.2 + k2 * 0.09, 0.10)
end_ch = [38, 45, 50, 53, 57, 64]
add(pad(end_ch, 6.8, 1100), 58.0, 0.42, verb=0.8)
add(pad([26, 38], 6.8, 300), 58.0, 0.35, verb=0.5)
add(bell(587, 3.0), 59.5, 0.10, verb=0.9); add(bell(880, 3.0), 60.0, 0.08, verb=0.9)


# ------------------------------------------------------------------ reverb + master
def reverb(x, secs=2.6, seed=1):
    r2 = np.random.default_rng(seed); n = int(secs * SR); tt = t_(n)
    ir = r2.standard_normal(n) * np.exp(-tt * 6.9 / secs); ir = lp_fft(ir, 6000); ir /= np.sqrt(np.sum(ir ** 2))
    m = len(x) + n; F = 1 << (m - 1).bit_length()
    return np.fft.irfft(np.fft.rfft(x, F) * np.fft.rfft(ir, F), F)[: len(x)]
L += reverb(VERB[0], seed=1) * 0.9; R += reverb(VERB[1], seed=2) * 0.9
mix = np.stack([L, R])
# fade tail
ft = int(1.2 * SR); mix[:, -ft:] *= np.linspace(1, 0, ft) ** 1.5
mix = np.tanh(mix / (np.max(np.abs(mix)) * 0.55)) * 0.9  # soft clip glue
pcm = (mix.T * 32767).astype(np.int16)
with wave.open(sys.argv[1], "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
print("wrote", sys.argv[1], DUR)
