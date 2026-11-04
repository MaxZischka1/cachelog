/** 2D affine transforms fitted by least squares. Pure. */

/** x' = a*x + b*y + c ; y' = d*x + e*y + f */
export type Affine = [number, number, number, number, number, number];

export function applyAffine(t: Affine, p: [number, number]): [number, number] {
  return [t[0] * p[0] + t[1] * p[1] + t[2], t[3] * p[0] + t[4] * p[1] + t[5]];
}

/** Solve a 3x3 linear system (Gaussian elimination with partial pivoting). */
function solve3(m: number[][], v: number[]): [number, number, number] | null {
  const a = m.map((row, i) => [...row, v[i]]);
  for (let col = 0; col < 3; col++) {
    let piv = col;
    for (let r = col + 1; r < 3; r++) if (Math.abs(a[r][col]) > Math.abs(a[piv][col])) piv = r;
    if (Math.abs(a[piv][col]) < 1e-12) return null;
    [a[col], a[piv]] = [a[piv], a[col]];
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const f = a[r][col] / a[col][col];
      for (let k = col; k < 4; k++) a[r][k] -= f * a[col][k];
    }
  }
  return [a[0][3] / a[0][0], a[1][3] / a[1][1], a[2][3] / a[2][2]];
}

/**
 * Least-squares affine mapping src[i] -> dst[i]. Needs >= 3 non-collinear points.
 * Inputs are centred first for numerical stability (dst may be UTM metres).
 */
export function fitAffine(src: [number, number][], dst: [number, number][]): Affine | null {
  const n = Math.min(src.length, dst.length);
  if (n < 3) return null;
  let sx = 0, sy = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { sx += src[i][0]; sy += src[i][1]; dx += dst[i][0]; dy += dst[i][1]; }
  sx /= n; sy /= n; dx /= n; dy /= n;
  // Normal equations on centred coords: [Sxx Sxy Sx; Sxy Syy Sy; Sx Sy n]
  const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const vx = [0, 0, 0];
  const vy = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const x = src[i][0] - sx, y = src[i][1] - sy;
    const X = dst[i][0] - dx, Y = dst[i][1] - dy;
    const row = [x, y, 1];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) m[r][c] += row[r] * row[c];
      vx[r] += row[r] * X;
      vy[r] += row[r] * Y;
    }
  }
  const px = solve3(m, vx);
  const py = solve3(m, vy);
  if (!px || !py) return null;
  // Undo centring: X = a(x-sx) + b(y-sy) + c + dx
  const [a, b, c0] = px;
  const [d, e, f0] = py;
  return [a, b, c0 + dx - a * sx - b * sy, d, e, f0 + dy - d * sx - e * sy];
}
