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

