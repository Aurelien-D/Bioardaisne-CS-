/**
 * Interior walls and ceilings: painted plaster, hygienic panels, suspended ceiling,
 * light panels.
 */
import { css, mix, mul, WHITE, type Generator } from '../painter';

/**
 * Painted plaster: fine roller stipple (relief), faint roller lap bands, slow unevenness
 * and a soft dirt band around the tile border, which sits at floor level (walls start at
 * multiples of the 3 m tile).
 */
export function paint(): Generator {
  return (p) => {
    const b = p.base;
    const dark = b[0] + b[1] + b[2] < 380; // saturated accent walls show a little more depth
    const k = dark ? 1.6 : 1;
    p.fill(b);
    p.mod([
      [p.stipple, 0.02 * k], // roller stipple
      [p.bumps, 0.012 * k],
      [p.streakV, 0.006 * k], // roller laps
      [p.cloud, 0.014 * k, 1.1, 1, 0.8],
      [p.patch, 0.008 * k],
      [p.grit, 0.006 * k],
    ]);
    // Dust gathering toward the skirting line (the tile border).
    p.rows((v) => {
      const g = 0.5 + 0.5 * Math.cos(2 * Math.PI * v);
      return 1.005 - 0.03 * k * g * g * g;
    });
    p.normalize();
  };
}

/** White hygienic wall panels: smooth sheets with a vertical H-profile joint every 1.2 m. */
export function labPanel(): Generator {
  return (p) => {
    const n = p.n;
    const b = p.base;
    p.fill(b);
    p.mod([
      [p.cloud, 0.01, 1.3, 1, 0.6],
      [p.stipple, 0.004],
    ]);
    p.normalize();
    const c = p.ctx;
    const panels = Math.round(p.tile / 1.2);
    const pw = n / panels;
    // Soft sheen across each sheet.
    for (let i = 0; i < panels; i++) {
      const g = c.createLinearGradient(i * pw, 0, (i + 1) * pw, 0);
      g.addColorStop(0, 'rgba(60,80,100,0.045)');
      g.addColorStop(0.3, 'rgba(60,80,100,0)');
      g.addColorStop(0.7, 'rgba(60,80,100,0)');
      g.addColorStop(1, 'rgba(60,80,100,0.045)');
      c.fillStyle = g;
      c.fillRect(i * pw, 0, pw, n);
    }
    // Joint profiles (the one at x = 0 straddles the tile border).
    const jw = Math.max(2, 0.012 * p.ppm);
    const lw = Math.max(0.8, 1.0 * p.u);
    for (let i = 0; i < panels; i++) {
      const x = i * pw;
      p.wrap(x - jw, 0, x + jw, n, (dx) => {
        const cx = x + dx;
        c.fillStyle = css(mul(b, 0.9));
        c.fillRect(cx - jw / 2, 0, jw, n);
        c.fillStyle = 'rgba(30,40,50,0.34)';
        c.fillRect(cx - jw / 2 - lw, 0, lw, n);
        c.fillRect(cx + jw / 2, 0, lw, n);
        c.fillStyle = 'rgba(255,255,255,0.6)';
        c.fillRect(cx - jw / 2, 0, lw, n);
      });
    }
  };
}

/** Suspended ceiling: 60 cm mineral-fibre tiles with pin-holes and fissures in a metal T-grid. */
export function ceilingTile(): Generator {
  return (p) => {
    const n = p.n;
    const b = p.base;
    const count = Math.round(p.tile / 0.6);
    const s = n / count;
    const grid = Math.max(2, Math.round(0.024 * p.ppm));
    // Tile bodies.
    p.fill(b);
    const c = p.ctx;
    for (let j = 0; j < count; j++) {
      for (let i = 0; i < count; i++) {
        const t = (p.rng() - 0.5) * 0.035;
        c.fillStyle = t < 0 ? `rgba(0,0,0,${-t})` : `rgba(255,255,255,${t * 2})`;
        c.fillRect(i * s, j * s, s, s);
      }
    }
    p.mod([
      [p.bumps, 0.02],
      [p.patch, 0.012, 1.2, 1, 0.7],
    ]);
    // Pin-holes: fine regular perforation plus random larger holes and short fissures.
    p.speck(p.fleck, 0.62, 0.9, mul(b, 0.62), 0.75);
    p.normalize();
    const cc = p.ctx;
    cc.fillStyle = css(mul(b, 0.5), 0.75);
    const holes = Math.round(150 * count * count);
    for (let i = 0; i < holes; i++) {
      const r = (0.6 + p.rng() * p.rng() * 1.6) * p.u;
      cc.fillRect(p.rng() * n, p.rng() * n, r, r);
    }
    cc.strokeStyle = css(mul(b, 0.52), 0.6);
    cc.lineWidth = Math.max(0.7, 1.0 * p.u);
    cc.lineCap = 'round';
    cc.beginPath();
    for (let i = 0; i < 90 * count * count; i++) {
      const x = p.rng() * n;
      const y = p.rng() * n;
      const a = p.rng() * Math.PI;
      const l = (2 + p.rng() * 6) * p.u;
      cc.moveTo(x, y);
      cc.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    }
    cc.stroke();
    // T-grid: white lacquered profiles with a shadow gap where the tile drops in.
    const gridCol = mix(b, WHITE, 0.55);
    const sh = Math.max(1, 1.5 * p.u);
    for (let i = 0; i < count; i++) {
      const t = i * s;
      p.wrap(t - grid, 0, t + grid, n, (dx) => {
        const x = t + dx;
        cc.fillStyle = 'rgba(0,0,0,0.3)';
        cc.fillRect(x - grid / 2 - sh, 0, grid + 2 * sh, n);
      });
      p.wrap(0, t - grid, n, t + grid, (_dx, dy) => {
        const y = t + dy;
        cc.fillStyle = 'rgba(0,0,0,0.3)';
        cc.fillRect(0, y - grid / 2 - sh, n, grid + 2 * sh);
      });
    }
    for (let i = 0; i < count; i++) {
      const t = i * s;
      p.wrap(t - grid, 0, t + grid, n, (dx) => {
        const x = t + dx;
        cc.fillStyle = css(gridCol);
        cc.fillRect(x - grid / 2, 0, grid, n);
        cc.fillStyle = 'rgba(0,0,0,0.1)';
        cc.fillRect(x + grid / 2 - sh * 0.7, 0, sh * 0.7, n);
      });
      p.wrap(0, t - grid, n, t + grid, (_dx, dy) => {
        const y = t + dy;
        cc.fillStyle = css(gridCol);
        cc.fillRect(0, y - grid / 2, n, grid);
        cc.fillStyle = 'rgba(0,0,0,0.1)';
        cc.fillRect(0, y + grid / 2 - sh * 0.7, n, sh * 0.7);
      });
    }
  };
}

/** LED ceiling panel (one cell of the texture = one panel): bright diffuser in a slim frame. */
export function lightPanel(): Generator {
  return (p) => {
    const n = p.n;
    const c = p.ctx;
    // Frame.
    c.fillStyle = '#c9ced3';
    c.fillRect(0, 0, n, n);
    const f = Math.round(0.03 * n);
    // Diffuser: brightest in the middle, slightly cooler toward the edges.
    const g = c.createRadialGradient(n / 2, n / 2, n * 0.1, n / 2, n / 2, n * 0.72);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.7, '#fbfdff');
    g.addColorStop(1, '#e9f1f8');
    c.fillStyle = g;
    c.fillRect(f, f, n - 2 * f, n - 2 * f);
    // Micro-prism pattern of the diffuser.
    c.fillStyle = 'rgba(190,205,220,0.16)';
    const pitch = n / 32;
    for (let i = 1; i < 32; i++) {
      c.fillRect(f, Math.round(i * pitch), n - 2 * f, Math.max(1, p.u));
      c.fillRect(Math.round(i * pitch), f, Math.max(1, p.u), n - 2 * f);
    }
    // Frame bevel.
    c.strokeStyle = 'rgba(255,255,255,0.8)';
    c.lineWidth = Math.max(1, 1.5 * p.u);
    c.strokeRect(f * 0.35, f * 0.35, n - f * 0.7, n - f * 0.7);
    c.strokeStyle = 'rgba(80,95,110,0.55)';
    c.strokeRect(f, f, n - 2 * f, n - 2 * f);
  };
}

/** Warm lamp glass: glowing opal glass, a little hotter in soft patches. */
export function lightWarm(): Generator {
  return (p) => {
    p.fill(p.base);
    p.mod([
      [p.cloud, 0.03, 0.4, 1, 2.2],
      [p.mottle, 0.012],
    ]);
    p.normalize();
  };
}
