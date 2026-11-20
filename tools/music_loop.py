"""Loop part of a song for a promo video: play the song from its start up to (loop start + loop length), then repeat
[loop start, loop start + loop length) until the duration is filled, with a 20 ms equal-power crossfade at each join
(the tail as the song would have continued, into the loop's start). Pick the loop length from the music (whole bars:
cross-correlate a bar with the same bar a phrase later) and the loop start at a quiet point between hits.
Feed the result to tools/promo_store.js --music. Needs ffmpeg and numpy.

  python3 tools/music_loop.py song.mp3 out.wav --start 0.9516 --length 8.20513 [--duration 31]

The Play Store video's drum loop: "Unconditional" (YouTube Audio Library), 117 BPM, the 4-bar drum intro looped
(--start 0.9516 --length 8.20513), the vocals (from ~10.4 s) never reached."""
import argparse, subprocess, wave
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument('src'); ap.add_argument('out')
ap.add_argument('--start', type=float, required=True, help='loop start, s')
ap.add_argument('--length', type=float, required=True, help='loop length, s (whole bars)')
ap.add_argument('--duration', type=float, default=31.0, help='output length, s')
a = ap.parse_args()
sr = 44100
raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', a.src, '-t', str(a.start + a.length + 1), '-ac', '2', '-ar', str(sr), '-f', 'f32le', '-'],
                     capture_output=True, check=True).stdout
X = np.frombuffer(raw, dtype=np.float32).reshape(-1, 2)
s, L = int(round(a.start * sr)), int(round(a.length * sr))
J, xf, total = s + L, int(0.02 * sr), int(a.duration * sr)
k = np.linspace(0, np.pi / 2, xf)[:, None]
parts, n = [X[:J]], J
while n < total:
    parts += [X[J:J + xf] * np.cos(k) + X[s:s + xf] * np.sin(k), X[s + xf:J]]
    n += L
y = np.concatenate(parts)[:total]
with wave.open(a.out, 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(sr)
    w.writeframes((np.clip(y, -1, 1) * 32767).astype('<i2').tobytes())
print(a.out, f'{len(y) / sr:.2f} s; joins at', ', '.join(f'{(J + i * L) / sr:.3f} s' for i in range(int((total - J) / L) + 1)))
