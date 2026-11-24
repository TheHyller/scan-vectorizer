// Export writers. res = result of VecCore().vectorize plus { dpi }.
// ann (optional) = annotations in the same pixel space as res (y down):
//   texts:  [{ x, y, w, h, rot, str }]  baseline start, baseline length, cap height, rotation in degrees (CCW)
//   textVisible: true -> text replaces the letter shapes (drawn); false -> hidden/searchable only
//   blocks: [{ name, lines: [{ pts:[x,y,...], closed }], fills: [[x,y,...]], inserts: [{ x, y, rot }] }]  (DXF only)
//   skipLines / skipFills: Uint8Array per polyline, 1 = replaced by a block insert (DXF only)
//   layerNames: { lines, fills, outline, text, textOcr, symbols } (DXF layer names, defaults are Slovak)
// Colour layers: res.colors = [{ layer, fillLayer, rgb: [r, g, b], aci, sw }], res.linesColor / res.fillsColor
//   hold the colour index of every polyline.
const VecExport = (function () {
  'use strict';
  const r1 = v => Math.round(v * 10) / 10;
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function eachPoly(data, off, fn) {
    for (let i = 0; i + 1 < off.length; i++) fn(off[i], off[i + 1], i);
  }

  // Returns path data in chunks (very long single attributes break some SVG readers).
  function pathD(data, off, closedArr, allClosed, keep) {
    const chunks = [];
    let out = [], size = 0;
    eachPoly(data, off, (s, e, i) => {
      if (keep && !keep(i)) return;
      if (size > 400000) { chunks.push(out.join('')); out = []; size = 0; }
      let str = 'M' + r1(data[2 * s]) + ' ' + r1(data[2 * s + 1]);
      for (let k = s + 1; k < e; k++) str += ' ' + r1(data[2 * k]) + ' ' + r1(data[2 * k + 1]);
      if (allClosed || (closedArr && closedArr[i])) str += 'Z';
      out.push(str); size += str.length;
    });
    if (out.length) chunks.push(out.join(''));
    return chunks;
  }

  function svg(res, ann) {
    const mmW = (res.w * 25.4 / res.dpi).toFixed(2), mmH = (res.h * 25.4 / res.dpi).toFixed(2);
    let s = '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="' + mmW + 'mm" height="' + mmH +
      'mm" viewBox="0 0 ' + res.w + ' ' + res.h + '">\n';
    const cols = res.colors && res.colors.length ? res.colors : [{ layer: 'osi', fillLayer: 'plochy', rgb: [0, 0, 0], sw: res.sw }];
    const hex = c => '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
    cols.forEach((col, ci) => {
      const kf = res.fillsColor ? i => res.fillsColor[i] === ci : null, kl = res.linesColor ? i => res.linesColor[i] === ci : null;
      const fd = res.fillsOff.length > 1 ? pathD(res.fillsData, res.fillsOff, null, true, kf) : [];
      const ld = res.linesOff.length > 1 ? pathD(res.linesData, res.linesOff, res.linesClosed, false, kl) : [];
      if (fd.length) s += '<g id="' + esc(col.fillLayer) + '" fill="' + hex(col.rgb) + '" fill-rule="evenodd">\n' + fd.map(d => '<path d="' + d + '"/>').join('\n') + '\n</g>\n';
      if (ld.length) s += '<g id="' + esc(col.layer) + '" fill="none" stroke="' + hex(col.rgb) + '" stroke-width="' + r1(col.sw || res.sw) +
        '" stroke-linecap="round" stroke-linejoin="round">\n' + ld.map(d => '<path d="' + d + '"/>').join('\n') + '\n</g>\n';
    });
    if (ann && ann.texts && ann.texts.length && ann.textVisible) {
      s += '<g id="text" font-family="Arial, Helvetica, sans-serif" fill="#000">\n';
      for (const t of ann.texts) {
        const fs = r1(t.h / 0.716), tr = t.rot ? ' transform="rotate(' + r1(-t.rot) + ' ' + r1(t.x) + ' ' + r1(t.y) + ')"' : '';
        s += '<text x="' + r1(t.x) + '" y="' + r1(t.y) + '" font-size="' + fs + '" textLength="' + r1(t.w) +
          '" lengthAdjust="spacingAndGlyphs"' + tr + '>' + esc(t.str) + '</text>\n';
      }
      s += '</g>\n';
    }
    return s + '</svg>\n';
  }

  // DXF strings stay ASCII: other characters become \U+XXXX (read by AutoCAD, ZWCAD, LibreCAD).
  function dxfStr(s) {
    let o = '';
    for (const ch of s) {
      const c = ch.codePointAt(0);
      o += c >= 32 && c < 127 ? ch : c > 0xFFFF ? '?' : '\\U+' + c.toString(16).toUpperCase().padStart(4, '0');
    }
    return o;
  }
  function blockName(s) {
    const b = s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
    return (b || 'ZNACKA').slice(0, 31);
  }

  // ASCII DXF, R12 (AC1009): opens in AutoCAD, ZWCAD, DDS-CAD, LibreCAD. Units: mm, Y up.
  function dxf(res, scale, ann) {
    ann = ann || {};
    const k = 25.4 / res.dpi * (scale || 1), h = res.h;
    const X = v => (v * k).toFixed(3), Y = v => ((h - v) * k).toFixed(3);
    const o = [];
    const N = Object.assign({ lines: 'OSI', fills: 'PLOCHY', outline: 'OBRYS', text: 'TEXT', textOcr: 'TEXT-OCR', symbols: 'ZNACKY' }, ann.layerNames || {});
    const layers = [];
    const hasL = res.linesOff.length > 1, hasF = res.fillsOff.length > 1;
    let lineLayer = () => N.lines, fillLayer = () => hasL ? N.fills : N.outline;
    if (res.colors && res.colors.length) {
      const seen = new Set();
      const add = (n, c) => { if (!seen.has(n)) { seen.add(n); layers.push([n, c]); } };
      res.colors.forEach((c, ci) => {
        if (hasL && res.linesColor.some(v => v === ci)) add(c.layer, c.aci);
        if (hasF && res.fillsColor.some(v => v === ci)) add(hasL ? c.fillLayer : c.layer, c.aci);
      });
      lineLayer = i => res.colors[res.linesColor[i]].layer;
      fillLayer = i => hasL ? res.colors[res.fillsColor[i]].fillLayer : res.colors[res.fillsColor[i]].layer;
    } else {
      if (hasL) layers.push([N.lines, 7]);
      if (hasF) layers.push([hasL ? N.fills : N.outline, hasL ? 8 : 7]);
    }
    if (!layers.length) layers.push([N.lines, 7]);
    const texts = ann.texts || [], textLayer = ann.textVisible ? N.text : N.textOcr;
    if (texts.length) layers.push([textLayer, ann.textVisible ? 7 : -3]);       // hidden OCR layer is switched off
    const blocks = (ann.blocks || []).filter(b => b.inserts && b.inserts.length);
    if (blocks.length) layers.push([N.symbols, 1]);
    o.push('0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1009\n9\n$INSBASE\n10\n0.0\n20\n0.0\n30\n0.0\n' +
      '9\n$EXTMIN\n10\n0.0\n20\n0.0\n30\n0.0\n9\n$EXTMAX\n10\n' + X(res.w) + '\n20\n' + (h * k).toFixed(3) + '\n30\n0.0\n' +
      '9\n$LIMMIN\n10\n0.0\n20\n0.0\n9\n$LIMMAX\n10\n' + X(res.w) + '\n20\n' + (h * k).toFixed(3) + '\n0\nENDSEC\n');
    o.push('0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLTYPE\n70\n1\n0\nLTYPE\n2\nCONTINUOUS\n70\n0\n3\nSolid line\n72\n65\n73\n0\n40\n0.0\n0\nENDTAB\n' +
      '0\nTABLE\n2\nLAYER\n70\n' + (layers.length + 1) + '\n0\nLAYER\n2\n0\n70\n0\n62\n7\n6\nCONTINUOUS\n');
    for (const [name, color] of layers) o.push('0\nLAYER\n2\n' + name + '\n70\n0\n62\n' + color + '\n6\nCONTINUOUS\n');
    o.push('0\nENDTAB\n0\nTABLE\n2\nSTYLE\n70\n1\n0\nSTYLE\n2\nSTANDARD\n70\n0\n40\n0.0\n41\n1.0\n50\n0.0\n71\n0\n42\n2.5\n3\ntxt\n4\n\n0\nENDTAB\n0\nENDSEC\n');

    function poly(layer, pts, closed, PX, PY) {
      const n = pts.length >> 1;
      if (n === 2 && !closed) {
        o.push('0\nLINE\n8\n' + layer + '\n10\n' + PX(pts[0]) + '\n20\n' + PY(pts[1]) + '\n30\n0.0\n11\n' +
          PX(pts[2]) + '\n21\n' + PY(pts[3]) + '\n31\n0.0\n');
        return;
      }
      let str = '0\nPOLYLINE\n8\n' + layer + '\n66\n1\n10\n0.0\n20\n0.0\n30\n0.0\n70\n' + (closed ? 1 : 0) + '\n';
      for (let p = 0; p < n; p++) str += '0\nVERTEX\n8\n' + layer + '\n10\n' + PX(pts[2 * p]) + '\n20\n' + PY(pts[2 * p + 1]) + '\n30\n0.0\n';
      o.push(str + '0\nSEQEND\n8\n' + layer + '\n');
    }

    // blocks for found symbols (geometry relative to the symbol centre)
    const names = new Set();
    if (blocks.length) {
      o.push('0\nSECTION\n2\nBLOCKS\n');
      for (const b of blocks) {
        let nm = blockName(b.name), i = 2;
        while (names.has(nm)) nm = blockName(b.name).slice(0, 27) + '_' + i++;
        names.add(nm); b._dxfName = nm;
        o.push('0\nBLOCK\n8\n0\n2\n' + nm + '\n70\n0\n10\n0.0\n20\n0.0\n30\n0.0\n3\n' + nm + '\n1\n\n');
        const BX = v => (v * k).toFixed(3), BY = v => (-v * k).toFixed(3);
        for (const l of b.lines || []) poly('0', l.pts, l.closed, BX, BY);
        for (const f of b.fills || []) poly('0', f, true, BX, BY);
        o.push('0\nENDBLK\n8\n0\n');
      }
      o.push('0\nENDSEC\n');
    }

    o.push('0\nSECTION\n2\nENTITIES\n');
    function emit(data, off, closedArr, allClosed, layerOf, skip) {
      eachPoly(data, off, (s, e, i) => {
        if (skip && skip[i]) return;
        poly(layerOf(i), data.subarray(2 * s, 2 * e), allClosed || (closedArr && closedArr[i]), X, Y);
      });
    }
    if (hasL) emit(res.linesData, res.linesOff, res.linesClosed, false, lineLayer, ann.skipLines);
    if (hasF) emit(res.fillsData, res.fillsOff, null, true, fillLayer, ann.skipFills);
    for (const t of texts) {
      const a = t.rot * Math.PI / 180, ex = t.x + Math.cos(a) * t.w, ey = t.y - Math.sin(a) * t.w;
      o.push('0\nTEXT\n8\n' + textLayer + '\n10\n' + X(t.x) + '\n20\n' + Y(t.y) + '\n30\n0.0\n40\n' + (t.h * k).toFixed(3) +
        '\n1\n' + dxfStr(t.str) + '\n50\n' + (t.rot || 0).toFixed(3) + '\n7\nSTANDARD\n72\n5\n11\n' + X(ex) + '\n21\n' + Y(ey) + '\n31\n0.0\n');
    }
    for (const b of blocks) for (const p of b.inserts)
      o.push('0\nINSERT\n8\n' + N.symbols + '\n2\n' + b._dxfName + '\n10\n' + X(p.x) + '\n20\n' + Y(p.y) + '\n30\n0.0\n41\n1.0\n42\n1.0\n50\n' + (p.rot || 0).toFixed(3) + '\n');
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

  // Helvetica (one of the PDF base fonts) with a custom encoding for Slovak, Czech and German letters.
  const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
    278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722,
    667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556,
    333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
  const GLYPH = {
    'á': 'aacute', 'ä': 'adieresis', 'č': 'ccaron', 'ď': 'dcaron', 'é': 'eacute', 'ě': 'ecaron', 'í': 'iacute', 'ĺ': 'lacute', 'ľ': 'lcaron',
    'ň': 'ncaron', 'ó': 'oacute', 'ô': 'ocircumflex', 'ö': 'odieresis', 'ŕ': 'racute', 'ř': 'rcaron', 'š': 'scaron', 'ť': 'tcaron', 'ú': 'uacute',
    'ů': 'uring', 'ü': 'udieresis', 'ý': 'yacute', 'ž': 'zcaron', 'ß': 'germandbls',
    'Á': 'Aacute', 'Ä': 'Adieresis', 'Č': 'Ccaron', 'Ď': 'Dcaron', 'É': 'Eacute', 'Ě': 'Ecaron', 'Í': 'Iacute', 'Ĺ': 'Lacute', 'Ľ': 'Lcaron',
    'Ň': 'Ncaron', 'Ó': 'Oacute', 'Ô': 'Ocircumflex', 'Ö': 'Odieresis', 'Ŕ': 'Racute', 'Ř': 'Rcaron', 'Š': 'Scaron', 'Ť': 'Tcaron', 'Ú': 'Uacute',
    'Ů': 'Uring', 'Ü': 'Udieresis', 'Ý': 'Yacute', 'Ž': 'Zcaron',
    '°': 'degree', '×': 'multiply', '±': 'plusminus', 'Ø': 'Oslash', 'ø': 'oslash', '⌀': 'Oslash', 'µ': 'mu', '²': 'twosuperior', '³': 'threesuperior',
    '§': 'section', '€': 'Euro', '–': 'endash', '—': 'emdash', '„': 'quotedblbase', '“': 'quotedblleft', '”': 'quotedblright', '‚': 'quotesinglbase',
    '‘': 'quoteleft', '’': 'quoteright', '½': 'onehalf', '¼': 'onequarter', '‰': 'perthousand', '·': 'periodcentered', '…': 'ellipsis'
  };
  function encodeText(texts) {
    const map = new Map(), diff = [];
    let next = 128;
    const width = ch => {
      const c = ch.charCodeAt(0);
      if (c >= 32 && c < 127) return HELV[c - 32];
      const base = ch.normalize('NFD')[0], b = base.charCodeAt(0);
      return b >= 32 && b < 127 ? HELV[b - 32] : 556;
    };
    const enc = s => {
      let out = '', w = 0;
      for (const ch of s) {
        const c = ch.codePointAt(0);
        let code;
        if (c >= 32 && c < 127) code = c;
        else if (map.has(ch)) code = map.get(ch);
        else if (GLYPH[ch] && next < 256) { code = next++; map.set(ch, code); diff.push(code + ' /' + GLYPH[ch]); }
        else code = 63;
        w += code === 63 && c !== 63 ? 556 : width(ch);
        out += code === 40 || code === 41 || code === 92 ? '\\' + String.fromCharCode(code)
          : code >= 128 ? '\\' + code.toString(8) : String.fromCharCode(code);
      }
      return { s: out, w };
    };
    const items = texts.map(t => Object.assign({ e: enc(t.str) }, t));
    return { items, diff };
  }

  async function pdf(res, ann) {
    const enc = new TextEncoder();
    const s = 72 / res.dpi, pw = (res.w * s).toFixed(2), ph = (res.h * s).toFixed(2);
    const c = [s.toFixed(6) + ' 0 0 ' + (-s).toFixed(6) + ' 0 ' + ph + ' cm\n0 g 0 G\n'];
    function emit(data, off, closedArr, allClosed, keep) {
      let n = 0;
      eachPoly(data, off, (a, e, i) => {
        if (keep && !keep(i)) return;
        n++;
        let str = r1(data[2 * a]) + ' ' + r1(data[2 * a + 1]) + ' m\n';
        for (let p = a + 1; p < e; p++) str += r1(data[2 * p]) + ' ' + r1(data[2 * p + 1]) + ' l\n';
        if (allClosed || (closedArr && closedArr[i])) str += 'h\n';
        c.push(str);
      });
      return n;
    }
    const cols = res.colors && res.colors.length ? res.colors : [{ rgb: [0, 0, 0], sw: res.sw }];
    cols.forEach((col, ci) => {
      const rgb = col.rgb.map(v => (v / 255).toFixed(3)).join(' ');
      c.push(rgb + ' rg ' + rgb + ' RG\n');
      const kf = res.fillsColor ? i => res.fillsColor[i] === ci : null, kl = res.linesColor ? i => res.linesColor[i] === ci : null;
      if (res.fillsOff.length > 1 && emit(res.fillsData, res.fillsOff, null, true, kf)) c.push('f*\n');
      if (res.linesOff.length > 1) {
        c.push(r1(col.sw || res.sw) + ' w 1 J 1 j\n');
        if (emit(res.linesData, res.linesOff, res.linesClosed, false, kl)) c.push('S\n');
      }
    });
    c.push('0 g 0 G\n');
    let font = null;
    if (ann && ann.texts && ann.texts.length) {
      const T = encodeText(ann.texts);
      font = T.diff;
      c.push('BT\n' + (ann.textVisible ? 0 : 3) + ' Tr\n');
      for (const t of T.items) {
        const fs = t.h / 0.718, a = t.rot * Math.PI / 180, co = Math.cos(a), si = Math.sin(a);
        const tz = t.e.w > 0 ? 100 * t.w / (t.e.w / 1000 * fs) : 100;
        c.push('/F1 ' + fs.toFixed(2) + ' Tf ' + tz.toFixed(1) + ' Tz ' + co.toFixed(4) + ' ' + (-si).toFixed(4) + ' ' + (-si).toFixed(4) + ' ' +
          (-co).toFixed(4) + ' ' + r1(t.x) + ' ' + r1(t.y) + ' Tm (' + t.e.s + ') Tj\n');
      }
      c.push('ET\n');
    }
    const raw = enc.encode(c.join(''));
    const z = await pipe(raw, 'deflate');
    const stream = z || raw;
    const parts = [], offs = [];
    let pos = 0;
    const put = x => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); pos += b.length; };
    put('%PDF-1.4\n%âãÏÓ\n');
    const obj = (n, body) => { offs[n] = pos; put(n + ' 0 obj\n' + body + '\nendobj\n'); };
    const nObj = font ? 5 : 4;
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + pw + ' ' + ph + '] /Resources << ' + (font ? '/Font << /F1 5 0 R >> ' : '') +
      '>> /Contents 4 0 R >>');
    offs[4] = pos;
    put('4 0 obj\n<< /Length ' + stream.length + (z ? ' /Filter /FlateDecode' : '') + ' >>\nstream\n');
    put(stream); put('\nendstream\nendobj\n');
    if (font) obj(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding << /Type /Encoding /BaseEncoding /WinAnsiEncoding' +
      (font.length ? ' /Differences [' + font.join(' ') + ']' : '') + ' >> >>');
    const xref = pos;
    let x = 'xref\n0 ' + (nObj + 1) + '\n0000000000 65535 f \n';
    for (let n = 1; n <= nObj; n++) x += String(offs[n]).padStart(10, '0') + ' 00000 n \n';
    put(x + 'trailer\n<< /Size ' + (nObj + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
    const out = new Uint8Array(pos);
    let q = 0;
    for (const b of parts) { out.set(b, q); q += b.length; }
    return out;
  }

  function csv(rows) {
    const cell = v => { const s = String(v); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return '﻿' + rows.map(r => r.map(cell).join(';')).join('\r\n') + '\r\n';
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

  return { svg: svg, dxf: dxf, pdf: pdf, zip: zip, csv: csv };
})();
if (typeof module !== 'undefined') module.exports = VecExport;
