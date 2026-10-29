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

# ------------------------------------------------------------------ B: the world 8-16
add(whoosh(0.7), 7.55, 0.35, verb=0.3)
for bar in range(4):
    t0 = 8.0 + bar * BAR
    add(pad(PROG[bar], 2.1, 700 + 500 * bar), t0, 0.32, verb=0.5)
    add(bass(ROOT[bar], 1.9), t0, 0.25)
    for s16 in range(16):  # pulse arp, opening filter
        m = PROG[bar][s16 % 4] + 12
        add(pluck(m, 0.18, 900 + 350 * (bar * 16 + s16) / 4), t0 + s16 * 0.125, 0.10 + 0.02 * bar, pan=0.35 * np.sin(s16), verb=0.35)
    if bar >= 2:
        for b in range(4): add(kick(0.55), t0 + b * BEAT, 0.5)
cr = crowd(34.0); cn = len(cr); ct = t_(cn)
crowd_env = np.interp(ct, [0, 2, 6, 14, 15, 17, 20, 22, 30, 34], [0, 0.10, 0.14, 0.14, 0.9, 0.35, 0.12, 0.10, 0.08, 0])
add(cr * crowd_env, 10.0, 0.35, pan=0.0, verb=0.3)
add(noise_riser(2.5), 13.5, 0.4, verb=0.4)
add(whoosh(0.9, rev=True), 15.1, 0.45)

# ------------------------------------------------------------------ C: game day 16-44
def groove_bar(t0, bar_idx, fill=False, drop_first=False):
    ch = PROG[bar_idx % 4]; rt = ROOT[bar_idx % 4]
    for b in range(4):
        if drop_first and b == 0: continue
        add(kick(), t0 + b * BEAT, 0.95)
    add(snare(), t0 + BEAT, 0.45, verb=0.25); add(clap(), t0 + BEAT, 0.35, verb=0.3)
    add(snare(), t0 + 3 * BEAT, 0.45, verb=0.25); add(clap(), t0 + 3 * BEAT, 0.35, verb=0.3)
    for e in range(8):
        add(hat(open_=(e % 2 == 1 and e in (3, 7))), t0 + e * 0.25, 0.16 if e % 2 else 0.11, pan=0.3)
    for e in range(8):  # driving 8th bass
        add(bass(rt + (12 if e in (3, 6) else 0), 0.22), t0 + e * 0.25, 0.42)
    add(stab(ch, 0.4), t0, 0.32, pan=-0.15, verb=0.3)
    add(stab(ch, 0.25), t0 + 1.5, 0.22, pan=0.15, verb=0.3)
    add(stab(ch, 0.25), t0 + 1.75, 0.18, pan=-0.1, verb=0.3)
    add(pad(ch, 2.05, 1400), t0, 0.14, verb=0.4)
    if fill:
        for k, f in enumerate([220, 196, 165, 147, 130, 110, 98, 82]):
            add(tom(f), t0 + 1.0 + k * 0.125, 0.45, pan=-0.4 + 0.1 * k, verb=0.3)

add(sub_boom(2.5), 16.0, 1.0); add(stab(PROG[0], 0.8), 16.0, 0.5, verb=0.5)
for bar in range(14):  # 16 -> 44
    t0 = 16.0 + bar * BAR
    groove_bar(t0, bar, fill=(t0 == 22.0 + 1.0 and False) or t0 == 22.0, drop_first=(t0 == 32.0))
# TOUCHDOWN at 25.0
add(sub_boom(2.0), 25.0, 0.9); add(bell(988), 25.0, 0.3, verb=0.5); add(bell(1318), 25.08, 0.22, verb=0.5)
add(bp_fft(rng.standard_normal(int(0.8 * SR)), 200, 6000) * np.exp(-t_(int(0.8 * SR)) * 5), 25.0, 0.35, verb=0.6)
add(crowd(4.0) * np.interp(t_(int(4 * SR)), [0, 0.3, 1.5, 4], [0, 1, 0.6, 0]), 24.95, 0.7, verb=0.5)
add(blip(900, 1350), 22.15, 0.18)                 # first-down / red zone push
add(noise_riser(1.0, 800, 8000), 24.0, 0.3)
add(bell(1567, 0.8), 28.0, 0.18, verb=0.4)        # fantasy impact refresh
add(sub_boom(1.5), 30.5, 0.7); add(whoosh(0.4), 30.25, 0.3)
add(blip(1400, 2100), 32.72, 0.22, pan=0.2, verb=0.2)   # chat: KELCE
add(blip(1250, 1650, 0.1), 35.6, 0.2, pan=-0.2, verb=0.2)  # chat: I'm going to be sick
for t in [11.85, 19.85, 20.85, 21.85, 27.8, 29.85, 31.85, 37.8, 39.8, 41.8]:
    add(whoosh(0.45), t - 0.2, 0.22)

# ------------------------------------------------------------------ D: the detail 44-50
add(sub_boom(2.0), 44.0, 0.5)
for bar in range(3):
    t0 = 44.0 + bar * BAR
    ch = PROG[(bar + 1) % 4]
    add(pad(ch, 2.1, 600), t0, 0.3, verb=0.6)
    add(bass(ROOT[(bar + 1) % 4], 1.9), t0, 0.18)
    for b in range(4):
        add(pluck(ch[b] + 24, 0.4, 3000), t0 + b * BEAT, 0.07, pan=0.4 - 0.2 * b, verb=0.7)
for k in range(5): add(tick(), 46.6 + k * 0.5, 0.25)  # countdown seconds
add(blip(1400, 2100), 49.05, 0.12, verb=0.3)

# ------------------------------------------------------------------ E: build + final
roll_t = 50.0; k = 0
while roll_t < 53.3:
    gap = 0.25 if roll_t < 51.0 else 0.125 if roll_t < 52.25 else 0.0625
    add(snare(), roll_t, 0.12 + 0.25 * (roll_t - 50) / 3.3, verb=0.3); roll_t += gap
for b in range(6): add(kick(0.8), 50.0 + b * BEAT, 0.8)
add(noise_riser(3.4, 200, 10000), 50.0, 0.55, verb=0.4)
rise_n = int(3.4 * SR); rt_ = t_(rise_n)
rise = np.sin(2 * np.pi * np.cumsum(110 * 2 ** (rt_ / 3.4 * 2)) / SR) * (rt_ / 3.4) ** 2
add(lp_fft(rise, 2000), 50.0, 0.15, verb=0.3)
add(sub_boom(4.0), 53.5, 1.1)
add(bp_fft(rng.standard_normal(int(1.5 * SR)), 100, 8000) * np.exp(-t_(int(1.5 * SR)) * 3), 53.5, 0.45, verb=0.9)
for k2, on in enumerate([1, 0, 1, 0, 1, 1, 0, 1, 1, 1]):  # neon ignition buzz, synced to flicker
    if on: add(buzz(0.07), 53.7 + k2 * 0.09, 0.10)
end_ch = [38, 45, 50, 53, 57, 64]
add(pad(end_ch, 6.8, 1100), 53.5, 0.42, verb=0.8)
add(pad([26, 38], 6.8, 300), 53.5, 0.35, verb=0.5)
add(bell(587, 3.0), 55.0, 0.10, verb=0.9); add(bell(880, 3.0), 55.5, 0.08, verb=0.9)

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
