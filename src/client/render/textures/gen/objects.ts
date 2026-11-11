/**
 * Glass, screens, LEDs and "object" materials whose texture shows one complete object
 * fitted to a box face (doors, façade windows, shutters). Fitted textures keep a plain
 * border: the thin sides of the box sample the bottom-left corner of the texture.
 */
import { css, hex, mix, mul, tone, WHITE, type Generator, type Rgb } from '../painter';

const FONT = '"Segoe UI", "Helvetica Neue", Arial, "Liberation Sans", sans-serif';

// ------------------------------------------------------------------------------- glass

/** Clear glass: almost uniform bluish tint with faint diagonal reflections and smears. */
export function glass(): Generator {
  return (p) => {
    const n = p.n;
    p.fill(p.base);
    const c = p.ctx;
    // Diagonal reflection bands: lines x + y = const wrap around seamlessly.
    c.save();
    c.lineCap = 'butt';
    const bands: [number, number, number][] = [
      [0.12, 0.09, 0.16],
      [0.3, 0.025, 0.12],
      [0.62, 0.14, 0.1],
      [0.86, 0.03, 0.14],
    ];
    for (const [pos, width, alpha] of bands) {
      c.strokeStyle = `rgba(255,255,255,${alpha})`;
      c.lineWidth = width * n * Math.SQRT1_2;
      for (let k = -1; k <= 2; k++) {
        const s = (pos + k) * n; // the line x + y = s; a period of n keeps the tile seamless
        c.beginPath();
        c.moveTo(s + n, -n);
        c.lineTo(s - 2 * n, 2 * n);
        c.stroke();
      }
    }
    c.restore();
    p.mod([
      [p.cloud, 0.03, 1.4, 1, 0.5],
      [p.mottle, 0.012],
    ]);
    p.normalize();
  };
}

/** Frosted glass: fine sparkling frost over soft cloudy patches. */
export function frostedGlass(): Generator {
  return (p) => {
    p.fill(p.base);
    p.mod([
      [p.stipple, 0.035],
      [p.fine, 0.02],
      [p.cloud, 0.03, 1.3, 1, 0.6],
    ]);
    p.speck(p.fleck, 0.7, 0.95, WHITE, 0.35);
    p.normalize();
  };
}

/** Dark shop window: deep glass with reflections of the street and a hint of the interior. */
export function shopfront(): Generator {
  return (p) => {
    const n = p.n;
    const b = p.base;
    p.fill(b);
    const c = p.ctx;
    // Ghosts of shelves / lights inside (very low contrast, periodic).
    for (let i = 0; i < 7; i++) {
      const x = p.rand(0, n);
      const y = p.rand(0, n);
      const w = p.rand(0.08, 0.3) * n;
      const h = p.rand(0.02, 0.1) * n;
      const warm = p.rng() < 0.5;
      p.wrap(x, y, x + w, y + h, (dx, dy) => {
        const g = c.createLinearGradient(0, y + dy, 0, y + dy + h);
        const col = warm ? '255,214,150' : '150,190,220';
        g.addColorStop(0, `rgba(${col},0)`);
        g.addColorStop(0.5, `rgba(${col},0.1)`);
        g.addColorStop(1, `rgba(${col},0)`);
        c.fillStyle = g;
        c.fillRect(x + dx, y + dy, w, h);
      });
    }
    // Sky reflections: diagonal bands.
    const bands: [number, number, number][] = [
      [0.08, 0.16, 0.1],
      [0.36, 0.035, 0.13],
      [0.44, 0.02, 0.08],
      [0.7, 0.11, 0.07],
    ];
    for (const [pos, width, alpha] of bands) {
      c.strokeStyle = `rgba(170,205,235,${alpha})`;
      c.lineWidth = width * n * Math.SQRT1_2;
      for (let k = -1; k <= 2; k++) {
        const s = (pos + k) * n; // the line x + y = s; a period of n keeps the tile seamless
        c.beginPath();
        c.moveTo(s + n, -n);
        c.lineTo(s - 2 * n, 2 * n);
        c.stroke();
      }
    }
    p.mod([
      [p.cloud, 0.14, 0.8, 1, 1.25],
      [p.patch, 0.05],
      [p.grit, 0.012],
    ]);
    p.normalize();
  };
}

// ------------------------------------------------------------------------------- LEDs

/** Glowing LED surface: saturated colour with a fine matrix of brighter emitters. */
export function led(): Generator {
  return (p) => {
    const n = p.n;
    const b = p.base;
    p.fill(b);
    const dots = 32;
    const s = n / dots;
    const lut = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const f = (i / s) % 1;
      lut[i] = Math.cos((f - 0.5) * 2 * Math.PI) * 0.5 + 0.5; // 1 at the emitter centre
    }
    const hot = mix(b, WHITE, 0.55);
    const d = p.data;
    let q = 0;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++, q += 4) {
        const g = lut[x]! * lut[y]!;
        const t = g * g;
        const k = 0.86 + 0.14 * g;
        d[q] = (d[q]! + (hot[0] - d[q]!) * t * 0.6) * k;
        d[q + 1] = (d[q + 1]! + (hot[1] - d[q + 1]!) * t * 0.6) * k;
        d[q + 2] = (d[q + 2]! + (hot[2] - d[q + 2]!) * t * 0.6) * k;
      }
    }
    p.mod([[p.cloud, 0.03]]);
    p.normalize();
  };
}

// ------------------------------------------------------------------------------- screens

/** Switched-off monitor: black panel in a slim bezel with a faint window reflection. */
export function screenOff(): Generator {
  return (p) => {
    const n = p.n;
    const c = p.ctx;
    c.fillStyle = '#17191c';
    c.fillRect(0, 0, n, n);
    const bz = Math.round(0.03 * n);
    const g = c.createLinearGradient(0, 0, n, n);
    g.addColorStop(0, '#11151a');
    g.addColorStop(0.5, '#080a0d');
    g.addColorStop(1, '#0b0e12');
    c.fillStyle = g;
    c.fillRect(bz, bz, n - 2 * bz, n - 2 * bz);
    // Reflection of a window.
    c.save();
    c.beginPath();
    c.rect(bz, bz, n - 2 * bz, n - 2 * bz);
    c.clip();
    c.fillStyle = 'rgba(150,180,210,0.07)';
    c.beginPath();
    c.moveTo(0.52 * n, 0.08 * n);
    c.lineTo(0.9 * n, 0.12 * n);
    c.lineTo(0.84 * n, 0.52 * n);
    c.lineTo(0.48 * n, 0.44 * n);
    c.closePath();
    c.fill();
    c.fillStyle = 'rgba(8,10,13,0.7)';
    c.fillRect(0.685 * n, 0.08 * n, 0.012 * n, 0.46 * n);
    c.fillStyle = 'rgba(150,180,210,0.035)';
    c.beginPath();
    c.moveTo(0.08 * n, 0.55 * n);
    c.lineTo(0.3 * n, 0.5 * n);
    c.lineTo(0.34 * n, 0.92 * n);
    c.lineTo(0.1 * n, 0.95 * n);
    c.closePath();
    c.fill();
    c.restore();
    c.strokeStyle = 'rgba(70,76,84,0.6)';
    c.lineWidth = Math.max(1, p.u);
    c.strokeRect(bz, bz, n - 2 * bz, n - 2 * bz);
    // Stand-by light.
    c.fillStyle = '#c96a1e';
    c.fillRect(n - bz * 3, n - bz * 0.72, bz * 0.8, bz * 0.3);
    p.mod([[p.coarse, 0.05]]);
  };
}

/**
 * Lit monitor running an (invented) lab validation software. Drawn in a 640 × 400 design
 * space stretched to the square texture: on a 16:10 face the proportions come out right.
 */
export function screenOn(): Generator {
  return (p) => {
    const n = p.n;
    const c = p.ctx;
    const W = 640;
    const H = 400;
    c.save();
    c.scale(n / W, n / H);
    const NAVY = '#003f71';
    const BLUE = '#3182ce';
    const RED = '#e7343f';
    const INK = '#22303c';
    const MUTED = '#6b7b8a';
    // Bezel (also what the thin sides of the screen box sample).
    c.fillStyle = '#14171b';
    c.fillRect(0, 0, W, H);
    const bz = 9;
    c.beginPath();
    c.rect(bz, bz, W - 2 * bz, H - 2 * bz);
    c.clip();
    // Desktop.
    c.fillStyle = '#eaf2f9';
    c.fillRect(0, 0, W, H);

    // Header bar.
    c.fillStyle = NAVY;
    c.fillRect(0, 0, W, 46);
    c.fillStyle = BLUE;
    c.fillRect(0, 46, W, 3);
    // Logo mark: a drop in a ring.
    c.strokeStyle = '#ffffff';
    c.lineWidth = 2.5;
    c.beginPath();
    c.arc(31, 28, 10, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = RED;
    c.beginPath();
    c.moveTo(31, 20);
    c.quadraticCurveTo(38, 30, 31, 34);
    c.quadraticCurveTo(24, 30, 31, 20);
    c.fill();
    c.fillStyle = '#ffffff';
    c.textBaseline = 'middle';
    c.textAlign = 'left';
    c.font = `600 19px ${FONT}`;
    c.fillText('Validation biologique', 50, 28);
    c.font = `13px ${FONT}`;
    c.textAlign = 'right';
    c.fillStyle = '#cfe2f3';
    c.fillText('Poste 07  ·  14:32', W - 20, 28);

    // Tabs.
    c.textAlign = 'left';
    c.font = `600 12px ${FONT}`;
    const tabs = ['Dossiers', 'Résultats', 'Contrôles qualité', 'Automates'];
    let tx = 20;
    tabs.forEach((t, i) => {
      const w = c.measureText(t).width;
      c.fillStyle = i === 1 ? NAVY : MUTED;
      c.fillText(t, tx, 66);
      if (i === 1) {
        c.fillStyle = BLUE;
        c.fillRect(tx, 76, w, 3);
      }
      tx += w + 24;
    });
    c.fillStyle = '#c9d8e6';
    c.fillRect(bz, 80, W - 2 * bz, 1);

    // Left card: request summary.
    const card = (x: number, y: number, w: number, h: number): void => {
      c.fillStyle = 'rgba(0,40,80,0.1)';
      c.fillRect(x + 1.5, y + 2, w, h);
      c.fillStyle = '#ffffff';
      c.fillRect(x, y, w, h);
    };
    card(18, 90, 176, 128);
    c.fillStyle = NAVY;
    c.font = `600 12px ${FONT}`;
    c.fillText('Dossier 25-118-0427', 28, 106);
    c.font = `11px ${FONT}`;
    const info: [string, string][] = [
      ['Prélèvement', '08:14'],
      ['Tubes', 'EDTA · Sérum'],
      ['Préleveur', 'Site A'],
      ['Priorité', 'Urgent'],
    ];
    info.forEach(([k, v], i) => {
      const y = 127 + i * 19;
      c.fillStyle = MUTED;
      c.textAlign = 'left';
      c.fillText(k, 28, y);
      c.fillStyle = i === 3 ? RED : INK;
      c.textAlign = 'right';
      c.fillText(v, 184, y);
    });
    c.textAlign = 'left';
    // Status chip.
    c.fillStyle = '#e3f4e8';
    c.fillRect(28, 196, 92, 15);
    c.fillStyle = '#23874a';
    c.font = `600 10px ${FONT}`;
    c.fillText('● Série validée', 33, 204);

    // Left card: follow-up curve.
    card(18, 228, 176, 132);
    c.fillStyle = NAVY;
    c.font = `600 12px ${FONT}`;
    c.fillText('Suivi CRP (mg/L)', 28, 244);
    const gx = 34;
    const gy = 258;
    const gw = 148;
    const gh = 84;
    c.strokeStyle = '#dbe6f0';
    c.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      c.beginPath();
      c.moveTo(gx, gy + (gh * i) / 4);
      c.lineTo(gx + gw, gy + (gh * i) / 4);
      c.stroke();
    }
    // Reference band.
    c.fillStyle = 'rgba(49,130,206,0.12)';
    c.fillRect(gx, gy + gh * 0.78, gw, gh * 0.22);
    const pts = [0.9, 0.86, 0.8, 0.55, 0.22, 0.3, 0.52, 0.68];
    c.strokeStyle = BLUE;
    c.lineWidth = 2.2;
    c.lineJoin = 'round';
    c.beginPath();
    pts.forEach((v, i) => {
      const x = gx + (gw * i) / (pts.length - 1);
      const y = gy + gh * v;
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    });
    c.stroke();
    pts.forEach((v, i) => {
      const x = gx + (gw * i) / (pts.length - 1);
      const y = gy + gh * v;
      c.fillStyle = v < 0.5 ? RED : BLUE;
      c.beginPath();
      c.arc(x, y, 3, 0, Math.PI * 2);
      c.fill();
    });

    // Results table.
    const x0 = 206;
    const tw = W - x0 - 18;
    card(x0, 90, tw, 270);
    c.fillStyle = '#dbe9f6';
    c.fillRect(x0, 90, tw, 24);
    c.fillStyle = NAVY;
    c.font = `600 11.5px ${FONT}`;
    const colX = [x0 + 12, x0 + 168, x0 + 218, x0 + 290, x0 + 384];
    ['Analyse', 'Résultat', 'Unité', 'Référence', ''].forEach((h, i) => {
      c.textAlign = i === 1 ? 'right' : 'left';
      c.fillText(h, i === 1 ? colX[1]! + 34 : colX[i]!, 103);
    });
    const rows: [string, string, string, string, '' | 'H' | 'B'][] = [
      ['Glycémie', '5,2', 'mmol/L', '3,9 – 6,1', ''],
      ['Hémoglobine', '13,8', 'g/dL', '12,0 – 16,0', ''],
      ['Plaquettes', '412', 'G/L', '150 – 400', 'H'],
      ['Leucocytes', '7,4', 'G/L', '4,0 – 10,0', ''],
      ['CRP', '48', 'mg/L', '< 5', 'H'],
      ['Créatinine', '78', 'µmol/L', '45 – 84', ''],
      ['Potassium', '3,3', 'mmol/L', '3,5 – 5,1', 'B'],
      ['TSH', '2,1', 'mUI/L', '0,4 – 4,0', ''],
      ['Ferritine', '96', 'µg/L', '15 – 150', ''],
    ];
    const rh = 26;
    rows.forEach((r, i) => {
      const y = 114 + i * rh;
      if (r[4] === 'H') c.fillStyle = '#fdeaea';
      else if (r[4] === 'B') c.fillStyle = '#e8f1fd';
      else c.fillStyle = i % 2 ? '#f5f9fc' : '#ffffff';
      c.fillRect(x0, y, tw, rh);
      c.fillStyle = '#e4ecf3';
      c.fillRect(x0, y + rh - 1, tw, 1);
      const cy = y + rh / 2;
      c.textAlign = 'left';
      c.font = `12.5px ${FONT}`;
      c.fillStyle = INK;
      c.fillText(r[0], colX[0]!, cy);
      c.textAlign = 'right';
      c.font = `600 13px ${FONT}`;
      c.fillStyle = r[4] === 'H' ? RED : r[4] === 'B' ? BLUE : INK;
      c.fillText(r[1], colX[1]! + 34, cy);
      c.textAlign = 'left';
      c.font = `11.5px ${FONT}`;
      c.fillStyle = MUTED;
      c.fillText(r[2], colX[2]!, cy);
      c.fillText(r[3], colX[3]!, cy);
      if (r[4]) {
        c.fillStyle = r[4] === 'H' ? RED : BLUE;
        c.fillRect(colX[4]! - 4, cy - 8, 20, 16);
        c.fillStyle = '#ffffff';
        c.font = `700 11px ${FONT}`;
        c.textAlign = 'center';
        c.fillText(r[4], colX[4]! + 6, cy + 0.5);
      } else {
        c.strokeStyle = '#2a9d58';
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(colX[4]! - 1, cy);
        c.lineTo(colX[4]! + 4, cy + 4.5);
        c.lineTo(colX[4]! + 12, cy - 4.5);
        c.stroke();
      }
    });

    // Status bar.
    c.fillStyle = '#d6e4f1';
    c.fillRect(0, 368, W, H - 368);
    c.fillStyle = '#2a9d58';
    c.beginPath();
    c.arc(26, 380, 4.5, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = INK;
    c.textAlign = 'left';
    c.font = `11.5px ${FONT}`;
    c.fillText('Automates connectés : 4/4', 37, 380.5);
    c.fillStyle = MUTED;
    c.fillText('12 dossiers en attente', 214, 380.5);
    c.textAlign = 'right';
    c.fillStyle = NAVY;
    c.font = `600 11.5px ${FONT}`;
    c.fillText('Contrôle qualité : conforme', W - 20, 380.5);
    c.restore();

    // Backlight: slightly brighter centre, faint pixel structure.
    const cc = p.ctx;
    const g = cc.createRadialGradient(n / 2, n / 2, n * 0.2, n / 2, n / 2, n * 0.75);
    g.addColorStop(0, 'rgba(255,255,255,0.05)');
    g.addColorStop(1, 'rgba(0,20,50,0.1)');
    cc.fillStyle = g;
    const b2 = (bz / W) * n;
    const b3 = (bz / H) * n;
    cc.fillRect(b2, b3, n - 2 * b2, n - 2 * b3);
  };
}

// ------------------------------------------------------------------------------- doors

export interface DoorOptions {
  kind: 'wood' | 'white' | 'metal';
}

/** Lever handle on a long back plate, with a keyhole. Coordinates in metres. */
function drawHandle(c: CanvasRenderingContext2D, x: number, y: number, metal: Rgb): void {
  const hi = css(mix(metal, WHITE, 0.55));
  const mid = css(metal);
  const lo = css(mul(metal, 0.55));
  // Back plate.
  c.fillStyle = 'rgba(0,0,0,0.3)';
  c.beginPath();
  c.roundRect(x - 0.02, y - 0.095, 0.05, 0.25, 0.012);
  c.fill();
  let g = c.createLinearGradient(x - 0.025, 0, x + 0.025, 0);
  g.addColorStop(0, hi);
  g.addColorStop(0.5, mid);
  g.addColorStop(1, lo);
  c.fillStyle = g;
  c.beginPath();
  c.roundRect(x - 0.025, y - 0.1, 0.05, 0.25, 0.012);
  c.fill();
  // Keyhole.
  c.fillStyle = 'rgba(15,15,15,0.9)';
  c.beginPath();
  c.arc(x, y + 0.085, 0.008, 0, Math.PI * 2);
  c.fill();
  c.fillRect(x - 0.0035, y + 0.085, 0.007, 0.022);
  // Lever (pointing toward the middle of the leaf) and its shadow.
  c.fillStyle = 'rgba(0,0,0,0.32)';
  c.beginPath();
  c.roundRect(x - 0.145, y + 0.008, 0.16, 0.026, 0.012);
  c.fill();
  g = c.createLinearGradient(0, y - 0.016, 0, y + 0.016);
  g.addColorStop(0, hi);
  g.addColorStop(0.55, mid);
  g.addColorStop(1, lo);
  c.fillStyle = g;
  c.beginPath();
  c.roundRect(x - 0.15, y - 0.014, 0.165, 0.028, 0.013);
  c.fill();
  c.fillStyle = mid;
  c.beginPath();
  c.arc(x, y, 0.021, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = hi;
  c.beginPath();
  c.arc(x - 0.005, y - 0.005, 0.011, 0, Math.PI * 2);
  c.fill();
}

/** Recessed panel: a moulding frame with a shadowed top / left and a lit bottom / right. */
function drawPanel(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, depth: number, t: number): void {
  // Outer groove.
  c.fillStyle = `rgba(0,0,0,${0.32 * depth})`;
  c.fillRect(x, y, w, t);
  c.fillRect(x, y, t, h);
  c.fillStyle = `rgba(255,255,255,${0.5 * depth})`;
  c.fillRect(x, y + h - t, w, t);
  c.fillRect(x + w - t, y, t, h);
  // Inner raised field edge.
  const i = t * 3.2;
  c.fillStyle = `rgba(255,255,255,${0.32 * depth})`;
  c.fillRect(x + i, y + i, w - 2 * i, t * 0.8);
  c.fillRect(x + i, y + i, t * 0.8, h - 2 * i);
  c.fillStyle = `rgba(0,0,0,${0.22 * depth})`;
  c.fillRect(x + i, y + h - i - t * 0.8, w - 2 * i, t * 0.8);
  c.fillRect(x + w - i - t * 0.8, y + i, t * 0.8, h - 2 * i);
  // Slight shade inside the recess.
  c.fillStyle = `rgba(0,0,0,${0.035 * depth})`;
  c.fillRect(x + t, y + t, w - 2 * t, h - 2 * t);
}

/** Door leaf: one repeat = one leaf (drawn for a 0.93 × 2.04 m face). */
export function door(o: DoorOptions): Generator {
  return (p) => {
    const n = p.n;
    const b = p.base;
    const W = 0.93;
    const H = 2.04;
    p.fill(b);
    // Leaf surface.
    if (o.kind === 'wood') {
      p.mod([
        [p.streakV, 0.07], // vertical grain
        [p.dashV, 0.04],
        [p.bandV, 0.04, 1.1, 1, 0.75],
      ]);
      p.speck(p.dashV, 0.6, 0.9, mul(b, 0.72), 0.4);
    } else if (o.kind === 'white') {
      p.mod([
        [p.stipple, 0.012],
        [p.streakV, 0.012], // brush marks
        [p.cloud, 0.02, 1.3, 1, 0.5],
      ]);
    } else {
      p.mod([
        [p.cloud, 0.06],
        [p.bumps, 0.02],
        [p.bandV, 0.04], // run-off streaks
      ]);
      p.speck(p.coarse, 0.8, 0.95, mul(b, 0.6), 0.6);
    }
    const c = p.ctx;
    c.save();
    c.scale(n / W, n / H);
    const px = W / n; // one texel in metres (horizontal)

    // Edge of the leaf: darker lipping / shadow gap against the frame.
    const edge = o.kind === 'wood' ? mul(b, 0.72) : o.kind === 'white' ? mul(b, 0.86) : mul(b, 0.7);
    c.strokeStyle = css(edge);
    c.lineWidth = 0.022;
    c.strokeRect(0.011, 0.011, W - 0.022, H - 0.022);
    c.strokeStyle = 'rgba(0,0,0,0.28)';
    c.lineWidth = 0.006;
    c.strokeRect(0.003, 0.003, W - 0.006, H - 0.006);

    const t = Math.max(0.006, px * 1.2);
    if (o.kind === 'white') {
      // Classic moulded door: tall upper panels, lower panels, in two columns.
      const m = 0.105;
      const gap = 0.085;
      const pw = (W - 2 * m - gap) / 2;
      for (let i = 0; i < 2; i++) {
        const x = m + i * (pw + gap);
        drawPanel(c, x, 0.12, pw, 0.86, 1, t);
        drawPanel(c, x, 1.1, pw, 0.56, 1, t);
      }
    } else if (o.kind === 'wood') {
      // Flush veneered leaf with two routed panels.
      drawPanel(c, 0.13, 0.13, W - 0.26, 0.86, 0.55, t);
      drawPanel(c, 0.13, 1.1, W - 0.26, 0.54, 0.55, t);
    } else {
      // Pressed steel: two embossed panels, a ventilation louvre, rivets.
      drawPanel(c, 0.11, 0.12, W - 0.22, 0.78, 0.8, t);
      drawPanel(c, 0.11, 1.02, W - 0.22, 0.62, 0.8, t);
      const lx = 0.24;
      const lw = W - 0.48;
      for (let i = 0; i < 7; i++) {
        const y = 1.2 + i * 0.045;
        c.fillStyle = 'rgba(0,0,0,0.55)';
        c.fillRect(lx, y, lw, 0.02);
        c.fillStyle = 'rgba(255,255,255,0.28)';
        c.fillRect(lx, y + 0.02, lw, 0.008);
      }
      c.strokeStyle = 'rgba(0,0,0,0.3)';
      c.lineWidth = 0.008;
      c.strokeRect(lx - 0.02, 1.18, lw + 0.04, 0.34);
      c.fillStyle = css(mul(b, 0.62));
      for (let i = 0; i < 9; i++) {
        const y = 0.07 + (i * (H - 0.14)) / 8;
        for (const x of [0.045, W - 0.045]) {
          c.beginPath();
          c.ellipse(x, y, 0.009, 0.009, 0, 0, Math.PI * 2);
          c.fill();
        }
      }
      // Hazard chevrons along the bottom of the upper panel.
      c.save();
      c.beginPath();
      c.rect(0.16, 0.8, W - 0.32, 0.06);
      c.clip();
      c.fillStyle = '#d9a514';
      c.fillRect(0.16, 0.8, W - 0.32, 0.06);
      c.fillStyle = '#1c1c1c';
      for (let x = 0.1; x < W; x += 0.09) {
        c.beginPath();
        c.moveTo(x, 0.86);
        c.lineTo(x + 0.045, 0.86);
        c.lineTo(x + 0.105, 0.8);
        c.lineTo(x + 0.06, 0.8);
        c.closePath();
        c.fill();
      }
      c.restore();
    }

    // Kick plate (inset from the edges: the box sides sample the leaf corner).
    const steel = o.kind === 'metal' ? hex(0x5a6066) : hex(0xb9bec2);
    const ky = H - 0.3;
    const kh = 0.25;
    const g = c.createLinearGradient(0, ky, 0, ky + kh);
    g.addColorStop(0, css(mix(steel, WHITE, 0.3)));
    g.addColorStop(0.2, css(steel));
    g.addColorStop(0.8, css(mul(steel, 0.86)));
    g.addColorStop(1, css(mul(steel, 0.7)));
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.fillRect(0.045, ky + 0.006, W - 0.09, kh);
    c.fillStyle = g;
    c.fillRect(0.045, ky, W - 0.09, kh);
    // Brushed look and scuffs.
    c.fillStyle = 'rgba(255,255,255,0.1)';
    for (let i = 0; i < 16; i++) c.fillRect(0.045, ky + p.rand(0, kh), W - 0.09, 0.004);
    c.strokeStyle = 'rgba(40,40,40,0.25)';
    c.lineWidth = 0.004;
    for (let i = 0; i < 10; i++) {
      const sx = p.rand(0.08, W - 0.3);
      const sy = ky + p.rand(0.1, kh - 0.02);
      c.beginPath();
      c.moveTo(sx, sy);
      c.lineTo(sx + p.rand(0.05, 0.2), sy + p.rand(-0.02, 0.02));
      c.stroke();
    }
    c.fillStyle = css(mul(steel, 0.5));
    for (const sx of [0.07, W - 0.07]) {
      for (const sy of [ky + 0.025, ky + kh - 0.025]) {
        c.beginPath();
        c.ellipse(sx, sy, 0.008, 0.008, 0, 0, Math.PI * 2);
        c.fill();
      }
    }

    // Handle on the right, 1.05 m above the floor.
    drawHandle(c, W - 0.085, H - 1.05, o.kind === 'metal' ? hex(0x2c2f33) : hex(0xb4b9bd));
    c.restore();
    // Grime around the handle and at the bottom of the leaf.
    const cc = p.ctx;
    let gg = cc.createRadialGradient(0.86 * n, 0.5 * n, 0, 0.86 * n, 0.5 * n, 0.16 * n);
    gg.addColorStop(0, 'rgba(60,45,30,0.1)');
    gg.addColorStop(1, 'rgba(60,45,30,0)');
    cc.fillStyle = gg;
    cc.fillRect(0.6 * n, 0.3 * n, 0.4 * n, 0.4 * n);
    gg = cc.createLinearGradient(0, n, 0, 0.8 * n);
    gg.addColorStop(0, 'rgba(40,30,20,0.14)');
    gg.addColorStop(1, 'rgba(40,30,20,0)');
    cc.fillStyle = gg;
    cc.fillRect(0, 0.8 * n, n, 0.2 * n);
  };
}

// ------------------------------------------------------------------------------- windows

/**
 * Façade window: one repeat = one French window with two casements, glazing bars and
 * curtains behind dark reflective glass (or warmly lit from inside when `lit`).
 */
export function facadeWindow(lit: boolean): Generator {
  return (p) => {
    const n = p.n;
    const c = p.ctx;
    const frame = lit ? hex(0xd8ccb2) : hex(0xeceae3);
    const frameDark = lit ? 'rgba(90,60,20,0.4)' : 'rgba(40,50,60,0.38)';
    const frameLight = lit ? 'rgba(255,250,235,0.6)' : 'rgba(255,255,255,0.85)';
    // Frame.
    c.fillStyle = css(frame);
    c.fillRect(0, 0, n, n);
    // Geometry (fractions of the texture). Vertical members are a bit wider in texture
    // space: windows are taller than wide.
    const fo = 0.05; // outer frame, left / right
    const ft = 0.04; // outer frame, top
    const fb = 0.055; // outer frame, bottom (weather bar)
    const cs = 0.036; // casement stile
    const cr = 0.028; // casement rail
    const mid = 0.5;
    const glassY0 = ft + cr;
    const glassY1 = 1 - fb - cr * 1.25;
    const panes: [number, number][] = [
      [fo + cs, mid - cs * 0.95],
      [mid + cs * 0.95, 1 - fo - cs],
    ];
    const bars = 3; // horizontal glazing bars per casement
    const barH = 0.016;

    for (let k = 0; k < 2; k++) {
      const gx0 = panes[k]![0] * n;
      const gx1 = panes[k]![1] * n;
      const gy0 = glassY0 * n;
      const gy1 = glassY1 * n;
      const gw = gx1 - gx0;
      const gh = gy1 - gy0;
      c.save();
      c.beginPath();
      c.rect(gx0, gy0, gw, gh);
      c.clip();
      if (lit) {
        // Warm room light, brightest around a lamp.
        const g = c.createRadialGradient(n * 0.5, n * 0.58, n * 0.05, n * 0.5, n * 0.55, n * 0.7);
        g.addColorStop(0, '#fff0c4');
        g.addColorStop(0.45, '#ffd98e');
        g.addColorStop(1, '#eeae58');
        c.fillStyle = g;
        c.fillRect(gx0, gy0, gw, gh);
        // Ceiling line and a piece of furniture as soft silhouettes.
        c.fillStyle = 'rgba(150,84,30,0.16)';
        c.fillRect(gx0, gy0, gw, gh * 0.1);
        c.fillStyle = 'rgba(120,64,24,0.2)';
        c.fillRect(n * 0.16, n * 0.66, n * 0.3, n * 0.3);
        c.fillStyle = 'rgba(255,250,225,0.5)';
        c.beginPath();
        c.ellipse(n * 0.62, n * 0.56, n * 0.05, n * 0.035, 0, 0, Math.PI * 2);
        c.fill();
      } else {
        // Dark interior with the sky reflected in the upper panes.
        const g = c.createLinearGradient(0, gy0, 0, gy1);
        g.addColorStop(0, '#7189a0');
        g.addColorStop(0.3, '#4d6379');
        g.addColorStop(0.7, '#33475a');
        g.addColorStop(1, '#263746');
        c.fillStyle = g;
        c.fillRect(gx0, gy0, gw, gh);
      }
      // Curtains: gathered at the outer side of each casement, with folds.
      const outer = k === 0 ? gx0 : gx1;
      const dir = k === 0 ? 1 : -1;
      c.beginPath();
      c.moveTo(outer, gy0);
      c.lineTo(outer + dir * gw * 0.78, gy0);
      c.bezierCurveTo(outer + dir * gw * 0.7, gy0 + gh * 0.35, outer + dir * gw * 0.34, gy0 + gh * 0.5, outer + dir * gw * 0.3, gy0 + gh * 0.66);
      c.bezierCurveTo(outer + dir * gw * 0.32, gy0 + gh * 0.8, outer + dir * gw * 0.42, gy0 + gh * 0.92, outer + dir * gw * 0.46, gy1);
      c.lineTo(outer, gy1);
      c.closePath();
      c.fillStyle = lit ? 'rgba(255,246,222,0.62)' : 'rgba(214,216,208,0.5)';
      c.fill();
      c.save();
      c.clip();
      const folds = 7;
      for (let i = 0; i < folds; i++) {
        const fx = outer + dir * gw * (0.05 + (i / folds) * 0.75);
        const g2 = c.createLinearGradient(fx, 0, fx + dir * gw * 0.1, 0);
        g2.addColorStop(0, lit ? 'rgba(190,120,50,0.22)' : 'rgba(20,30,40,0.3)');
        g2.addColorStop(1, lit ? 'rgba(190,120,50,0)' : 'rgba(20,30,40,0)');
        c.fillStyle = g2;
        c.fillRect(Math.min(fx, fx + dir * gw * 0.1), gy0, gw * 0.1, gh);
      }
      c.restore();
      // Tie-back.
      c.fillStyle = lit ? 'rgba(170,100,40,0.35)' : 'rgba(30,40,50,0.4)';
      c.fillRect(Math.min(outer, outer + dir * gw * 0.32), gy0 + gh * 0.645, gw * 0.32, gh * 0.022);
      if (!lit) {
        // Reflections: a diagonal sheen across the glass.
        c.fillStyle = 'rgba(200,225,245,0.1)';
        c.beginPath();
        c.moveTo(gx0 + gw * 0.15, gy1);
        c.lineTo(gx0 + gw * 0.75, gy0);
        c.lineTo(gx0 + gw * 1.05, gy0);
        c.lineTo(gx0 + gw * 0.45, gy1);
        c.closePath();
        c.fill();
        c.fillStyle = 'rgba(200,225,245,0.06)';
        c.beginPath();
        c.moveTo(gx0 - gw * 0.1, gy1 * 0.8);
        c.lineTo(gx0 + gw * 0.3, gy0);
        c.lineTo(gx0 + gw * 0.4, gy0);
        c.lineTo(gx0, gy1 * 0.8);
        c.closePath();
        c.fill();
      }
      // Shadow cast by the frame on the glass (top and outer side).
      c.fillStyle = lit ? 'rgba(120,60,10,0.2)' : 'rgba(0,10,20,0.35)';
      c.fillRect(gx0, gy0, gw, 0.012 * n);
      c.fillRect(gx0, gy0, 0.01 * n, gh);
      c.restore();

      // Glazing bars.
      for (let i = 1; i <= bars; i++) {
        const by = gy0 + (gh * i) / (bars + 1) - (barH * n) / 2;
        c.fillStyle = css(frame);
        c.fillRect(gx0, by, gw, barH * n);
        c.fillStyle = frameLight;
        c.fillRect(gx0, by, gw, Math.max(1, 0.003 * n));
        c.fillStyle = frameDark;
        c.fillRect(gx0, by + barH * n, gw, Math.max(1, 0.004 * n));
      }
      // Casement rebate: thin dark line around the glass.
      c.strokeStyle = frameDark;
      c.lineWidth = Math.max(1, 0.004 * n);
      c.strokeRect(gx0, gy0, gw, gh);
    }

    // Frame modelling: outer frame / casement step, meeting stiles, weather bar.
    const lw = Math.max(1, 0.004 * n);
    c.strokeStyle = frameDark;
    c.lineWidth = lw;
    c.strokeRect(fo * n * 0.62, ft * n * 0.62, n - fo * n * 1.24, n - (ft + fb) * n * 0.62);
    c.fillStyle = frameDark;
    c.fillRect(mid * n - lw / 2, ft * n * 0.62, lw, n - (ft + fb) * n * 0.62);
    c.fillStyle = frameLight;
    c.fillRect(mid * n + lw / 2, ft * n, lw, n - (ft + fb) * n);
    // Weather bar at the bottom.
    c.fillStyle = css(mul(frame, 0.93));
    c.fillRect(0, (1 - fb) * n, n, fb * n);
    c.fillStyle = frameLight;
    c.fillRect(0, (1 - fb) * n, n, lw);
    c.fillStyle = frameDark;
    c.fillRect(0, (1 - fb * 0.42) * n, n, lw);
    // Espagnolette handle on the meeting stile.
    c.fillStyle = lit ? '#6b5a3c' : '#8c8f90';
    c.beginPath();
    c.roundRect((mid + 0.006) * n, 0.5 * n, 0.014 * n, 0.07 * n, 0.006 * n);
    c.fill();
    c.fillStyle = frameDark;
    c.fillRect((mid + 0.02) * n, 0.5 * n, lw, 0.07 * n);

    p.mod([
      [p.cloud, 0.035],
      [p.coarse, 0.012],
    ]);
  };
}

/** Louvered wooden shutter leaf: frame, mid rail, rows of slats, strap hinges. */
export function shutter(): Generator {
  return (p) => {
    const n = p.n;
    const b = p.base;
    p.fill(b);
    p.mod([
      [p.streakV, 0.05], // vertical brush marks / grain on the frame
      [p.cloud, 0.04],
    ]);
    const c = p.ctx;
    const sx = 0.11; // stiles
    const top = 0.05;
    const bot = 0.06;
    const midY = 0.5;
    const midH = 0.045;
    const drawLouvres = (y0: number, y1: number): void => {
      const count = Math.round((y1 - y0) / 0.031);
      const h = ((y1 - y0) * n) / count;
      const x0 = sx * n;
      const w = (1 - 2 * sx) * n;
      for (let i = 0; i < count; i++) {
        const y = y0 * n + i * h;
        const g = c.createLinearGradient(0, y, 0, y + h);
        g.addColorStop(0, css(mix(b, WHITE, 0.22)));
        g.addColorStop(0.5, css(tone(b, 0.98)));
        g.addColorStop(0.78, css(mul(b, 0.74)));
        g.addColorStop(0.8, css(mul(b, 0.3)));
        g.addColorStop(1, css(mul(b, 0.42)));
        c.fillStyle = g;
        c.fillRect(x0, y, w, h);
      }
      // Shadow of the frame on the slats.
      c.fillStyle = 'rgba(0,0,0,0.28)';
      c.fillRect(x0, y0 * n, w, 0.008 * n);
      c.fillRect(x0, y0 * n, 0.012 * n, (y1 - y0) * n);
      c.strokeStyle = 'rgba(0,0,0,0.35)';
      c.lineWidth = Math.max(1, 0.004 * n);
      c.strokeRect(x0, y0 * n, w, (y1 - y0) * n);
    };
    drawLouvres(top, midY - midH / 2);
    drawLouvres(midY + midH / 2, 1 - bot);
    // Frame joints.
    c.fillStyle = 'rgba(0,0,0,0.2)';
    const lw = Math.max(1, 0.003 * n);
    for (const y of [top, midY - midH / 2, midY + midH / 2, 1 - bot]) {
      c.fillRect(0.02 * n, y * n, (sx - 0.02) * n, lw);
      c.fillRect((1 - sx) * n, y * n, (sx - 0.02) * n, lw);
    }
    // Leaf edge.
    c.strokeStyle = css(mul(b, 0.72));
    c.lineWidth = 0.022 * n;
    c.strokeRect(0.011 * n, 0.011 * n, n - 0.022 * n, n - 0.022 * n);
    c.strokeStyle = 'rgba(255,255,255,0.22)';
    c.lineWidth = lw;
    c.strokeRect(0.024 * n, 0.024 * n, n - 0.048 * n, n - 0.048 * n);
    // Wrought-iron strap hinges.
    for (const y of [0.115, 0.885]) {
      c.fillStyle = 'rgba(0,0,0,0.3)';
      c.fillRect(0.03 * n, (y + 0.004) * n, 0.62 * n, 0.02 * n);
      c.fillStyle = '#23262a';
      c.fillRect(0.03 * n, (y - 0.009) * n, 0.6 * n, 0.018 * n);
      c.beginPath();
      c.ellipse(0.63 * n, y * n, 0.035 * n, 0.014 * n, 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#5a5f66';
      for (const x of [0.1, 0.3, 0.5]) {
        c.beginPath();
        c.ellipse(x * n, y * n, 0.012 * n, 0.005 * n, 0, 0, Math.PI * 2);
        c.fill();
      }
    }
    p.mod([[p.coarse, 0.025]]);
  };
}
