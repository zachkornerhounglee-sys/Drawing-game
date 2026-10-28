/* ============================================================================
   classifier.js
   - WEAPONS: single source of truth for the 8 weapon definitions
   - WeaponIcons: vector icon renderer (HUD, toast, in-world sprites)
   - Classifier: heuristic pixel-analysis drawing recognizer (pure, DOM-free)
   - DrawPad: drawing modal, "Analyzing Geometric Signature..." overlay, toast
   ============================================================================ */

const WEAPONS = {
  sword: {
    id: 'sword', name: 'SWORD', color: '#7df9ff', kind: 'melee',
    cd: 0.28, dmg: 20, speedMul: 1.28, range: 82, arc: 1.9,
    stats: [['CLASS', 'Fast melee arc'], ['DAMAGE', '20 per slash'], ['RATE', '0.28 s'], ['PASSIVE', '+28% move speed']],
    hint: 'Long narrow stroke, vertical or diagonal'
  },
  gun: {
    id: 'gun', name: 'BLASTER', color: '#ffe14d', kind: 'ranged',
    cd: 0.16, dmg: 12, speedMul: 1.0, speed: 950,
    stats: [['CLASS', 'Linear single shot'], ['DAMAGE', '12 per bolt'], ['RATE', '0.16 s'], ['SPECIAL', 'Ricochets once']],
    hint: 'L shape: horizontal barrel, vertical handle'
  },
  shield: {
    id: 'shield', name: 'BARRIER', color: '#42d9ff', kind: 'defense',
    cd: 2.4, dmg: 6, speedMul: 0.95, duration: 1.4,
    stats: [['CLASS', 'Energy field'], ['SHIELD', '1.4 s front block'], ['BASH', '6 + knockback'], ['COOLDOWN', '2.4 s']],
    hint: 'Circle, oval or solid square'
  },
  staff: {
    id: 'staff', name: 'STAFF', color: '#c77dff', kind: 'ranged',
    cd: 0.75, dmg: 24, speedMul: 1.0, speed: 230,
    stats: [['CLASS', 'Homing sphere'], ['DAMAGE', '24 per orb'], ['RATE', '0.75 s'], ['SPECIAL', 'Seeks nearest foe']],
    hint: 'Thin shaft with a blob at one tip'
  },
  bow: {
    id: 'bow', name: 'BOW', color: '#9bff6b', kind: 'ranged',
    cd: 0.85, dmg: 14, speedMul: 1.0, speed: 1500,
    stats: [['CLASS', 'Silent arrow'], ['DAMAGE', '14 to 80'], ['RATE', '0.85 s'], ['SPECIAL', 'Crits at long range']],
    hint: 'A deep crescent arc'
  },
  axe: {
    id: 'axe', name: 'BATTLEAXE', color: '#ff7a45', kind: 'melee',
    cd: 1.1, dmg: 48, speedMul: 0.82, range: 105, arc: 2.9,
    stats: [['CLASS', 'Heavy cleave'], ['DAMAGE', '48 per swing'], ['RATE', '1.1 s'], ['SPECIAL', 'Massive screen shake']],
    hint: 'Thick shaft with wide horizontal wings'
  },
  shuriken: {
    id: 'shuriken', name: 'SHURIKEN', color: '#ff4d8d', kind: 'ranged',
    cd: 0.65, dmg: 9, speedMul: 1.05, speed: 720,
    stats: [['CLASS', '3-star burst'], ['DAMAGE', '9 per star'], ['RATE', '0.65 s'], ['SPECIAL', 'Wide spread, bounces']],
    hint: 'An X, plus or multi-pointed star'
  },
  hammer: {
    id: 'hammer', name: 'WARHAMMER', color: '#ffb000', kind: 'melee',
    cd: 1.45, dmg: 36, speedMul: 0.85, range: 85,
    stats: [['CLASS', 'Overhead smash'], ['DAMAGE', '36 area'], ['RATE', '1.45 s'], ['SPECIAL', 'Shockwave slows foes']],
    hint: 'Long shaft topped with a heavy block'
  }
};
const WEAPON_ORDER = ['sword', 'gun', 'shield', 'staff', 'bow', 'axe', 'shuriken', 'hammer'];

/* ---------------------------------------------------------------------------
   Vector icons. Every icon is drawn in a unit box pointing toward +x.
   --------------------------------------------------------------------------- */
const WeaponIcons = (function () {
  const D = {
    sword(c) {
      c.lineWidth = 0.14; c.beginPath(); c.moveTo(-0.15, 0); c.lineTo(1, 0); c.stroke();
      c.lineWidth = 0.1; c.beginPath(); c.moveTo(-0.15, -0.34); c.lineTo(-0.15, 0.34); c.stroke();
      c.beginPath(); c.moveTo(-0.15, 0); c.lineTo(-0.72, 0); c.stroke();
    },
    gun(c) {
      c.beginPath(); c.rect(-0.62, -0.32, 1.64, 0.32); c.fill();
      c.beginPath(); c.rect(-0.62, 0, 0.3, 0.74); c.fill();
      c.lineWidth = 0.06; c.beginPath(); c.moveTo(-0.1, 0); c.lineTo(-0.1, 0.26); c.stroke();
    },
    shield(c) {
      c.lineWidth = 0.14; c.beginPath(); c.arc(0, 0, 0.78, 0, Math.PI * 2); c.stroke();
      c.lineWidth = 0.07; c.beginPath(); c.arc(0, 0, 0.46, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.arc(0, 0, 0.13, 0, Math.PI * 2); c.fill();
    },
    staff(c) {
      c.lineWidth = 0.1; c.beginPath(); c.moveTo(-0.95, 0); c.lineTo(0.55, 0); c.stroke();
      c.beginPath(); c.arc(0.78, 0, 0.27, 0, Math.PI * 2); c.fill();
      c.lineWidth = 0.05; c.beginPath(); c.arc(0.78, 0, 0.4, 0, Math.PI * 2); c.stroke();
    },
    bow(c) {
      c.lineWidth = 0.12; c.beginPath(); c.arc(-0.55, 0, 1.0, -1.0, 1.0); c.stroke();
      c.lineWidth = 0.04; c.beginPath(); c.moveTo(-0.01, -0.84); c.lineTo(-0.01, 0.84); c.stroke();
      c.lineWidth = 0.06; c.beginPath(); c.moveTo(-0.35, 0); c.lineTo(0.95, 0); c.stroke();
      c.beginPath(); c.moveTo(1.05, 0); c.lineTo(0.8, -0.14); c.lineTo(0.8, 0.14); c.closePath(); c.fill();
    },
    axe(c) {
      c.lineWidth = 0.11; c.beginPath(); c.moveTo(-0.95, 0); c.lineTo(0.8, 0); c.stroke();
      c.beginPath(); c.moveTo(0.3, -0.78); c.quadraticCurveTo(1.0, -0.35, 0.82, 0);
      c.quadraticCurveTo(1.0, 0.35, 0.3, 0.78); c.quadraticCurveTo(0.55, 0, 0.3, -0.78); c.fill();
    },
    shuriken(c) {
      c.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4 + Math.PI / 4, r = (i % 2 === 0) ? 0.95 : 0.26;
        const x = Math.cos(a) * r, y = Math.sin(a) * r;
        if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.closePath(); c.fill();
    },
    hammer(c) {
      c.lineWidth = 0.11; c.beginPath(); c.moveTo(-0.95, 0); c.lineTo(0.5, 0); c.stroke();
      c.beginPath(); c.rect(0.42, -0.46, 0.58, 0.92); c.fill();
    }
  };
  function draw(ctx, type, cx, cy, size, color, rot, glow) {
    const fn = D[type]; if (!fn) return;
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(rot || 0);
    ctx.shadowColor = color; ctx.shadowBlur = glow === undefined ? 8 : glow;
    ctx.scale(size, size);
    ctx.strokeStyle = color; ctx.fillStyle = color;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    fn(ctx);
    ctx.restore();
  }
  return { draw };
})();

/* ---------------------------------------------------------------------------
   Classifier: pure heuristic analysis of a binary ink mask.
   Features: bounding box, aspect ratio, pixel density, principal-axis
   (stroke direction) profile, radial lobes, enclosure, L-shape zoning.
   --------------------------------------------------------------------------- */
const Classifier = (function () {
  'use strict';
  const B = 24;     // bins along the principal axis
  const SEC = 36;   // polar sectors
  const GG = 24;    // normalized bbox grid for the L-shape test

  function median(a) { if (!a.length) return 0; const s = a.slice().sort(function (x, y) { return x - y; }); return s[s.length >> 1]; }
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function scale(x, lo, hi) { return clamp01((x - lo) / (hi - lo)); }

  function countLobes(rmax, maxR) {
    const st = [];
    for (let i = 0; i < rmax.length; i++) {
      const r = rmax[i] / maxR;
      st.push(r >= 0.72 ? 1 : (r <= 0.58 ? -1 : 0));
    }
    const idx = [];
    for (let i = 0; i < st.length; i++) if (st[i] !== 0) idx.push(i);
    if (idx.length < 2) return 0;
    let lobes = 0;
    for (let j = 0; j < idx.length; j++) {
      if (st[idx[j]] === -1 && st[idx[(j + 1) % idx.length]] === 1) lobes++;
    }
    return lobes;
  }

  function enclosedFraction(xs, ys, n, minX, minY, bw, bh) {
    const S = 96 / Math.max(bw, bh);
    const gw = Math.ceil(bw * S) + 1, gh = Math.ceil(bh * S) + 1, M = 4;
    const GW = gw + 2 * M, GH = gh + 2 * M;
    const g = new Uint8Array(GW * GH);
    for (let k = 0; k < n; k++) {
      const gx = Math.floor((xs[k] - minX) * S) + M, gy = Math.floor((ys[k] - minY) * S) + M;
      g[gy * GW + gx] = 1;
    }
    const RAD = 2, tmp = new Uint8Array(GW * GH), d = new Uint8Array(GW * GH);
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
      if (!g[y * GW + x]) continue;
      for (let k = -RAD; k <= RAD; k++) { const xx = x + k; if (xx >= 0 && xx < GW) tmp[y * GW + xx] = 1; }
    }
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
      if (!tmp[y * GW + x]) continue;
      for (let k = -RAD; k <= RAD; k++) { const yy = y + k; if (yy >= 0 && yy < GH) d[yy * GW + x] = 1; }
    }
    const seen = new Uint8Array(GW * GH), stack = [0];
    seen[0] = 1;
    while (stack.length) {
      const p = stack.pop(), x = p % GW, y = (p / GW) | 0;
      const nb = [];
      if (x > 0) nb.push(p - 1);
      if (x < GW - 1) nb.push(p + 1);
      if (y > 0) nb.push(p - GW);
      if (y < GH - 1) nb.push(p + GW);
      for (let i = 0; i < nb.length; i++) {
        const q = nb[i];
        if (!seen[q] && !d[q]) { seen[q] = 1; stack.push(q); }
      }
    }
    let enclosed = 0;
    for (let i = 0; i < GW * GH; i++) if (!d[i] && !seen[i]) enclosed++;
    return enclosed / (gw * gh);
  }

  function gunFeatures(xs, ys, n, minX, minY, bw, bh) {
    const grid = new Uint8Array(GG * GG), rowMass = new Array(GG).fill(0);
    for (let k = 0; k < n; k++) {
      const gx = Math.min(GG - 1, Math.floor((xs[k] - minX) / bw * GG));
      const gy = Math.min(GG - 1, Math.floor((ys[k] - minY) / bh * GG));
      grid[gy * GG + gx] = 1; rowMass[gy]++;
    }
    const colsTop = new Uint8Array(GG);
    let topMass = 0, botMass = 0;
    for (let r = 0; r < GG; r++) {
      if (r <= 8) { topMass += rowMass[r]; for (let c = 0; c < GG; c++) if (grid[r * GG + c]) colsTop[c] = 1; }
      if (r >= 12) botMass += rowMass[r];
    }
    let topCols = 0; for (let c = 0; c < GG; c++) topCols += colsTop[c];
    let cMin = GG, cMax = -1, rowsInk = 0;
    for (let r = 12; r < GG; r++) {
      let any = false;
      for (let c = 0; c < GG; c++) if (grid[r * GG + c]) { any = true; if (c < cMin) cMin = c; if (c > cMax) cMax = c; }
      if (any) rowsInk++;
    }
    const hw = cMax - cMin + 1, hc = (cMin + cMax + 1) / 2 / GG;
    const ok = bw / bh >= 1.0 && topCols / GG >= 0.8 && rowsInk >= 3 && cMax >= 0 &&
      hw <= 0.45 * GG && (hc <= 0.4 || hc >= 0.6) && topMass / n >= 0.3 && botMass / n >= 0.06;
    return { ok: ok, topCover: topCols / GG, handleW: hw / GG, handleC: hc };
  }

  function headAnalysis(bins, L) {
    const cnt = bins.cnt, lo = bins.lo, hi = bins.hi;
    const outer = Math.round(B * 0.35);
    let lowM = 0, highM = 0;
    for (let i = 0; i < outer; i++) lowM += cnt[i];
    for (let i = B - outer; i < B; i++) highM += cnt[i];
    const rev = lowM > highM;
    const c = [], l = [], h = [];
    for (let i = 0; i < B; i++) { const j = rev ? B - 1 - i : i; c.push(cnt[j]); l.push(lo[j]); h.push(hi[j]); }
    const span = function (i) { return c[i] > 0 ? h[i] - l[i] + 1 : 0; };
    const sp = [], cen = [];
    for (let i = 0; i < B / 2; i++) if (c[i] > 0) { sp.push(span(i)); cen.push((l[i] + h[i]) / 2); }
    const sw = Math.max(2, median(sp)), shaftC = median(cen);
    const thr = Math.max(2.0 * sw, sw + 0.07 * L);
    let mn = -1, mx = -1, hlo = 1e9, hhi = -1e9, mass = 0;
    for (let i = B - outer; i < B; i++) {
      if (c[i] > 0 && span(i) > thr) {
        if (mn < 0) mn = i; mx = i;
        hlo = Math.min(hlo, l[i]); hhi = Math.max(hhi, h[i]); mass += c[i];
      }
    }
    if (mn < 0) return { has: false, sw: sw };
    const binLen = L / B;
    // local shaft centre just inside the head (robust against principal-axis tilt)
    const near = [];
    for (let i = Math.max(0, mn - 4); i < mn; i++) if (c[i] > 0 && span(i) <= thr) near.push((l[i] + h[i]) / 2);
    const localC = near.length ? median(near) : shaftC;
    return {
      has: true, sw: sw, span: hhi - hlo + 1, len: (mx - mn + 1) * binLen,
      gap: (B - 1 - mx) * binLen, off: (hlo + hhi) / 2 - localC, mass: mass
    };
  }

  function arcFeatures(bins, L) {
    const c = [];
    for (let i = 0; i < B; i++) c.push(bins.cnt[i] > 0 ? bins.sum[i] / bins.cnt[i] : null);
    let first = -1, last = -1;
    for (let i = 0; i < B; i++) if (c[i] !== null) { if (first < 0) first = i; last = i; }
    if (first < 0 || last - first < 8) return { ok: false, sag: 0 };
    for (let i = first; i <= last; i++) {
      if (c[i] === null) {
        let a = i - 1, b = i + 1;
        while (c[a] === null) a--;
        while (c[b] === null) b++;
        c[i] = c[a] + (c[b] - c[a]) * (i - a) / (b - a);
      }
    }
    const c0 = c[first], c1 = c[last];
    const dev = []; let sag = 0;
    for (let i = first; i <= last; i++) {
      const t = (i - first) / (last - first);
      const d = c[i] - (c0 + (c1 - c0) * t);
      dev.push(d);
      if (Math.abs(d) > Math.abs(sag)) sag = d;
    }
    let wrong = 0;
    for (let i = 0; i < dev.length; i++) {
      if (Math.abs(dev[i]) > 0.25 * Math.abs(sag) && Math.sign(dev[i]) !== Math.sign(sag)) wrong++;
    }
    const sr = Math.abs(sag) / L;
    return { ok: sr >= 0.13 && wrong === 0, sag: sr };
  }

  function dFeatures(bins, L, elong) {
    const cnt = bins.cnt, lo = bins.lo, hi = bins.hi;
    let loMin = 1e9, loMax = -1e9, hiMin = 1e9, hiMax = -1e9;
    for (let i = 1; i < B - 1; i++) {
      if (cnt[i] <= 0) return { ok: false };
      loMin = Math.min(loMin, lo[i]); loMax = Math.max(loMax, lo[i]);
      hiMin = Math.min(hiMin, hi[i]); hiMax = Math.max(hiMax, hi[i]);
    }
    const flat = Math.min(loMax - loMin, hiMax - hiMin);
    const span = function (i) { return hi[i] - lo[i] + 1; };
    const endSpan = Math.max((span(1) + span(2)) / 2, (span(B - 2) + span(B - 3)) / 2);
    const mid = (span(10) + span(11) + span(12) + span(13)) / 4;
    return { ok: flat <= 0.08 * L && mid >= 1.5 * endSpan && mid >= 0.2 * L && elong >= 1.4, flat: flat / L };
  }

  function computeFeatures(mask, w, h) {
    let n = 0;
    for (let i = 0; i < mask.length; i++) if (mask[i]) n++;
    if (n === 0) return null;
    const xs = new Int16Array(n), ys = new Int16Array(n);
    let k = 0, minX = 1e9, maxX = -1, minY = 1e9, maxY = -1, sx = 0, sy = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      xs[k] = x; ys[k] = y; k++; sx += x; sy += y;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    const bw = maxX - minX + 1, bh = maxY - minY + 1, mx = sx / n, my = sy / n;
    let cxx = 0, cyy = 0, cxy = 0;
    for (k = 0; k < n; k++) { const dx = xs[k] - mx, dy = ys[k] - my; cxx += dx * dx; cyy += dy * dy; cxy += dx * dy; }
    cxx /= n; cyy /= n; cxy /= n;
    const theta = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
    const ux = Math.cos(theta), uy = Math.sin(theta), vx = -uy, vy = ux;
    const us = new Float32Array(n), vs = new Float32Array(n);
    let uMin = 1e9, uMax = -1e9, vMin = 1e9, vMax = -1e9;
    for (k = 0; k < n; k++) {
      const dx = xs[k] - mx, dy = ys[k] - my;
      const u = dx * ux + dy * uy, v = dx * vx + dy * vy;
      us[k] = u; vs[k] = v;
      if (u < uMin) uMin = u; if (u > uMax) uMax = u;
      if (v < vMin) vMin = v; if (v > vMax) vMax = v;
    }
    const L = uMax - uMin + 1, Wd = vMax - vMin + 1;
    const bins = { cnt: [], sum: [], lo: [], hi: [] };
    for (let i = 0; i < B; i++) { bins.cnt.push(0); bins.sum.push(0); bins.lo.push(1e9); bins.hi.push(-1e9); }
    for (k = 0; k < n; k++) {
      let b = Math.floor((us[k] - uMin) / L * B);
      if (b >= B) b = B - 1; if (b < 0) b = 0;
      bins.cnt[b]++; bins.sum[b] += vs[k];
      if (vs[k] < bins.lo[b]) bins.lo[b] = vs[k];
      if (vs[k] > bins.hi[b]) bins.hi[b] = vs[k];
    }
    const rmax = new Array(SEC).fill(0); let maxR = 1;
    for (k = 0; k < n; k++) {
      const dx = xs[k] - mx, dy = ys[k] - my, r = Math.sqrt(dx * dx + dy * dy);
      let s = Math.floor((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI) * SEC);
      if (s >= SEC) s = SEC - 1;
      if (r > rmax[s]) rmax[s] = r;
      if (r > maxR) maxR = r;
    }
    const elong = L / Wd;
    const F = {
      n: n, bw: bw, bh: bh, fill: n / (bw * bh), L: L, W: Wd, elong: elong,
      angle: theta, lobes: countLobes(rmax, maxR),
      closed: enclosedFraction(xs, ys, n, minX, minY, bw, bh),
      gun: gunFeatures(xs, ys, n, minX, minY, bw, bh),
      head: headAnalysis(bins, L), arc: arcFeatures(bins, L), D: dFeatures(bins, L, elong)
    };
    const deg = ((theta * 180 / Math.PI) % 180 + 180) % 180;
    F.direction = (deg < 20 || deg > 160) ? 'horizontal' : (deg > 70 && deg < 110) ? 'vertical' : 'diagonal';
    return F;
  }

  function pick(type, conf, why) {
    return { type: type, conf: Math.max(0.5, Math.min(0.99, conf)), why: why };
  }

  function decide(F) {
    if (F.elong >= 0.62 && F.elong <= 1.7 && F.lobes >= 4 && F.fill < 0.55)
      return pick('shuriken', 0.72 + 0.06 * Math.min(4, F.lobes - 3), F.lobes + ' radial points');
    if (F.gun.ok)
      return pick('gun', 0.8 + 0.1 * scale(F.gun.topCover, 0.8, 1), 'horizontal barrel + vertical handle');
    if (F.D.ok)
      return pick('bow', 0.84, 'curved limb with straight string');
    if (F.elong >= 0.5 && F.elong <= 2.0 && F.lobes < 4 && (F.closed >= 0.16 || F.fill >= 0.5))
      return pick('shield', 0.7 + 0.25 * scale(Math.max(F.closed, F.fill), 0.16, 0.7), 'enclosed / dense mass');
    if (F.arc.ok && F.closed < 0.12 && F.elong >= 1.25 && F.fill < 0.4)
      return pick('bow', 0.7 + 0.25 * scale(F.arc.sag, 0.13, 0.4), 'crescent arc, sagitta ' + F.arc.sag.toFixed(2));
    if (F.elong >= 1.45) {
      const hd = F.head;
      if (!hd.has) {
        if (F.elong >= 2.5) return pick('sword', 0.66 + 0.3 * scale(F.elong, 2.5, 9), 'narrow straight stroke');
      } else if (hd.gap > 0.10 * F.L) {
        return pick('sword', 0.8, 'blade with cross-guard');
      } else {
        const hA = hd.span / Math.max(hd.len, 1), rel = hd.span / F.L;
        const off = Math.abs(hd.off) > 0.22 * hd.span;
        if ((hA >= 2.3 && rel >= 0.25) || (hA >= 2.0 && rel >= 0.36) || (rel >= 0.42 && hA >= 1.5) || (off && rel >= 0.2 && hA >= 1.0))
          return pick('axe', 0.74 + 0.2 * scale(rel, 0.25, 0.6), 'wide wings on shaft');
        if (hA >= 2.3 && rel < 0.25) return pick('sword', 0.7, 'blade with pommel');
        if (rel >= 0.22) return pick('hammer', 0.74 + 0.2 * scale(rel, 0.22, 0.45), 'heavy block head');
        return pick('staff', 0.74 + 0.2 * scale(rel, 0.1, 0.2), 'tip cluster');
      }
    }
    if (F.elong >= 2.0) { const r = pick('sword', 0.5, 'best guess: elongated'); r.guess = true; return r; }
    if (F.closed >= 0.1 || F.fill >= 0.35) { const r = pick('shield', 0.5, 'best guess: compact mass'); r.guess = true; return r; }
    if (F.lobes >= 3) { const r = pick('shuriken', 0.5, 'best guess: radial'); r.guess = true; return r; }
    const r = pick('shield', 0.5, 'best guess: compact'); r.guess = true; return r;
  }

  function analyzeMask(mask, w, h) {
    const F = computeFeatures(mask, w, h);
    if (!F || F.n < 120 || Math.max(F.bw, F.bh) < 28)
      return { type: null, confidence: 0, reason: 'Signature too faint. Draw larger.', features: F };
    const r = decide(F);
    return { type: r.type, confidence: r.conf, reason: r.why, guess: !!r.guess, features: F };
  }

  function analyzeCanvas(canvas) {
    const w = canvas.width, h = canvas.height;
    const d = canvas.getContext('2d').getImageData(0, 0, w, h).data;
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < mask.length; i++) mask[i] = d[i * 4 + 3] > 40 ? 1 : 0;
    return analyzeMask(mask, w, h);
  }

  return { analyzeMask: analyzeMask, analyzeCanvas: analyzeCanvas, computeFeatures: computeFeatures };
})();

/* ---------------------------------------------------------------------------
   DrawPad: modal drawing canvas + analysis overlay + combat toast
   --------------------------------------------------------------------------- */
const DrawPad = (function () {
  const INK = '#eaffff';
  let pad, pctx, modal, overlay, brushInput, brushLabel, toastLayer;
  let drawing = false, strokes = [], cur = null, brush = 10, busy = false, cfg = {}, open_ = false;

  function $(id) { return document.getElementById(id); }

  function buildLegend() {
    const lg = $('legend');
    lg.innerHTML = '';
    WEAPON_ORDER.forEach(function (id) {
      const w = WEAPONS[id];
      const row = document.createElement('div'); row.className = 'lg-row';
      const c = document.createElement('canvas'); c.width = 34; c.height = 34;
      WeaponIcons.draw(c.getContext('2d'), id, 17, 17, 13, w.color, -0.5, 4);
      const t = document.createElement('div'); t.className = 'lg-text';
      const a = document.createElement('b'); a.textContent = w.name; a.style.color = w.color;
      const b = document.createElement('span'); b.textContent = w.hint;
      t.appendChild(a); t.appendChild(b);
      row.appendChild(c); row.appendChild(t);
      lg.appendChild(row);
    });
  }

  function pos(e) {
    const r = pad.getBoundingClientRect();
    return [(e.clientX - r.left) * pad.width / r.width, (e.clientY - r.top) * pad.height / r.height];
  }
  function down(e) {
    if (busy) return;
    e.preventDefault();
    try { pad.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    drawing = true;
    const p = pos(e); cur = [p]; strokes.push(cur);
    pctx.fillStyle = INK; pctx.beginPath(); pctx.arc(p[0], p[1], brush / 2, 0, Math.PI * 2); pctx.fill();
  }
  function move(e) {
    if (!drawing || busy) return;
    const p = pos(e), last = cur[cur.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 1.5) return;
    pctx.strokeStyle = INK; pctx.lineWidth = brush; pctx.lineCap = 'round'; pctx.lineJoin = 'round';
    pctx.beginPath(); pctx.moveTo(last[0], last[1]); pctx.lineTo(p[0], p[1]); pctx.stroke();
    cur.push(p);
  }
  function up() { drawing = false; cur = null; }

  function clear() {
    strokes = []; pctx.clearRect(0, 0, pad.width, pad.height);
  }

  function showToast(res) {
    const el = document.createElement('div'); el.className = 'toast';
    if (!res.type) {
      el.classList.add('fail');
      const t = document.createElement('div'); t.className = 'toast-title'; t.textContent = 'NO SIGNATURE';
      const s = document.createElement('div'); s.className = 'toast-sub'; s.textContent = res.reason;
      el.appendChild(t); el.appendChild(s);
    } else {
      const w = WEAPONS[res.type];
      el.style.setProperty('--c', w.color);
      const ic = document.createElement('canvas'); ic.width = 76; ic.height = 76;
      WeaponIcons.draw(ic.getContext('2d'), res.type, 38, 38, 30, w.color, -0.55, 14);
      const body = document.createElement('div'); body.className = 'toast-body';
      const t = document.createElement('div'); t.className = 'toast-title';
      t.textContent = 'DETECTED: ' + w.name; t.style.color = w.color;
      const s = document.createElement('div'); s.className = 'toast-sub';
      s.textContent = Math.round(res.confidence * 100) + '% match' + (res.guess ? ' (best guess)' : '') +
        ' | ' + res.features.direction + ' stroke | ' + res.reason;
      body.appendChild(t); body.appendChild(s);
      const grid = document.createElement('div'); grid.className = 'toast-stats';
      w.stats.forEach(function (st) {
        const k = document.createElement('span'); k.textContent = st[0];
        const v = document.createElement('b'); v.textContent = st[1];
        grid.appendChild(k); grid.appendChild(v);
      });
      body.appendChild(grid);
      el.appendChild(ic); el.appendChild(body);
    }
    toastLayer.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 4600);
  }

  function equip() {
    if (busy) return;
    if (!strokes.length) {
      showToast({ type: null, reason: 'Draw a weapon on the pad first.' });
      return;
    }
    busy = true; overlay.classList.remove('hidden');
    setTimeout(function () {
      const res = Classifier.analyzeCanvas(pad);
      overlay.classList.add('hidden'); busy = false;
      if (res.type) {
        close(); showToast(res);
        if (cfg.onEquip) cfg.onEquip(res.type, res);
      } else showToast(res);
    }, 1600);
  }

  function open() {
    if (open_) return;
    open_ = true; modal.classList.remove('hidden');
    if (cfg.onOpen) cfg.onOpen();
  }
  function close() {
    if (!open_) return;
    open_ = false; modal.classList.add('hidden'); drawing = false;
    if (cfg.onClose) cfg.onClose();
  }

  function init(opts) {
    cfg = opts || {};
    pad = $('padCanvas'); pctx = pad.getContext('2d'); modal = $('drawModal'); overlay = $('analyzing');
    brushInput = $('padBrush'); brushLabel = $('padBrushLabel'); toastLayer = $('toastLayer');
    buildLegend();
    pad.addEventListener('pointerdown', down);
    pad.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    pad.addEventListener('pointercancel', up);
    brushInput.addEventListener('input', function () { brush = +brushInput.value; brushLabel.textContent = brush; });
    $('padClear').addEventListener('click', clear);
    $('padEquip').addEventListener('click', equip);
    $('padClose').addEventListener('click', close);
    modal.addEventListener('mousedown', function (e) { if (e.target === modal) close(); });
    clear();
  }

  return { init: init, open: open, close: close, isOpen: function () { return open_; } };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Classifier: Classifier, WEAPONS: WEAPONS, WEAPON_ORDER: WEAPON_ORDER };
}
