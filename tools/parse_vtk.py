"""Parse the Rodero et al. average four-chamber mesh (ASCII VTK) into a compact .npz."""
import sys, numpy as np

def read_block(f, n, cols, dtype):
    data = np.fromfile(f, sep=' ', count=n * cols, dtype=dtype)
    return data.reshape(n, cols) if cols > 1 else data

def main(src, dst):
    out = {}
    with open(src, 'r') as f:
        while True:
            line = f.readline()
            if not line: break
            tok = line.split()
            if not tok: continue
            if tok[0] == 'POINTS':
                n = int(tok[1]); out['pts'] = read_block(f, n, 3, np.float32)
            elif tok[0] == 'CELL_TYPES':
                n = int(tok[1]); out['ctypes'] = read_block(f, n, 1, np.int32)
            elif tok[0] == 'CELLS':
                n = int(tok[1]); out['cells'] = read_block(f, n, 5, np.int64)[:, 1:].astype(np.int32)
            elif tok[0] == 'CELL_DATA':
                ncell = int(tok[1]); section = 'cell'
            elif tok[0] == 'POINT_DATA':
                npt = int(tok[1]); section = 'point'
            elif tok[0] == 'SCALARS':
                name = tok[1].replace('.dat', '')
                f.readline()  # LOOKUP_TABLE
                n = ncell if section == 'cell' else npt
                out[name] = read_block(f, n, 1, np.float32)
            elif tok[0] == 'VECTORS':
                n = ncell if section == 'cell' else npt
                out[tok[1]] = read_block(f, n, 3, np.float32)
    np.savez(dst, **out)
    for k, v in out.items(): print(k, v.shape, v.dtype)

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
