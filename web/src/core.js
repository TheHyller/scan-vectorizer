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
    this.closed = new Uint8Array(1 << 12);
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
    }
    this.closed[this.m] = closed ? 1 : 0;
    this.off[++this.m] = this.n >> 1;
  };
  Store.prototype.pack = function () {
    return { data: this.data.slice(0, this.n), off: this.off.slice(0, this.m + 1), closed: this.closed.slice(0, this.m) };
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

  // Trace boundaries of ink (8-connected) into closed polygons on pixel edges.
  // Mutates bm (visited left edges become 3).
  function traceOutlines(bm, W, H, minArea, eps, store) {
    const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
    let cap = 1 << 12, xs = new Float64Array(cap), ys = new Float64Array(cap);
    let keep = new Uint8Array(cap), stack = new Int32Array(cap * 2 + 8);
    let count = 0;
    for (let y = 1; y < H - 1; y++) {
      const o = y * W;
      for (let x = 1; x < W - 1; x++) {
        if (bm[o + x] !== 1 || bm[o + x - 1]) continue;
        let vx = x, vy = y + 1, d = 0, n = 0;
        do {
          if (d === 0) bm[(vy - 1) * W + vx] = 3;
          vx += DX[d]; vy += DY[d];
          const p = vy * W + vx;
          const NW = bm[p - W - 1], NE = bm[p - W], SW = bm[p - 1], SE = bm[p];
          let AL, AR;
          if (d === 0) { AL = NW; AR = NE; } else if (d === 1) { AL = NE; AR = SE; }
          else if (d === 2) { AL = SE; AR = SW; } else { AL = SW; AR = NW; }
          const nd = AL ? (d + 3) & 3 : AR ? d : (d + 1) & 3;
          if (nd !== d) {
            if (n === cap) {
              cap *= 2;
              const a = new Float64Array(cap); a.set(xs); xs = a;
              const b = new Float64Array(cap); b.set(ys); ys = b;
              keep = new Uint8Array(cap); stack = new Int32Array(cap * 2 + 8);
            }
            xs[n] = vx - 1; ys[n] = vy - 1; n++;   // -1 removes the padding
            d = nd;
          }
        } while (!(vx === x && vy === y + 1 && d === 0));
        if (n < 4) continue;
        let area = 0;
        for (let i = 0, j = n - 1; i < n; j = i++) area += xs[j] * ys[i] - xs[i] * ys[j];
        if (Math.abs(area) / 2 < minArea) continue;
        // closed DP: split at the point farthest from point 0
        let far = 0, fd = -1;
        for (let i = 1; i < n; i++) {
          const dd = (xs[i] - xs[0]) * (xs[i] - xs[0]) + (ys[i] - ys[0]) * (ys[i] - ys[0]);
          if (dd > fd) { fd = dd; far = i; }
        }
        keep.fill(0, 0, n + 1);
        xs[n] = xs[0]; ys[n] = ys[0];
        dp(xs, ys, 0, far, eps, keep, stack);
        dp(xs, ys, far, n, eps, keep, stack);
        let kept = 0;
        for (let i = 0; i < n; i++) if (keep[i]) kept++;
        if (kept < 3) continue;
        for (let i = 0; i < n; i++) if (keep[i]) store.push(xs[i], ys[i]);
        store.end(true);
        count++;
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

  // Pixel chains -> smoothed, simplified polylines. Corners and end nodes stay fixed,
  // everything between is averaged so scan jitter does not turn into wobble.
  function polysToStore(polys, dots, W, eps, store) {
    let cap = 1 << 12, rx, ry, xs, ys, keep, stack, fix;
    const alloc = () => {
      rx = new Float64Array(cap); ry = new Float64Array(cap); xs = new Float64Array(cap); ys = new Float64Array(cap);
      keep = new Uint8Array(cap); stack = new Int32Array(cap * 2 + 8); fix = new Uint8Array(cap);
    };
    alloc();
    const K = 4, COS = Math.cos(50 * Math.PI / 180), WT = [3, 2, 1];
    let len = 0;
    for (const pl of polys) {
      if (pl.dead) continue;
      const pts = pl.pts, n0 = pts.length, n = pl.closed ? n0 + 1 : n0;
      if (n + 1 > cap) { while (cap < n + 1) cap *= 2; alloc(); }
      for (let i = 0; i < n0; i++) { const p = pts[i]; rx[i] = (p % W) - 0.5; ry[i] = ((p / W) | 0) - 0.5; }
      if (pl.closed) { rx[n0] = rx[0]; ry[n0] = ry[0]; }
      fix.fill(0, 0, n); fix[0] = 1; fix[n - 1] = 1;
      for (let i = K; i < n - K; i++) {
        const ax = rx[i] - rx[i - K], ay = ry[i] - ry[i - K], bx = rx[i + K] - rx[i], by = ry[i + K] - ry[i];
        const d = Math.sqrt((ax * ax + ay * ay) * (bx * bx + by * by));
        if (d > 0 && (ax * bx + ay * by) / d < COS) fix[i] = 1;
      }
      let prevFix = 0, nextFix = 0;
      for (let i = 0; i < n; i++) {
        if (fix[i]) { xs[i] = rx[i]; ys[i] = ry[i]; prevFix = i; continue; }
        if (nextFix <= i) { nextFix = i + 1; while (!fix[nextFix]) nextFix++; }
        const r = Math.min(2, i - prevFix, nextFix - i);
        let sx = 0, sy = 0, sw = 0;
        for (let k = -r; k <= r; k++) { const w = WT[k < 0 ? -k : k]; sx += w * rx[i + k]; sy += w * ry[i + k]; sw += w; }
        xs[i] = sx / sw; ys[i] = sy / sw;
      }
      keep.fill(0, 0, n);
      if (pl.closed) {
        const mid = n0 >> 1;
        dp(xs, ys, 0, mid, eps, keep, stack); dp(xs, ys, mid, n0, eps, keep, stack);
        keep[n0] = 0;
      } else dp(xs, ys, 0, n - 1, eps, keep, stack);
      let px = 0, py = 0, first = true, fx = 0, fy = 0;
      for (let i = 0; i < n; i++) {
        if (!keep[i]) continue;
        store.push(xs[i], ys[i]);
        if (first) { first = false; fx = xs[i]; fy = ys[i]; } else len += Math.hypot(xs[i] - px, ys[i] - py);
        px = xs[i]; py = ys[i];
      }
      if (pl.closed) len += Math.hypot(fx - px, fy - py);
      store.end(pl.closed);
    }
    for (const p of dots) {
      const x = (p % W) - 0.5, y = ((p / W) | 0) - 0.5;
      store.push(x, y); store.push(x + 0.01, y); store.end(false);
    }
    return len;
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
    fillHoles(bm, W, H, Math.max(opts.turd | 0, 4));
    const sw = strokeWidth(bm, W, H);
    let length = 0, drawW = sw;
    if (opts.mode === 'outline') {
      say('Sledujem obrysy…');
      traceOutlines(bm, W, H, 2, opts.eps, fills);
    } else {
      if (opts.keepFills) {
        say('Hľadám plné plochy…');
        const mask = thickMask(bm, W, H, Math.max(2, Math.round(sw * 1.1)));
        if (mask) {
          for (let i = 0, N = W * H; i < N; i++) if (mask[i]) bm[i] = 0;
          traceOutlines(mask, W, H, 2, Math.min(opts.eps, 0.8), fills);
        }
      }
      say('Stenčujem čiary na osi…');
      const sk = thin(bm, W, H);
      say('Skladám čiary…');
      const g = skeletonGraph(bm, W, sk.list, sk.n, opts.prune ? Math.max(3, Math.round(sw * 1.6)) : 0);
      length = polysToStore(g.polys, g.dots, W, opts.eps * 0.6, lines);
      if (length > 0) drawW = Math.max(1, Math.min(sw, sk.ink / length));
    }
    const f = fills.pack(), l = lines.pack();
    return {
      w: W - 2, h: H - 2, sw: drawW, medianW: sw, removed: removed, length: length, ms: Date.now() - t0,
      fillsData: f.data, fillsOff: f.off,
      linesData: l.data, linesOff: l.off, linesClosed: l.closed
    };
  }

  return { vectorize: vectorize, otsu: otsu };
}
if (typeof module !== 'undefined') module.exports = VecCore;
