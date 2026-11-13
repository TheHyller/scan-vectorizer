// Export writers. res = result of VecCore().vectorize plus { dpi }.
const VecExport = (function () {
  'use strict';
  const r1 = v => Math.round(v * 10) / 10;

  function eachPoly(data, off, fn) {
    for (let i = 0; i + 1 < off.length; i++) fn(off[i], off[i + 1], i);
  }

  // Returns path data in chunks (very long single attributes break some SVG readers).
  function pathD(data, off, closedArr, allClosed) {
    const chunks = [];
    let out = [], size = 0;
    eachPoly(data, off, (s, e, i) => {
      if (size > 400000) { chunks.push(out.join('')); out = []; size = 0; }
      let str = 'M' + r1(data[2 * s]) + ' ' + r1(data[2 * s + 1]);
      for (let k = s + 1; k < e; k++) str += ' ' + r1(data[2 * k]) + ' ' + r1(data[2 * k + 1]);
      if (allClosed || (closedArr && closedArr[i])) str += 'Z';
      out.push(str); size += str.length;
    });
    if (out.length) chunks.push(out.join(''));
    return chunks;
  }

  function svg(res) {
    const mmW = (res.w * 25.4 / res.dpi).toFixed(2), mmH = (res.h * 25.4 / res.dpi).toFixed(2);
    let s = '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="' + mmW + 'mm" height="' + mmH +
      'mm" viewBox="0 0 ' + res.w + ' ' + res.h + '">\n';
    if (res.fillsOff.length > 1)
      s += '<g id="plochy" fill="#000" fill-rule="evenodd">\n' +
        pathD(res.fillsData, res.fillsOff, null, true).map(d => '<path d="' + d + '"/>').join('\n') + '\n</g>\n';
    if (res.linesOff.length > 1)
      s += '<g id="osi" fill="none" stroke="#000" stroke-width="' + r1(res.sw) + '" stroke-linecap="round" stroke-linejoin="round">\n' +
        pathD(res.linesData, res.linesOff, res.linesClosed, false).map(d => '<path d="' + d + '"/>').join('\n') + '\n</g>\n';
    return s + '</svg>\n';
  }

  // ASCII DXF, R12 (AC1009): opens in AutoCAD, ZWCAD, DDS-CAD, LibreCAD. Units: mm, Y up.
  function dxf(res, scale) {
    const k = 25.4 / res.dpi * (scale || 1), h = res.h;
    const X = v => (v * k).toFixed(3), Y = v => ((h - v) * k).toFixed(3);
    const o = [];
    const layers = [];
    if (res.linesOff.length > 1) layers.push(['OSI', 7]);
    if (res.fillsOff.length > 1) layers.push([res.linesOff.length > 1 ? 'PLOCHY' : 'OBRYS', res.linesOff.length > 1 ? 8 : 7]);
    if (!layers.length) layers.push(['OSI', 7]);
    o.push('0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1009\n9\n$INSBASE\n10\n0.0\n20\n0.0\n30\n0.0\n' +
      '9\n$EXTMIN\n10\n0.0\n20\n0.0\n30\n0.0\n9\n$EXTMAX\n10\n' + X(res.w) + '\n20\n' + (h * k).toFixed(3) + '\n30\n0.0\n' +
      '9\n$LIMMIN\n10\n0.0\n20\n0.0\n9\n$LIMMAX\n10\n' + X(res.w) + '\n20\n' + (h * k).toFixed(3) + '\n0\nENDSEC\n');
    o.push('0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLTYPE\n70\n1\n0\nLTYPE\n2\nCONTINUOUS\n70\n0\n3\nSolid line\n72\n65\n73\n0\n40\n0.0\n0\nENDTAB\n' +
      '0\nTABLE\n2\nLAYER\n70\n' + layers.length + '\n');
    for (const [name, color] of layers) o.push('0\nLAYER\n2\n' + name + '\n70\n0\n62\n' + color + '\n6\nCONTINUOUS\n');
    o.push('0\nENDTAB\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n');
    function emit(data, off, closedArr, allClosed, layer) {
      eachPoly(data, off, (s, e, i) => {
        const closed = allClosed || (closedArr && closedArr[i]);
        if (e - s === 2 && !closed) {
          o.push('0\nLINE\n8\n' + layer + '\n10\n' + X(data[2 * s]) + '\n20\n' + Y(data[2 * s + 1]) + '\n30\n0.0\n11\n' +
            X(data[2 * s + 2]) + '\n21\n' + Y(data[2 * s + 3]) + '\n31\n0.0\n');
          return;
        }
        let str = '0\nPOLYLINE\n8\n' + layer + '\n66\n1\n10\n0.0\n20\n0.0\n30\n0.0\n70\n' + (closed ? 1 : 0) + '\n';
        for (let p = s; p < e; p++) str += '0\nVERTEX\n8\n' + layer + '\n10\n' + X(data[2 * p]) + '\n20\n' + Y(data[2 * p + 1]) + '\n30\n0.0\n';
        o.push(str + '0\nSEQEND\n8\n' + layer + '\n');
      });
    }
    if (res.linesOff.length > 1) emit(res.linesData, res.linesOff, res.linesClosed, false, 'OSI');
    if (res.fillsOff.length > 1) emit(res.fillsData, res.fillsOff, null, true, layers[layers.length - 1][0]);
    o.push('0\nENDSEC\n0\nEOF\n');
    return o.join('');
  }

  async function pipe(bytes, format) {
    if (typeof CompressionStream === 'undefined') return null;
    try {
      const cs = new CompressionStream(format);
      const w = cs.writable.getWriter();
      w.write(bytes); w.close();
      return new Uint8Array(await new Response(cs.readable).arrayBuffer());
    } catch (e) { return null; }
  }

  async function pdf(res) {
    const enc = new TextEncoder();
    const s = 72 / res.dpi, pw = (res.w * s).toFixed(2), ph = (res.h * s).toFixed(2);
    const c = [s.toFixed(6) + ' 0 0 ' + (-s).toFixed(6) + ' 0 ' + ph + ' cm\n0 g 0 G\n'];
    function emit(data, off, closedArr, allClosed) {
      eachPoly(data, off, (a, e, i) => {
        let str = r1(data[2 * a]) + ' ' + r1(data[2 * a + 1]) + ' m\n';
        for (let p = a + 1; p < e; p++) str += r1(data[2 * p]) + ' ' + r1(data[2 * p + 1]) + ' l\n';
        if (allClosed || (closedArr && closedArr[i])) str += 'h\n';
        c.push(str);
      });
    }
    if (res.fillsOff.length > 1) { emit(res.fillsData, res.fillsOff, null, true); c.push('f*\n'); }
    if (res.linesOff.length > 1) {
      c.push(r1(res.sw) + ' w 1 J 1 j\n');
      emit(res.linesData, res.linesOff, res.linesClosed, false); c.push('S\n');
    }
    const raw = enc.encode(c.join(''));
    const z = await pipe(raw, 'deflate');
    const stream = z || raw;
    const parts = [], offs = [];
    let pos = 0;
    const put = x => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); pos += b.length; };
    put('%PDF-1.4\n%âãÏÓ\n');
    const obj = (n, body) => { offs[n] = pos; put(n + ' 0 obj\n' + body + '\nendobj\n'); };
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + pw + ' ' + ph + '] /Resources << >> /Contents 4 0 R >>');
    offs[4] = pos;
    put('4 0 obj\n<< /Length ' + stream.length + (z ? ' /Filter /FlateDecode' : '') + ' >>\nstream\n');
    put(stream); put('\nendstream\nendobj\n');
    const xref = pos;
    let x = 'xref\n0 5\n0000000000 65535 f \n';
    for (let n = 1; n <= 4; n++) x += String(offs[n]).padStart(10, '0') + ' 00000 n \n';
    put(x + 'trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
    const out = new Uint8Array(pos);
    let q = 0;
    for (const b of parts) { out.set(b, q); q += b.length; }
    return out;
  }

  let crcT = null;
  function crc32(b) {
    if (!crcT) {
      crcT = new Uint32Array(256);
      for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
    }
    let c = 0xFFFFFFFF;
    for (let i = 0; i < b.length; i++) c = crcT[(c ^ b[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  // One-file ZIP (deflate when the browser can, otherwise stored).
  async function zip(name, bytes) {
    const z = await pipe(bytes, 'deflate-raw');
    const body = z || bytes, method = z ? 8 : 0, nm = new TextEncoder().encode(name), crc = crc32(bytes);
    const out = new Uint8Array(30 + nm.length + body.length + 46 + nm.length + 22), dv = new DataView(out.buffer);
    let p = 0;
    const head = central => {
      dv.setUint32(p, central ? 0x02014b50 : 0x04034b50, true); p += 4;
      if (central) { dv.setUint16(p, 20, true); p += 2; }
      dv.setUint16(p, 20, true); dv.setUint16(p + 2, 0x0800, true); dv.setUint16(p + 4, method, true);
      dv.setUint16(p + 6, 0, true); dv.setUint16(p + 8, 0x21, true);
      dv.setUint32(p + 10, crc, true); dv.setUint32(p + 14, body.length, true); dv.setUint32(p + 18, bytes.length, true);
      dv.setUint16(p + 22, nm.length, true); dv.setUint16(p + 24, 0, true); p += 26;
      if (central) { p += 10; dv.setUint32(p, 0, true); p += 4; }
      out.set(nm, p); p += nm.length;
    };
    head(false); out.set(body, p); p += body.length;
    const cd = p; head(true);
    const cdLen = p - cd;
    dv.setUint32(p, 0x06054b50, true); dv.setUint16(p + 8, 1, true); dv.setUint16(p + 10, 1, true);
    dv.setUint32(p + 12, cdLen, true); dv.setUint32(p + 16, cd, true);
    return out;
  }

  return { svg: svg, dxf: dxf, pdf: pdf, zip: zip };
})();
if (typeof module !== 'undefined') module.exports = VecExport;
