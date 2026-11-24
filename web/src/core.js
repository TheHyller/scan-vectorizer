function VecCore() {
  'use strict';
  // All bitmaps are padded by 1 px on every side: W = w + 2, H = h + 2. Ink = 1.

  function otsu(hist) {
    let total = 0, sum = 0;
    for (let i = 0; i < 256; i++) { total += hist[i]; sum += i * hist[i]; }
    let sumB = 0, wB = 0, best = 0, thr = 128;
    for (let t = 0; t < 256; t++) {
      wB += hist[t]; if (!wB) continue;
      const wF = total - wB; if (!wF) break;
      sumB += t * hist[t];
      const mB = sumB / wB, mF = (sum - sumB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
      if (v > best) { best = v; thr = t; }
    }
    return thr;
  }

  // Remove connected blobs (8-connected) of at most maxPx pixels.
  function despeckle(bm, W, H, maxPx) {
    const N = W * H;
    if (maxPx <= 0) return 0;
    let stack = new Int32Array(1 << 16), removed = 0;
    const comp = new Int32Array(maxPx + 1);
    const offs = [-W - 1, -W, -W + 1, -1, 1, W - 1, W, W + 1];
    for (let i = W + 1; i < N - W - 1; i++) {
      if (bm[i] !== 1) continue;
      let sp = 0, n = 0;
      stack[sp++] = i; bm[i] = 2;
      while (sp) {
        const p = stack[--sp];
        if (n <= maxPx) comp[n] = p;
        n++;
        for (let k = 0; k < 8; k++) {
          const q = p + offs[k];
          if (bm[q] === 1) {
            bm[q] = 2;
            if (sp === stack.length) { const s2 = new Int32Array(sp * 2); s2.set(stack); stack = s2; }
            stack[sp++] = q;
          }
        }
      }
      if (n <= maxPx) { for (let k = 0; k < n; k++) bm[comp[k]] = 0; removed++; }
    }
    for (let i = 0; i < N; i++) if (bm[i] === 2) bm[i] = 1;
    return removed;
  }

  // Fill pinholes: white regions (4-connected) of at most maxPx pixels enclosed by ink.
  function fillHoles(bm, W, H, maxPx) {
    if (maxPx <= 0) return 0;
    const q = new Int32Array(maxPx + 2), offs = [-W, 1, W, -1];
    let filled = 0;
    for (let y = 1; y < H - 1; y++) {
      const o = y * W;
      for (let x = 2; x < W - 1; x++) {
        const i = o + x;
        if (bm[i] !== 0 || bm[i - 1] !== 1) continue;
        let n = 0, head = 0, open = false;
        q[n++] = i; bm[i] = 4;
        while (head < n) {
          const p = q[head++];
          for (let k = 0; k < 4; k++) {
            const t = p + offs[k];
            if (bm[t] === 0) {
              if (n > maxPx) { open = true; break; }
              bm[t] = 4; q[n++] = t;
            }
          }
          if (open) break;
        }
        const v = open ? 0 : 1;
        for (let k = 0; k < n; k++) bm[q[k]] = v;
        if (!open) filled++;
      }
    }
    return filled;
  }

  // Typical stroke width = median length of ink runs (rows and columns).
  function strokeWidth(bm, W, H) {
    const hist = new Uint32Array(128);
    let total = 0;
    const cnt = new Int32Array(W);
    for (let y = 1; y < H; y++) {
      const o = y * W;
      let run = 0;
      for (let x = 1; x < W; x++) {
        if (bm[o + x]) { run++; cnt[x]++; }
        else {
          if (run) { hist[run > 127 ? 127 : run]++; total++; run = 0; }
          const c = cnt[x];
          if (c) { hist[c > 127 ? 127 : c]++; total++; cnt[x] = 0; }
        }
      }
    }
    if (!total) return 1;
    let acc = 0;
    for (let i = 1; i < 128; i++) { acc += hist[i]; if (acc * 2 >= total) return i; }
    return 3;
  }

  // Mask of "solid" regions: ink that survives erosion by a (2k+1) square, grown back.
  function thickMask(bm, W, H, k) {
    const N = W * H, need = 2 * k + 1, r = k + 2;
    const a = new Uint8Array(N), b = new Uint8Array(N);
    for (let y = 0; y < H; y++) {
      const o = y * W; let c = 0;
      for (let x = 0; x < W; x++) { if (bm[o + x]) { if (++c >= need) a[o + x - k] = 1; } else c = 0; }
    }
    const cnt = new Int32Array(W);
    let any = 0;
    for (let y = 0; y < H; y++) {
      const o = y * W;
      for (let x = 0; x < W; x++) {
        if (a[o + x]) { if (++cnt[x] >= need) { b[o + x - k * W] = 1; any++; } } else cnt[x] = 0;
      }
    }
    if (!any) return null;
    a.fill(0);
    for (let y = 0; y < H; y++) {
      const o = y * W; let d = 1e9;
      for (let x = 0; x < W; x++) { if (b[o + x]) d = 0; else d++; if (d <= r) a[o + x] = 1; }
      d = 1e9;
      for (let x = W - 1; x >= 0; x--) { if (b[o + x]) d = 0; else d++; if (d <= r) a[o + x] = 1; }
    }
    b.fill(0);
    const dist = new Int32Array(W).fill(1e9);
    for (let y = 0; y < H; y++) {
      const o = y * W;
      for (let x = 0; x < W; x++) { if (a[o + x]) dist[x] = 0; else dist[x]++; if (dist[x] <= r) b[o + x] = 1; }
    }
    dist.fill(1e9);
    for (let y = H - 1; y >= 0; y--) {
      const o = y * W;
      for (let x = 0; x < W; x++) { if (a[o + x]) dist[x] = 0; else dist[x]++; if (dist[x] <= r) b[o + x] = 1; }
    }
    for (let i = 0; i < N; i++) b[i] &= bm[i];
    return b;
  }

  // Growable flat coordinate store: points in data, polyline boundaries in off.
  function Store() {
    this.data = new Float32Array(1 << 16); this.n = 0;
    this.off = new Int32Array(1 << 12); this.m = 0;
    this.closed = new Uint8Array(1 << 12); this.flags = new Uint8Array(1 << 12); this.flag = 0;
    this.off[0] = 0;
  }
  Store.prototype.push = function (x, y) {
    if (this.n + 2 > this.data.length) { const d = new Float32Array(this.data.length * 2); d.set(this.data); this.data = d; }
    this.data[this.n++] = x; this.data[this.n++] = y;
  };
  Store.prototype.end = function (closed) {
    if (this.m + 2 > this.off.length) {
      const o = new Int32Array(this.off.length * 2); o.set(this.off); this.off = o;
      const c = new Uint8Array(this.closed.length * 2); c.set(this.closed); this.closed = c;
      const f = new Uint8Array(this.flags.length * 2); f.set(this.flags); this.flags = f;
    }
    this.flags[this.m] = this.flag; this.flag = 0;
    this.closed[this.m] = closed ? 1 : 0;
    this.off[++this.m] = this.n >> 1;
  };
  Store.prototype.pack = function () {
    return { data: this.data.slice(0, this.n), off: this.off.slice(0, this.m + 1), closed: this.closed.slice(0, this.m), flags: this.flags.slice(0, this.m) };
  };

  // Douglas-Peucker on xs/ys[0..n-1] (open). Marks keep[].
  function dp(xs, ys, s0, e0, eps, keep, stack) {
    let sp = 0; stack[sp++] = s0; stack[sp++] = e0;
    keep[s0] = 1; keep[e0] = 1;
    while (sp) {
      const e = stack[--sp], s = stack[--sp];
      if (e <= s + 1) continue;
      const x1 = xs[s], y1 = ys[s], dx = xs[e] - x1, dy = ys[e] - y1, len = Math.sqrt(dx * dx + dy * dy);
      let dmax = -1, k = -1;
      for (let i = s + 1; i < e; i++) {
        const d = len > 0 ? Math.abs(dy * (xs[i] - x1) - dx * (ys[i] - y1)) / len
          : Math.sqrt((xs[i] - x1) * (xs[i] - x1) + (ys[i] - y1) * (ys[i] - y1));
        if (d > dmax) { dmax = d; k = i; }
      }
      if (dmax > eps) { keep[k] = 1; stack[sp++] = s; stack[sp++] = k; stack[sp++] = k; stack[sp++] = e; }
    }
  }

  // Shared buffers for chain simplification.
  let CAP = 0, RX, RY, XS, YS, KEEP, STACK, FIX;
  function need(n) {
    if (n + 2 <= CAP) return;
    CAP = 1 << 12; while (CAP < n + 2) CAP *= 2;
    RX = new Float64Array(CAP); RY = new Float64Array(CAP); XS = new Float64Array(CAP); YS = new Float64Array(CAP);
    KEEP = new Uint8Array(CAP); STACK = new Int32Array(CAP * 2 + 8); FIX = new Uint8Array(CAP);
  }

  // Chain in RX/RY[0..n) -> smoothed, simplified polyline pushed to store. Corners stay fixed,
  // points between corners are averaged so scan jitter does not become wobble. Returns length.
  function chainToStore(n, closed, eps, K, store) {
    if (n < 2) return 0;
    const COS = Math.cos(50 * Math.PI / 180), WT = [3, 2, 1];
    FIX.fill(0, 0, n + 1);
    let any = -1;
    for (let i = 0; i < n; i++) {
      let a, b;
      if (closed) { a = (i - K + n) % n; b = (i + K) % n; if (n < 2 * K + 2) continue; }
      else { if (i < K || i >= n - K) continue; a = i - K; b = i + K; }
      const ax = RX[i] - RX[a], ay = RY[i] - RY[a], bx = RX[b] - RX[i], by = RY[b] - RY[i];
      const d = Math.sqrt((ax * ax + ay * ay) * (bx * bx + by * by));
      if (d > 0 && (ax * bx + ay * by) / d < COS) { FIX[i] = 1; if (any < 0) any = i; }
    }
    let m = n;
    if (closed) {
      if (any > 0) {          // rotate so the chain starts at a corner
        for (let i = 0; i < n; i++) { const j = (i + any) % n; XS[i] = RX[j]; YS[i] = RY[j]; KEEP[i] = FIX[j]; }
        for (let i = 0; i < n; i++) { RX[i] = XS[i]; RY[i] = YS[i]; FIX[i] = KEEP[i]; }
      }
      RX[n] = RX[0]; RY[n] = RY[0]; m = n + 1;
    }
    FIX[0] = 1; FIX[m - 1] = 1;
    let prevFix = 0, nextFix = 0;
    for (let i = 0; i < m; i++) {
      if (FIX[i]) { XS[i] = RX[i]; YS[i] = RY[i]; prevFix = i; continue; }
      if (nextFix <= i) { nextFix = i + 1; while (!FIX[nextFix]) nextFix++; }
      const r = Math.min(2, i - prevFix, nextFix - i);
      let sx = 0, sy = 0, sw = 0;
      for (let k = -r; k <= r; k++) { const w = WT[k < 0 ? -k : k]; sx += w * RX[i + k]; sy += w * RY[i + k]; sw += w; }
      XS[i] = sx / sw; YS[i] = sy / sw;
    }
    KEEP.fill(0, 0, m);
    if (closed) {
      let far = 1, fd = -1;
      for (let i = 1; i < m - 1; i++) { const dd = (XS[i] - XS[0]) ** 2 + (YS[i] - YS[0]) ** 2; if (dd > fd) { fd = dd; far = i; } }
      dp(XS, YS, 0, far, eps, KEEP, STACK); dp(XS, YS, far, m - 1, eps, KEEP, STACK);
      KEEP[m - 1] = 0;
    } else dp(XS, YS, 0, m - 1, eps, KEEP, STACK);
    let len = 0, px = 0, py = 0, first = true, fx = 0, fy = 0, cnt = 0;
    for (let i = 0; i < m; i++) {
      if (!KEEP[i]) continue;
      store.push(XS[i], YS[i]); cnt++;
      if (first) { first = false; fx = XS[i]; fy = YS[i]; } else len += Math.hypot(XS[i] - px, YS[i] - py);
      px = XS[i]; py = YS[i];
    }
    if (closed) len += Math.hypot(fx - px, fy - py);
    if (closed && cnt < 3) { store.n -= cnt * 2; return 0; }
    store.end(closed);
    return len;
  }

  // Trace boundaries of ink (8-connected) into closed polygons through the midpoints of the
  // pixel edges (a clean staircase becomes a straight line). Mutates bm (left edges -> 3).
  function traceOutlines(bm, W, H, minArea, eps, store) {
    const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
    need(1 << 12);
    let count = 0;
    for (let y = 1; y < H - 1; y++) {
      const o = y * W;
      for (let x = 1; x < W - 1; x++) {
        if (bm[o + x] !== 1 || bm[o + x - 1]) continue;
        let vx = x, vy = y + 1, d = 0, n = 0, area = 0;
        do {
          if (d === 0) bm[(vy - 1) * W + vx] = 3;
          if (n + 2 >= CAP) {
            const ox = RX.slice(0, n), oy = RY.slice(0, n); CAP = 0; need(n * 2); RX.set(ox); RY.set(oy);
          }
          RX[n] = vx + DX[d] * 0.5 - 1; RY[n] = vy + DY[d] * 0.5 - 1; n++;   // -1 removes the padding
          area += vx * DY[d] - vy * DX[d];
          vx += DX[d]; vy += DY[d];
          const p = vy * W + vx;
          const NW = bm[p - W - 1], NE = bm[p - W], SW = bm[p - 1], SE = bm[p];
          let AL, AR;
          if (d === 0) { AL = NW; AR = NE; } else if (d === 1) { AL = NE; AR = SE; }
          else if (d === 2) { AL = SE; AR = SW; } else { AL = SW; AR = NW; }
          d = AL ? (d + 3) & 3 : AR ? d : (d + 1) & 3;
        } while (!(vx === x && vy === y + 1 && d === 0));
        if (n < 4 || Math.abs(area) / 2 < minArea) continue;
        if (chainToStore(n, true, eps, 3, store) > 0) count++;
      }
    }
    return count;
  }

  // Zhang-Suen thinning, list based. Returns { list, n } of skeleton pixel indices.
  function thin(bm, W, H) {
    const N = W * H;
    let n = 0;
    for (let i = 0; i < N; i++) if (bm[i]) n++;
    const ink = n;
    let list = new Int32Array(n), del = new Int32Array(n);
    n = 0;
    for (let i = 0; i < N; i++) if (bm[i]) list[n++] = i;
    let changed = true, iter = 0;
    while (changed && iter < 200) {
      changed = false; iter++;
      for (let sub = 0; sub < 2; sub++) {
        let nd = 0;
        for (let k = 0; k < n; k++) {
          const p = list[k];
          const p2 = bm[p - W], p3 = bm[p - W + 1], p4 = bm[p + 1], p5 = bm[p + W + 1],
            p6 = bm[p + W], p7 = bm[p + W - 1], p8 = bm[p - 1], p9 = bm[p - W - 1];
          const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (B < 2 || B > 6) continue;
          const A = (!p2 && p3) + (!p3 && p4) + (!p4 && p5) + (!p5 && p6) + (!p6 && p7) + (!p7 && p8) + (!p8 && p9) + (!p9 && p2);
          if (A !== 1) continue;
          if (sub === 0) { if (p2 * p4 * p6 || p4 * p6 * p8) continue; }
          else { if (p2 * p4 * p8 || p2 * p6 * p8) continue; }
          del[nd++] = p;
        }
        if (nd) {
          changed = true;
          for (let k = 0; k < nd; k++) bm[del[k]] = 0;
          let m = 0;
          for (let k = 0; k < n; k++) { const p = list[k]; if (bm[p]) list[m++] = p; }
          n = m;
        }
      }
    }
    return { list, n, ink };
  }

  // Skeleton pixels -> polylines (arrays of pixel indices) with spur pruning and chain merging.
  function skeletonGraph(bm, W, list, n, spurLen) {
    const nb = new Int32Array(8);
    function nbrs(p) {
      let c = 0;
      const N = bm[p - W], E = bm[p + 1], S = bm[p + W], Wt = bm[p - 1];
      if (N) nb[c++] = p - W; if (E) nb[c++] = p + 1; if (S) nb[c++] = p + W; if (Wt) nb[c++] = p - 1;
      if (!N && !E && bm[p - W + 1]) nb[c++] = p - W + 1;
      if (!S && !E && bm[p + W + 1]) nb[c++] = p + W + 1;
      if (!S && !Wt && bm[p + W - 1]) nb[c++] = p + W - 1;
      if (!N && !Wt && bm[p - W - 1]) nb[c++] = p - W - 1;
      return c;
    }
    // bm value becomes 16 + degree; bit 32 = visited
    const degs = new Uint8Array(n);
    for (let k = 0; k < n; k++) degs[k] = nbrs(list[k]);
    for (let k = 0; k < n; k++) bm[list[k]] = 16 + degs[k];
    const polys = [];
    const dots = [];
    const loc = new Int32Array(8);
    for (let k = 0; k < n; k++) {
      const p = list[k], dg = degs[k];
      if (dg === 2) continue;
      if (dg === 0) { dots.push(p); continue; }
      const c = nbrs(p);
      for (let j = 0; j < c; j++) loc[j] = nb[j];
      for (let j = 0; j < c; j++) {
        const q = loc[j], vq = bm[q];
        if ((vq & 15) !== 2) { if (p < q) polys.push({ pts: [p, q], closed: false }); continue; }
        if (vq & 32) continue;
        const path = [p, q];
        bm[q] |= 32;
        let prev = p, cur = q;
        for (;;) {
          nbrs(cur);
          const nx = nb[0] === prev ? nb[1] : nb[0];
          path.push(nx);
          const vn = bm[nx];
          if ((vn & 15) !== 2 || (vn & 32)) break;
          bm[nx] |= 32; prev = cur; cur = nx;
        }
        polys.push({ pts: path, closed: false });
      }
    }
    for (let k = 0; k < n; k++) {     // pure loops
      const p = list[k];
      if (degs[k] !== 2 || (bm[p] & 32)) continue;
      const path = [p];
      bm[p] |= 32;
      nbrs(p);
      let prev = p, cur = nb[0];
      while (cur !== p && !(bm[cur] & 32)) {
        bm[cur] |= 32; path.push(cur);
        nbrs(cur);
        const nx = nb[0] === prev ? nb[1] : nb[0];
        prev = cur; cur = nx;
      }
      polys.push({ pts: path, closed: true });
    }
    // endpoint map
    const ends = new Map();
    const add = (p, pl) => { const a = ends.get(p); if (a) a.push(pl); else ends.set(p, [pl]); };
    for (const pl of polys) if (!pl.closed) { add(pl.pts[0], pl); add(pl.pts[pl.pts.length - 1], pl); }
    // prune short spurs: one free end, other end at a junction
    if (spurLen > 0) {
      for (const pl of polys) {
        if (pl.closed || pl.pts.length > spurLen) continue;
        const a = pl.pts[0], b = pl.pts[pl.pts.length - 1];
        const ca = ends.get(a).length, cb = ends.get(b).length;
        if ((ca === 1 && cb >= 3) || (cb === 1 && ca >= 3)) {
          pl.dead = true;
          const ea = ends.get(a); ea.splice(ea.indexOf(pl), 1);
          const eb = ends.get(b); eb.splice(eb.indexOf(pl), 1);
        }
      }
    }
    // merge chains through nodes where exactly two polylines meet
    for (const [node, arr] of ends) {
      if (arr.length !== 2) continue;
      const a = arr[0], b = arr[1];
      if (a === b) { a.closed = true; a.pts.pop(); arr.length = 0; continue; }
      if (a.pts[a.pts.length - 1] !== node) a.pts.reverse();
      if (b.pts[0] !== node) b.pts.reverse();
      for (let i = 1; i < b.pts.length; i++) a.pts.push(b.pts[i]);
      b.dead = true; arr.length = 0;
      const other = b.pts[b.pts.length - 1], eo = ends.get(other);
      eo[eo.indexOf(b)] = a;
    }
    return { polys, dots };
  }

  function polysToStore(polys, dots, W, eps, store, bm, trim) {
    let len = 0;
    for (const pl of polys) {
      if (pl.dead) continue;
      let pts = pl.pts;
      let flag = 0;
      if (trim && !pl.closed && bm && pts.length > 3 * trim + 3) {
        // ends at junctions are bent by thinning: on long straight axis lines cut them back,
        // the clean-up re-extends them to the exact intersection
        const j0 = (bm[pts[0]] & 15) >= 3, j1 = (bm[pts[pts.length - 1]] & 15) >= 3;
        if (j0 || j1) {
          const a = j0 ? trim : 0, b = pts.length - (j1 ? trim : 0) - 1;
          const ax = pts[a] % W, ay = (pts[a] / W) | 0, bx = pts[b] % W, by = (pts[b] / W) | 0;
          const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
          let ok = L > 0 && (Math.abs(dy) <= 0.05 * Math.abs(dx) || Math.abs(dx) <= 0.05 * Math.abs(dy));
          for (let i = a; ok && i <= b; i += 2) {
            const px = pts[i] % W, py = (pts[i] / W) | 0;
            if (Math.abs(dy * (px - ax) - dx * (py - ay)) / L > 0.6 * trim + 0.6) ok = false;
          }
          if (ok) { pts = pts.slice(a, b + 1); flag = (j0 ? 1 : 0) | (j1 ? 2 : 0); }
        }
      }
      const n = pts.length;
      need(n + 1);
      for (let i = 0; i < n; i++) { const p = pts[i]; RX[i] = (p % W) - 0.5; RY[i] = ((p / W) | 0) - 0.5; }
      store.flag = flag;
      len += chainToStore(n, pl.closed, eps, 4, store);
    }
    for (const p of dots) {
      const x = (p % W) - 0.5, y = ((p / W) | 0) - 0.5;
      store.push(x, y); store.push(x + 0.01, y); store.end(false);
    }
    return len;
  }


  // ---------- solid fills: grow the eroded core back into tapering tips (arrow points) ----------
  // Ink next to a fill is added while it is clearly thicker than a normal line, so the tip of an
  // arrow is filled but a pipe running out of it is not.
  function growFills(bm, mask, W, H, sw, maxDepth) {
    const thr = Math.max(sw + 1.5, sw * 1.4), cap = Math.ceil(thr) + 1;
    const run = (p, step) => {
      let n = 1, q = p + step;
      while (n < cap && bm[q]) { n++; q += step; }
      q = p - step;
      while (n < cap && bm[q]) { n++; q -= step; }
      return n;
    };
    const thick = p => Math.min(run(p, 1), run(p, W), Math.SQRT2 * run(p, W + 1), Math.SQRT2 * run(p, W - 1));
    const offs = [-W - 1, -W, -W + 1, -1, 1, W - 1, W, W + 1];
    let cur = [], grown = 0;
    for (let i = W + 1, N = W * H - W - 1; i < N; i++) {
      if (!mask[i]) continue;
      for (let k = 0; k < 8; k++) { const q = i + offs[k]; if (bm[q] && !mask[q]) { cur.push(i); break; } }
    }
    for (let depth = 0; depth < maxDepth && cur.length; depth++) {
      const next = [];
      for (const p of cur) {
        for (let k = 0; k < 8; k++) {
          const q = p + offs[k];
          if (!bm[q] || mask[q]) continue;
          if (thick(q) >= thr) { mask[q] = 1; next.push(q); grown++; } else mask[q] = 2;   // 2 = tested, rejected
        }
      }
      cur = next;
    }
    for (let i = 0, N = W * H; i < N; i++) if (mask[i] === 2) mask[i] = 0;
    return grown;
  }

  // Small leftover ink pieces that touch a fill (arrow points, corners of bold letters) join it.
  function absorbSmall(bm, mask, W, H, maxArea) {
    const offs = [-W - 1, -W, -W + 1, -1, 1, W - 1, W, W + 1];
    let stack = new Int32Array(1024), absorbed = 0;
    const comp = [];
    for (let i = W + 1, N = W * H - W - 1; i < N; i++) {
      if (mask[i] !== 1) continue;
      for (let k = 0; k < 8; k++) {
        const s0 = i + offs[k];
        if (!bm[s0] || mask[s0]) continue;
        let sp = 0, big = false;
        comp.length = 0;
        stack[sp++] = s0; mask[s0] = 4;
        while (sp) {
          const p = stack[--sp];
          comp.push(p);
          if (comp.length > maxArea) { big = true; break; }
          for (let j = 0; j < 8; j++) {
            const q = p + offs[j];
            if (bm[q] && !mask[q]) {
              mask[q] = 4;
              if (sp === stack.length) { const s2 = new Int32Array(sp * 2); s2.set(stack); stack = s2; }
              stack[sp++] = q;
            }
          }
        }
        if (big) {
          // mark the whole component as tested so it is not flooded again from another side
          while (sp) comp.push(stack[--sp]);
          for (let c = 0; c < comp.length; c++) {
            const p = comp[c]; mask[p] = 3;
            for (let j = 0; j < 8; j++) { const q = p + offs[j]; if (bm[q] && !mask[q]) { mask[q] = 3; comp.push(q); } }
          }
        } else { for (const p of comp) mask[p] = 1; absorbed += comp.length; }
      }
    }
    for (let i = 0, N = W * H; i < N; i++) if (mask[i] === 3) mask[i] = 0;
    return absorbed;
  }

  // ---------- recognized text: remove letter shapes that lie fully inside a word box ----------
  function eraseText(bm, W, H, boxes) {
    let erased = 0, stack = new Int32Array(4096);
    const comp = [];
    const offs = [-W - 1, -W, -W + 1, -1, 1, W - 1, W, W + 1];
    for (const b of boxes) {
      const pad = Math.max(2, Math.round(0.25 * Math.min(b.w, b.h)));
      const x0 = Math.max(1, Math.floor(b.x) + 1 - pad), y0 = Math.max(1, Math.floor(b.y) + 1 - pad);
      const x1 = Math.min(W - 2, Math.ceil(b.x + b.w) + 1 + pad), y1 = Math.min(H - 2, Math.ceil(b.y + b.h) + 1 + pad);
      const ix0 = Math.floor(b.x) + 1, iy0 = Math.floor(b.y) + 1, ix1 = Math.ceil(b.x + b.w) + 1, iy1 = Math.ceil(b.y + b.h) + 1;
      for (let y = iy0; y <= iy1 && y < H - 1; y++) {
        for (let x = ix0; x <= ix1 && x < W - 1; x++) {
          const s0 = y * W + x;
          if (bm[s0] !== 1) continue;
          let sp = 0, inside = true;
          comp.length = 0;
          stack[sp++] = s0; bm[s0] = 5;
          while (sp) {
            const p = stack[--sp];
            comp.push(p);
            const px = p % W, py = (p / W) | 0;
            if (px < x0 || px > x1 || py < y0 || py > y1) { inside = false; }
            if (!inside && comp.length > 20000) break;
            for (let k = 0; k < 8; k++) {
              const q = p + offs[k];
              if (bm[q] === 1) {
                bm[q] = 5;
                if (sp === stack.length) { const s2 = new Int32Array(sp * 2); s2.set(stack); stack = s2; }
                stack[sp++] = q;
              }
            }
          }
          if (inside) { for (const p of comp) bm[p] = 0; erased += comp.length; }
          else {
            for (const p of comp) bm[p] = 6;           // keep, but do not test again
            while (sp) bm[stack[--sp]] = 6;
          }
        }
      }
    }
    for (let i = 0, N = W * H; i < N; i++) if (bm[i] > 1) bm[i] = 1;
    return erased;
  }

  // ---------- geometry clean-up on finished polylines ----------
  function unpack(p) {
    const out = [];
    for (let i = 0; i + 1 < p.off.length; i++) {
      const s = p.off[i], e = p.off[i + 1], xs = [], ys = [];
      for (let k = s; k < e; k++) { xs.push(p.data[2 * k]); ys.push(p.data[2 * k + 1]); }
      out.push({ xs, ys, closed: p.closed ? !!p.closed[i] : true, flags: p.flags ? p.flags[i] : 0 });
    }
    return out;
  }
  function repack(list, store) {
    for (const pl of list) {
      const n = pl.xs.length;
      if (n < 2 || (pl.closed && n < 3)) continue;
      for (let i = 0; i < n; i++) store.push(pl.xs[i], pl.ys[i]);
      store.flag = pl.flags || 0;
      store.end(pl.closed);
    }
  }

  // Scanner skew: length-weighted peak of near-axis segment angles.
  function estimateSkew(lists, minLen) {
    const BIN = 0.02, R = 3, NB = Math.round(2 * R / BIN) + 1, hist = new Float64Array(NB);
    let tot = 0;
    for (const list of lists) for (const pl of list) {
      const n = pl.xs.length, segs = pl.closed ? n : n - 1;
      for (let i = 0; i < segs; i++) {
        const j = (i + 1) % n, dx = pl.xs[j] - pl.xs[i], dy = pl.ys[j] - pl.ys[i], len = Math.hypot(dx, dy);
        if (len < minLen) continue;
        let a = Math.atan2(dy, dx) * 180 / Math.PI;
        a = ((a % 90) + 135) % 90 - 45;            // deviation from the nearest axis
        if (Math.abs(a) > R) continue;
        const b = Math.round((a + R) / BIN);
        hist[b] += len; tot += len;
      }
    }
    if (tot < minLen * 20) return 0;
    let best = -1, bi = 0;
    for (let i = 0; i < NB; i++) {
      let v = 0;
      for (let k = -5; k <= 5; k++) { const j = i + k; if (j >= 0 && j < NB) v += hist[j] * (6 - Math.abs(k)); }
      if (v > best) { best = v; bi = i; }
    }
    // refine: weighted mean around the peak
    let sw = 0, sa = 0;
    for (let k = -8; k <= 8; k++) { const j = bi + k; if (j >= 0 && j < NB) { sw += hist[j]; sa += hist[j] * (j * BIN - R); } }
    const a = sw ? sa / sw : 0;
    return Math.abs(a) < 0.03 ? 0 : a;
  }

  function rotateAll(lists, ang, cx, cy) {
    const c = Math.cos(-ang * Math.PI / 180), s = Math.sin(-ang * Math.PI / 180);
    for (const list of lists) for (const pl of list) {
      for (let i = 0; i < pl.xs.length; i++) {
        const x = pl.xs[i] - cx, y = pl.ys[i] - cy;
        pl.xs[i] = cx + x * c - y * s; pl.ys[i] = cy + x * s + y * c;
      }
    }
  }

  // Make near-horizontal / near-vertical runs exactly straight, then drop collinear points.
  function orthoSnap(pl, tolDeg) {
    let n = pl.xs.length;
    if (n < 2) return;
    const closed = pl.closed, segs = closed ? n : n - 1, t = Math.tan(tolDeg * Math.PI / 180);
    const cls = new Int8Array(segs);
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % n, dx = Math.abs(pl.xs[j] - pl.xs[i]), dy = Math.abs(pl.ys[j] - pl.ys[i]);
      if (dx > 0 && dy <= Math.max(t * dx, Math.min(0.35, 0.5 * dx))) cls[i] = 1;
      else if (dy > 0 && dx <= Math.max(t * dy, Math.min(0.35, 0.5 * dy))) cls[i] = 2;
    }
    // runs of equal class
    let start = 0;
    if (closed) { while (start < segs && cls[start] === cls[(start - 1 + segs) % segs]) start++; if (start === segs) start = 0; }
    const runOf = new Int32Array(segs).fill(-1), runVal = [];
    let r = -1;
    for (let k = 0; k < segs; k++) {
      const i = (start + k) % segs;
      const prev = k === 0 ? -99 : cls[(start + k - 1) % segs];
      if (cls[i] && cls[i] === prev && !(closed && k === 0)) runOf[i] = r;
      else if (cls[i]) { r = runVal.length; runVal.push([0, 0]); runOf[i] = r; }
      if (cls[i]) {
        const j = (i + 1) % n, len = Math.hypot(pl.xs[j] - pl.xs[i], pl.ys[j] - pl.ys[i]) + 1e-6;
        const v = cls[i] === 1 ? (pl.ys[i] + pl.ys[j]) / 2 : (pl.xs[i] + pl.xs[j]) / 2;
        runVal[runOf[i]][0] += v * len; runVal[runOf[i]][1] += len;
      }
    }
    const nx = pl.xs.slice(), ny = pl.ys.slice();
    for (let v = 0; v < n; v++) {
      const ins = closed ? (v - 1 + n) % n : v - 1, outs = closed ? v % segs : (v < segs ? v : -1);
      for (const sg of [ins, outs]) {
        if (sg < 0 || !cls[sg]) continue;
        const rv = runVal[runOf[sg]], val = rv[0] / rv[1];
        if (cls[sg] === 1) ny[v] = val; else nx[v] = val;
      }
    }
    // drop vertices inside one run
    const xs = [], ys = [];
    for (let v = 0; v < n; v++) {
      const ins = closed ? (v - 1 + n) % n : v - 1, outs = closed ? v % segs : (v < segs ? v : -1);
      if (ins >= 0 && outs >= 0 && cls[ins] && runOf[ins] === runOf[outs] && cls[outs] === cls[ins]) continue;
      xs.push(nx[v]); ys.push(ny[v]);
    }
    pl.xs = xs; pl.ys = ys;
  }

  // A tiny chamfer between two long edges becomes their intersection (sharp corner).
  function sharpen(pl, maxShort) {
    const n = pl.xs.length;
    if (n < 4) return;
    const xs = pl.xs, ys = pl.ys, closed = pl.closed;
    const L = (i, j) => Math.hypot(xs[j] - xs[i], ys[j] - ys[i]);
    const outX = [], outY = [];
    const skip = new Uint8Array(n), repl = [];
    const lim = closed ? n : n - 3;
    for (let i = 0; i < lim; i++) {
      const a = i, b = (i + 1) % n, c = (i + 2) % n, d = (i + 3) % n;
      if (skip[b] || skip[c]) continue;
      const lb = L(b, c);
      if (lb > maxShort) continue;
      const la = L(a, b), lc = L(c, d);
      if (la < Math.max(3, 2.5 * lb) || lc < Math.max(3, 2.5 * lb)) continue;
      const ux = (xs[b] - xs[a]) / la, uy = (ys[b] - ys[a]) / la, vx = (xs[d] - xs[c]) / lc, vy = (ys[d] - ys[c]) / lc;
      const cr = ux * vy - uy * vx;
      if (Math.abs(cr) < Math.sin(35 * Math.PI / 180)) continue;
      const tt = ((xs[c] - xs[b]) * vy - (ys[c] - ys[b]) * vx) / cr;
      const px = xs[b] + ux * tt, py = ys[b] + uy * tt;
      const mx = (xs[b] + xs[c]) / 2, my = (ys[b] + ys[c]) / 2;
      if (Math.hypot(px - mx, py - my) > 2 * lb + 1) continue;
      skip[b] = 1; skip[c] = 2; repl[b] = [px, py];
    }
    for (let v = 0; v < n; v++) {
      if (skip[v] === 2) continue;
      if (skip[v] === 1) { outX.push(repl[v][0]); outY.push(repl[v][1]); continue; }
      outX.push(xs[v]); outY.push(ys[v]);
    }
    pl.xs = outX; pl.ys = outY;
  }

  // Free line ends that stop just short of (or just past) another line are extended or
  // trimmed onto it, so T-junctions meet exactly.
  function snapEnds(list, r0, extra, trimLen) {
    const r = r0 + trimLen;
    const CELL = 32, grid = new Map(), all = extra ? list.concat(extra) : list;
    const key = (cx, cy) => cx * 73856093 ^ cy * 19349663;
    all.forEach((pl, pi) => {
      const n = pl.xs.length, segs = pl.closed ? n : n - 1;
      for (let i = 0; i < segs; i++) {
        const j = (i + 1) % n;
        const x0 = Math.min(pl.xs[i], pl.xs[j]) - r, x1 = Math.max(pl.xs[i], pl.xs[j]) + r;
        const y0 = Math.min(pl.ys[i], pl.ys[j]) - r, y1 = Math.max(pl.ys[i], pl.ys[j]) + r;
        for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++)
          for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++) {
            const k = key(cx, cy); let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(pi, i);
          }
      }
    });
    const moves = [];
    list.forEach((pl, pi) => {
      if (pl.closed || pl.xs.length < 2) return;
      const n = pl.xs.length;
      for (const end of [0, 1]) {
        const E = end ? n - 1 : 0, P = end ? n - 2 : 1, Q = end ? n - 3 : 2;
        const trimmed = (pl.flags || 0) & (end ? 2 : 1), rr = trimmed ? r : r0;
        const ex = pl.xs[E], ey = pl.ys[E];
        const lastLen = Math.hypot(ex - pl.xs[P], ey - pl.ys[P]);
        const rays = [{ bx: pl.xs[P], by: pl.ys[P], dx: ex - pl.xs[P], dy: ey - pl.ys[P], drop: false }];
        if (n >= 3 && lastLen < 2.2 * r0) {
          const dx = pl.xs[P] - pl.xs[Q], dy = pl.ys[P] - pl.ys[Q], l2 = Math.hypot(dx, dy);
          const cosb = l2 && lastLen ? (dx * (ex - pl.xs[P]) + dy * (ey - pl.ys[P])) / (l2 * lastLen) : 1;
          if (l2 > lastLen && cosb < Math.cos(15 * Math.PI / 180)) rays.push({ bx: pl.xs[P], by: pl.ys[P], dx, dy, drop: true });
        }
        const cands = grid.get(key(Math.floor(ex / CELL), Math.floor(ey / CELL)));
        if (!cands) continue;
        let best = null;
        for (let c = 0; c < cands.length; c += 2) {
          const qi = cands[c], si = cands[c + 1], q = all[qi];
          const qn = q.xs.length, sj = (si + 1) % qn;
          if (qi === pi) {
            const segE = end ? n - 2 : 0;
            if (Math.abs(si - segE) <= 2) continue;
          }
          const ax = q.xs[si], ay = q.ys[si], bx = q.xs[sj], by = q.ys[sj];
          const sx = bx - ax, sy = by - ay, sl = Math.hypot(sx, sy);
          if (sl < 1e-6) continue;
          for (const ray of rays) {
            const rl = Math.hypot(ray.dx, ray.dy); if (rl < 1e-6) continue;
            const ux = ray.dx / rl, uy = ray.dy / rl, cr = ux * sy - uy * sx;
            if (Math.abs(cr) < 0.25 * sl) continue;                    // nearly parallel
            const t = ((ax - ray.bx) * sy - (ay - ray.by) * sx) / cr;  // along ray
            const u = ((ax - ray.bx) * uy - (ay - ray.by) * ux) / cr;  // along segment, 0..1
            const qf = qi < list.length ? (q.flags || 0) : 0;   // trimmed ends of other lines may be extended too
            const ext = (si === 0 && (qf & 1)) || (sj === qn - 1 && (qf & 2)) ? r : 0.5;
            if (u < -ext / sl || u > 1 + ext / sl || t < 0) continue;
            const X = ray.bx + ux * t, Y = ray.by + uy * t, dist = Math.hypot(X - ex, Y - ey);
            if (dist > rr + (ray.drop ? lastLen : 0)) continue;
            const score = dist + (ray.drop ? 0.25 : 0);
            if (!best || score < best.score) best = { score, X, Y, drop: ray.drop };
          }
        }
        if (best) moves.push({ pl, end, X: best.X, Y: best.Y, drop: best.drop });
      }
    });
    for (const m of moves) {
      const pl = m.pl, n = pl.xs.length;
      if (m.drop && n >= 3) {
        if (m.end) { pl.xs.pop(); pl.ys.pop(); } else { pl.xs.shift(); pl.ys.shift(); }
      }
      const E = m.end ? pl.xs.length - 1 : 0;
      pl.xs[E] = m.X; pl.ys[E] = m.Y;
    }
    return moves.length;
  }

  // A piece that is an axis-aligned line plus scan noise is re-simplified coarsely.
  function relaxAxis(pl, eps, tolDeg) {
    const n = pl.xs.length;
    if (n < 3) return;
    need(n + 2);
    for (let i = 0; i < n; i++) { XS[i] = pl.xs[i]; YS[i] = pl.ys[i]; }
    const m = pl.closed ? n + 1 : n;
    if (pl.closed) { XS[n] = XS[0]; YS[n] = YS[0]; }
    KEEP.fill(0, 0, m);
    dp(XS, YS, 0, m - 1, eps, KEEP, STACK);
    const xs = [], ys = [];
    for (let i = 0; i < m; i++) if (KEEP[i]) { xs.push(XS[i]); ys.push(YS[i]); }
    if (pl.closed) { xs.pop(); ys.pop(); if (xs.length < 3) return; }
    const t = Math.tan((tolDeg || 2) * Math.PI / 180), segs = pl.closed ? xs.length : xs.length - 1;
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % xs.length, dx = Math.abs(xs[j] - xs[i]), dy = Math.abs(ys[j] - ys[i]);
      if (!(dy <= t * dx || dx <= t * dy)) return;
    }
    pl.xs = xs; pl.ys = ys;
  }

  // Pieces of one long line (split at crossings) get one common x (vertical) or y (horizontal).
  function alignAxes(list, tol, gap) {
    for (const axis of [1, 2]) {
      const segs = [];
      list.forEach(pl => {
        const n = pl.xs.length, cnt = pl.closed ? n : n - 1;
        for (let i = 0; i < cnt; i++) {
          const j = (i + 1) % n;
          if (axis === 1 ? pl.ys[i] !== pl.ys[j] : pl.xs[i] !== pl.xs[j]) continue;
          const len = axis === 1 ? Math.abs(pl.xs[j] - pl.xs[i]) : Math.abs(pl.ys[j] - pl.ys[i]);
          if (len < 2) continue;
          const c = axis === 1 ? pl.ys[i] : pl.xs[i];
          const a0 = axis === 1 ? Math.min(pl.xs[i], pl.xs[j]) : Math.min(pl.ys[i], pl.ys[j]);
          segs.push({ pl, i, j, c, a0, a1: a0 + len, len });
        }
      });
      segs.sort((p, q) => p.c - q.c);
      // group by coordinate, then chain along the axis
      let k = 0;
      while (k < segs.length) {
        let e = k + 1;
        while (e < segs.length && segs[e].c - segs[e - 1].c <= tol) e++;
        if (e - k > 1) {
          const grp = segs.slice(k, e).sort((p, q) => p.a0 - q.a0);
          let st = 0;
          for (let g = 1; g <= grp.length; g++) {
            const brk = g === grp.length || grp[g].a0 - Math.max(...grp.slice(st, g).map(z => z.a1)) > gap;
            if (!brk) continue;
            const run = grp.slice(st, g);
            const cs = run.map(z => z.c);
            if (run.length > 1 && Math.max(...cs) - Math.min(...cs) <= tol) {
              let sw = 0, sc = 0;
              for (const z of run) { sw += z.len; sc += z.len * z.c; }
              const c = sc / sw;
              for (const z of run) {
                if (axis === 1) { z.pl.ys[z.i] = c; z.pl.ys[z.j] = c; } else { z.pl.xs[z.i] = c; z.pl.xs[z.j] = c; }
              }
            }
            st = g;
          }
        }
        k = e;
      }
    }
  }

  function straighten(lines, fills, o) {
    const L = unpack(lines), F = unpack(fills);
    let skew = 0;
    if (typeof o.forceSkew === 'number') {
      skew = o.forceSkew;
      if (skew) rotateAll([L, F], skew, o.cx, o.cy);
    } else if (o.deskew) {
      skew = estimateSkew([L, F], Math.max(120, 40 * o.sw));
      if (skew) rotateAll([L, F], skew, o.cx, o.cy);
    }
    let snapped = 0;
    if (o.ortho) {
      const relax = 0.5 * o.sw + 0.4;
      const tol = o.tol || 2;
      for (const pl of L) { relaxAxis(pl, relax, tol); orthoSnap(pl, tol); }
      alignAxes(L, 0.9 * o.sw + 0.5, 2 * o.sw + 4);
      for (const pl of L) sharpen(pl, Math.max(1.6, 0.7 * o.sw));
      for (const pl of F) { orthoSnap(pl, tol); sharpen(pl, Math.max(1.6, 0.7 * o.sw)); orthoSnap(pl, tol); }
      snapped = o.snapR === 0 ? 0 : snapEnds(L, o.snapR > 0 ? o.snapR : 1.3 * o.sw + 2, F, Math.ceil(o.sw * 0.9) + 1);
      for (const pl of L) orthoSnap(pl, 0.5);
    }
    const ls = new Store(), fs = new Store();
    repack(L, ls); repack(F, fs);
    return { lines: ls.pack(), fills: fs.pack(), skew, snapped };
  }

  // ---------- scan analysis for automatic settings ----------
  function analyze(bm, W, H) {
    const N = W * H;
    let ink = 0;
    for (let i = 0; i < N; i++) ink += bm[i];
    const sw = strokeWidth(bm, W, H);
    // connected components: specks, letter-sized blobs, big structures
    let stack = new Int32Array(1 << 16);
    const offs = [-W - 1, -W, -W + 1, -1, 1, W - 1, W, W + 1];
    let specks = 0, letters = 0, letterInk = 0, comps = 0, bigInk = 0;
    const tiny = Math.max(2, Math.round(sw * sw * 0.6));
    for (let i = W + 1; i < N - W - 1; i++) {
      if (bm[i] !== 1) continue;
      let sp = 0, n = 0, x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
      stack[sp++] = i; bm[i] = 2;
      while (sp) {
        const p = stack[--sp]; n++;
        const x = p % W, y = (p / W) | 0;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        for (let k = 0; k < 8; k++) {
          const q = p + offs[k];
          if (bm[q] === 1) { bm[q] = 2; if (sp === stack.length) { const s2 = new Int32Array(sp * 2); s2.set(stack); stack = s2; } stack[sp++] = q; }
        }
      }
      comps++;
      const w = x1 - x0 + 1, h = y1 - y0 + 1;
      if (n <= tiny) specks++;
      else if (h >= 3 * sw && h <= 22 * sw && w <= 26 * sw) { letters++; letterInk += n; }
      else if (Math.max(w, h) > 60 * sw) bigInk += n;
    }
    for (let i = 0; i < N; i++) if (bm[i] === 2) bm[i] = 1;
    // long straight runs
    let longInk = 0;
    const minRun = Math.max(40, 25 * sw);
    for (let y = 1; y < H - 1; y++) {
      const o = y * W; let r = 0;
      for (let x = 1; x < W; x++) { if (bm[o + x]) r++; else { if (r >= minRun) longInk += r; r = 0; } }
    }
    const col = new Int32Array(W);
    for (let y = 1; y < H; y++) {
      const o = y * W;
      for (let x = 1; x < W - 1; x++) { if (bm[o + x]) col[x]++; else { if (col[x] >= minRun) longInk += col[x]; col[x] = 0; } }
    }
    let solid = 0;
    const m = thickMask(bm, W, H, Math.max(2, Math.round(sw * 1.1)));
    if (m) for (let i = 0; i < N; i++) solid += m[i];
    const mp = (W - 2) * (H - 2) / 1e6;
    return { sw, ink, inkFrac: ink / N, specksPerMp: specks / mp, letters, letterFrac: ink ? letterInk / ink : 0,
      lineFrac: ink ? Math.min(1, longInk / (ink / Math.max(1, sw))) : 0, solidFrac: ink ? solid / ink : 0, bigFrac: ink ? bigInk / ink : 0, comps };
  }

  // ---------- symbol search (normalized cross-correlation on an ink-density pyramid) ----------
  function density(bm, W, H, f) {
    const w = Math.floor((W - 2) / f), h = Math.floor((H - 2) / f), out = new Uint8Array(w * h), k = 255 / (f * f);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0;
        for (let yy = 0; yy < f; yy++) { const o = (y * f + yy + 1) * W + x * f + 1; for (let xx = 0; xx < f; xx++) s += bm[o + xx]; }
        out[y * w + x] = Math.round(s * k);
      }
    }
    return { d: out, w, h };
  }
  function crop(img, x, y, w, h) {
    const t = new Float64Array(w * h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const X = x + i, Y = y + j;
      t[j * w + i] = X >= 0 && Y >= 0 && X < img.w && Y < img.h ? img.d[Y * img.w + X] : 0;
    }
    return { t, w, h };
  }
  function rot90(T) {   // clockwise
    const w = T.h, h = T.w, t = new Float64Array(w * h);
    for (let y = 0; y < T.h; y++) for (let x = 0; x < T.w; x++) t[x * w + (w - 1 - y)] = T.t[y * T.w + x];
    return { t, w, h };
  }
  function prepT(T) {
    let s = 0; for (const v of T.t) s += v;
    const mean = s / T.t.length; let q = 0;
    const z = new Float64Array(T.t.length);
    for (let i = 0; i < z.length; i++) { z[i] = T.t[i] - mean; q += z[i] * z[i]; }
    return { z, w: T.w, h: T.h, sum: s, norm: Math.sqrt(q) };
  }
  function ncc(img, P, x, y) {
    let si = 0, sii = 0, c = 0;
    const w = P.w, h = P.h, d = img.d, iw = img.w;
    for (let j = 0; j < h; j++) {
      const o = (y + j) * iw + x, oz = j * w;
      for (let i = 0; i < w; i++) { const v = d[o + i]; si += v; sii += v * v; c += v * P.z[oz + i]; }
    }
    const n = w * h, varI = sii - si * si / n;
    if (varI <= 1e-9 || P.norm <= 1e-9) return 0;
    return c / (Math.sqrt(varI) * P.norm);
  }
  function findSymbol(bm, W, H, box, o, say) {
    const bw = Math.max(4, Math.round(box.w)), bh = Math.max(4, Math.round(box.h));
    const big = Math.max(bw, bh);
    const fb = Math.max(1, Math.round(big / 28)), fa = fb * 2;
    const thr = o.threshold || 0.7, rots = o.rotate === false ? [0] : [0, 1, 2, 3];
    say && say('Pripravujem hľadanie značky…');
    const A = density(bm, W, H, fa), B = density(bm, W, H, fb);
    const ta0 = crop(A, Math.round(box.x / fa), Math.round(box.y / fa), Math.max(2, Math.round(bw / fa)), Math.max(2, Math.round(bh / fa)));
    const tb0 = crop(B, Math.round(box.x / fb), Math.round(box.y / fb), Math.max(3, Math.round(bw / fb)), Math.max(3, Math.round(bh / fb)));
    // integral of level A for the ink-sum prefilter
    const II = new Float64Array((A.w + 1) * (A.h + 1)), iw = A.w + 1;
    for (let y = 0; y < A.h; y++) { let r = 0; for (let x = 0; x < A.w; x++) { r += A.d[y * A.w + x]; II[(y + 1) * iw + x + 1] = II[y * iw + x + 1] + r; } }
    const cands = [];
    let ta = ta0, tb = tb0;
    for (let rot = 0; rot < 4; rot++) {
      if (rot) { ta = rot90(ta); tb = rot90(tb); }
      if (rots.indexOf(rot) < 0) continue;
      say && say('Hľadám značku (otočenie ' + rot * 90 + '°)…');
      const PA = prepT(ta), PB = prepT(tb);
      const lo = PA.sum * 0.6, hi = PA.sum * 1.45, coarse = Math.max(0.35, thr - 0.3);
      const sc = new Float32Array(A.w * A.h);
      for (let y = 0; y + PA.h <= A.h; y++) {
        for (let x = 0; x + PA.w <= A.w; x++) {
          const s = II[(y + PA.h) * iw + x + PA.w] - II[y * iw + x + PA.w] - II[(y + PA.h) * iw + x] + II[y * iw + x];
          if (s < lo || s > hi) continue;
          sc[y * A.w + x] = ncc(A, PA, x, y);
        }
      }
      for (let y = 0; y + PA.h <= A.h; y++) for (let x = 0; x + PA.w <= A.w; x++) {
        const v = sc[y * A.w + x];
        if (v < coarse) continue;
        let peak = true;
        for (let dy = -1; dy <= 1 && peak; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const X = x + dx, Y = y + dy;
          if (X >= 0 && Y >= 0 && X < A.w && Y < A.h && sc[Y * A.w + X] > v) { peak = false; break; }
        }
        if (!peak) continue;
        // refine on level B
        let best = -1, bx = 0, by = 0;
        for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
          const X = x * 2 + dx, Y = y * 2 + dy;
          if (X < 0 || Y < 0 || X + PB.w > B.w || Y + PB.h > B.h) continue;
          const v2 = ncc(B, PB, X, Y);
          if (v2 > best) { best = v2; bx = X; by = Y; }
        }
        if (best >= thr) cands.push({ x: bx * fb, y: by * fb, w: PB.w * fb, h: PB.h * fb, rot, score: best });
      }
    }
    // non-maximum suppression
    cands.sort((a, b) => b.score - a.score);
    const out = [];
    for (const c of cands) {
      let ok = true;
      for (const k of out) {
        const ix = Math.max(0, Math.min(c.x + c.w, k.x + k.w) - Math.max(c.x, k.x));
        const iy = Math.max(0, Math.min(c.y + c.h, k.y + k.h) - Math.max(c.y, k.y));
        if (ix * iy > 0.3 * Math.min(c.w * c.h, k.w * k.h)) { ok = false; break; }
      }
      if (ok) out.push(c);
    }
    return { matches: out, fa, fb };
  }

  /**
   * bm: padded bitmap (W*H, ink=1); opts: { mode: 'center'|'outline', turd, eps, keepFills, prune }
   */
  function vectorize(bm, W, H, opts, progress) {
    const t0 = Date.now();
    const say = progress || function () {};
    const fills = new Store(), lines = new Store();
    say('Čistím škvrny…');
    const removed = despeckle(bm, W, H, opts.turd | 0);
    let textErased = 0;
    if (opts.textBoxes && opts.textBoxes.length) textErased = eraseText(bm, W, H, opts.textBoxes);
    fillHoles(bm, W, H, Math.max(opts.turd | 0, 4));
    const sw = strokeWidth(bm, W, H);
    let length = 0, drawW = sw;
    if (opts.mode === 'outline') {
      say('Sledujem obrysy…');
      traceOutlines(bm, W, H, 2, opts.eps, fills);
    } else {
      if (opts.keepFills) {
        say('Hľadám plné plochy…');
        const kk = Math.max(2, Math.round(sw * 1.1));
        const mask = thickMask(bm, W, H, kk);
        if (mask) {
          growFills(bm, mask, W, H, sw, 3 * (2 * kk + 1));
          absorbSmall(bm, mask, W, H, Math.max(12, Math.round(3 * sw * sw + 4 * sw)));
          for (let i = 0, N = W * H; i < N; i++) if (mask[i]) bm[i] = 0;
          traceOutlines(mask, W, H, 2, Math.min(opts.eps, 0.8), fills);
        }
      }
      say('Stenčujem čiary na osi…');
      const sk = thin(bm, W, H);
      say('Skladám čiary…');
      const g = skeletonGraph(bm, W, sk.list, sk.n, !opts.prune ? 0 : opts.spurLen > 0 ? Math.round(opts.spurLen) : Math.max(3, Math.round(sw * 1.6)));
      length = polysToStore(g.polys, g.dots, W, opts.eps * 1.05, lines, bm, opts.ortho ? Math.ceil(sw * 0.9) + 1 : 0);
      if (length > 0) drawW = Math.max(1, Math.min(sw, sk.ink / length));
    }
    let f = fills.pack(), l = lines.pack(), skew = 0, snapped = 0;
    if (opts.deskew || opts.ortho) {
      say('Rovnám čiary…');
      const st = straighten(l, f, { deskew: opts.deskew, ortho: opts.ortho, sw, cx: (W - 2) / 2, cy: (H - 2) / 2, forceSkew: opts.forceSkew, tol: opts.orthoTol, snapR: opts.snapR });
      l = st.lines; f = st.fills; skew = st.skew; snapped = st.snapped;
    }
    return {
      w: W - 2, h: H - 2, sw: drawW, medianW: sw, removed: removed, length: length, ms: Date.now() - t0,
      skew: skew, cx: (W - 2) / 2, cy: (H - 2) / 2, snapped: snapped, textErased: textErased,
      fillsData: f.data, fillsOff: f.off,
      linesData: l.data, linesOff: l.off, linesClosed: l.closed
    };
  }

  return { vectorize: vectorize, otsu: otsu, analyze: analyze, findSymbol: findSymbol };
}
if (typeof module !== 'undefined') module.exports = VecCore;
