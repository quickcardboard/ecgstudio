"""Quick amplitude/morphology table for one beat of a LiveHeart ECG dump."""
import sys, json, numpy as np
d = json.load(open(sys.argv[1])); L = dict(zip(d['leads'], [np.array(x) for x in d['data']]))
a0, q0, q1, t1 = [int(x) for x in sys.argv[2:6]]   # P onset, QRS onset, QRS end, T end (ms)
scale = float(sys.argv[6]) if len(sys.argv) > 6 else 1
print(f"{'lead':5} {'Pmax':>6} {'Pmin':>6} | {'Rmax':>6} {'Smin':>6} {'QRSnet':>7} | {'ST60':>6} {'Tpeak':>6}")
for k, y in L.items():
    y = y * scale; base = y[a0 - 10]
    P = y[a0:q0] - base; Q = y[q0:q1] - base; T = y[q1:t1] - base
    tp = T[np.argmax(np.abs(T))]
    print(f"{k:5} {P.max():6.2f} {P.min():6.2f} | {Q.max():6.2f} {Q.min():6.2f} {Q.sum()/1000:7.3f} | {y[q1+60]-base:6.2f} {tp:6.2f}")
