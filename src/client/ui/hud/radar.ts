/**
 * Radar (top left): circular mini-map centred on the player and rotating with
 * the view (forward = up).
 *
 * `setMap()` renders the map once into an offscreen canvas: a horizontal slice
 * of the collision solids at 1 m above the ground (walls and tall furniture),
 * over the footprint of floors and low cover. Each frame that slice is drawn
 * rotated into the visible canvas, then the blips are drawn upright on top.
 */
import type { HudFrame } from '../../core/contracts';
import { TEAMS } from '../../../shared/identity';
import type { MapData, ZoneDef } from '../../../shared/maps/types';
import type { GameModeId, TeamId } from '../../../shared/types';
import { h } from '../dom';
import { canvasDpr, clamp } from './util';

/** Metres from the centre to the rim. */
const RANGE = 28;
/** Height of the slice (m): what crosses it is a wall. */
const SLICE_Y = 1.0;
/** Solids whose top is below this are floors; between this and the slice, low cover. */
const FLOOR_TOP = 0.4;
/** Resolution of the pre-rendered map. */
const MAX_PX_PER_M = 8;
const MAX_MAP_PX = 2048;

const COL = {
  bg: 'rgba(5, 17, 32, 0.8)',
  floor: '#1c3858',
  low: '#3d6791',
  wall: '#dbeafa',
  site: 'rgba(255, 194, 74, 0.3)',
  siteLine: 'rgba(255, 194, 74, 0.85)',
  extract: 'rgba(69, 214, 160, 0.28)',
  extractLine: 'rgba(69, 214, 160, 0.85)',
  amber: '#ffc24a',
  green: '#45d6a0',
  ink: '#04101f',
  white: '#ffffff',
} as const;

const KIND_INDEX: Record<string, number> = { player: 1, bomb: 2, sample: 3, site: 4 };

export interface Radar {
  el: HTMLElement;
  setMap(map: MapData): void;
  update(f: HudFrame, aspect: number): void;
  dispose(): void;
}

export function createRadar(): Radar {
  const canvas = h('canvas', { class: 'bh-radar__canvas' });
  const el = h('div', { class: 'bh-radar', hidden: true }, canvas, h('i', { class: 'bh-radar__ring' }));
  const ctx = canvas.getContext('2d');

  // --- Pre-rendered map ------------------------------------------------------------
  let mapCanvas: HTMLCanvasElement | null = null;
  let mapX = 0;
  let mapZ = 0;
  let mapW = 0;
  let mapD = 0;
  let zones: ZoneDef[] = [];

  // --- Visible canvas ----------------------------------------------------------------
  let cssSize = 0;
  let dirty = true;
  let shown = false;
  let lastSig = NaN;

  const observer =
    typeof ResizeObserver === 'function'
      ? new ResizeObserver((entries) => {
          const r = entries[0]?.contentRect;
          if (!r || r.width <= 0) return;
          if (Math.abs(r.width - cssSize) > 0.25) {
            cssSize = r.width;
            const px = Math.max(32, Math.round(cssSize * canvasDpr()));
            if (canvas.width !== px) {
              canvas.width = px;
              canvas.height = px;
            }
            dirty = true;
          }
        })
      : null;
  observer?.observe(el);

  function zoneLabel(z: ZoneDef): string {
    if (z.kind === 'extract') return 'EX';
    return z.id.length <= 2 ? z.id.toUpperCase() : z.id.charAt(0).toUpperCase();
  }

  function draw(f: HudFrame, aspect: number): void {
    const r = f.radar;
    if (!ctx || !r) return;
    const size = canvas.width;
    const c = size / 2;
    const R = c - 1;
    const ppm = R / RANGE;
    const cos = Math.cos(r.yaw);
    const sin = Math.sin(r.yaw);
    const unit = size / 184; // 1 at the reference size (11.5 rem at 1080p)

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, size, size);

    // --- Map, rotated around the player ---
    ctx.save();
    ctx.beginPath();
    ctx.arc(c, c, R, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, size, size);
    ctx.translate(c, c);
    ctx.rotate(r.yaw);
    ctx.scale(ppm, ppm);
    ctx.translate(-r.x, -r.z);
    if (mapCanvas) {
      ctx.imageSmoothingEnabled = true;
      ctx.globalAlpha = 0.92;
      ctx.drawImage(mapCanvas, mapX, mapZ, mapW, mapD);
      ctx.globalAlpha = 1;
    }
    // Objective areas of the current mode.
    const zoneKind = f.mode === 'defuse' ? 'site' : f.mode === 'secure' ? 'extract' : '';
    if (zoneKind) {
      ctx.lineWidth = 0.35;
      for (const z of zones) {
        if (z.kind !== zoneKind) continue;
        ctx.fillStyle = zoneKind === 'site' ? COL.site : COL.extract;
        ctx.strokeStyle = zoneKind === 'site' ? COL.siteLine : COL.extractLine;
        ctx.fillRect(z.min.x, z.min.z, z.max.x - z.min.x, z.max.z - z.min.z);
        ctx.strokeRect(z.min.x, z.min.z, z.max.x - z.min.x, z.max.z - z.min.z);
      }
    }
    ctx.restore();

    // --- Field of view ---
    const half = Math.atan(Math.tan((clamp(f.fov, 10, 150) * Math.PI) / 360) * aspect);
    const coneR = R * 0.82;
    const grad = ctx.createRadialGradient(c, c, 0, c, c, coneR);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.26)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.arc(c, c, coneR, -Math.PI / 2 - half, -Math.PI / 2 + half);
    ctx.closePath();
    ctx.fill();

    // World → radar (same rotation as the map).
    const toX = (wx: number, wz: number): number => c + ((wx - r.x) * cos - (wz - r.z) * sin) * ppm;
    const toY = (wx: number, wz: number): number => c + ((wx - r.x) * sin + (wz - r.z) * cos) * ppm;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';

    const label = (text: string, x: number, y: number, px: number, color: string): void => {
      ctx.font = `700 ${px}px Inter, "Segoe UI", system-ui, sans-serif`;
      ctx.lineWidth = Math.max(2, px * 0.28);
      ctx.strokeStyle = COL.ink;
      ctx.strokeText(text, x, y + px * 0.04);
      ctx.fillStyle = color;
      ctx.fillText(text, x, y + px * 0.04);
    };

    /** Clamp a point to the rim; returns the scale to draw it with (smaller on the rim). */
    const place = (wx: number, wz: number, margin: number, out: { x: number; y: number }): number => {
      const dx = toX(wx, wz) - c;
      const dy = toY(wx, wz) - c;
      const d = Math.hypot(dx, dy);
      const max = R - margin;
      if (d <= max) {
        out.x = c + dx;
        out.y = c + dy;
        return 1;
      }
      out.x = c + (dx / d) * max;
      out.y = c + (dy / d) * max;
      return 0.72;
    };
    const p = { x: 0, y: 0 };

    // --- Zone letters (when no 'site' blip already marks the zone) ---
    const claimed = new Set<ZoneDef>();
    if (zoneKind) {
      for (const b of r.blips) {
        if (b.kind !== 'site') continue;
        const z = nearestZone(b.x, b.z, zoneKind);
        if (z) claimed.add(z);
      }
      for (const z of zones) {
        if (z.kind !== zoneKind || claimed.has(z)) continue;
        const zx = (z.min.x + z.max.x) / 2;
        const zz = (z.min.z + z.max.z) / 2;
        const sx = toX(zx, zz);
        const sy = toY(zx, zz);
        if (Math.hypot(sx - c, sy - c) > R - 9 * unit) continue;
        label(zoneLabel(z), sx, sy, 13 * unit, zoneKind === 'site' ? COL.amber : COL.green);
      }
    }

    // --- Blips: objectives first, players on top ---
    for (let pass = 0; pass < 2; pass++) {
      for (const b of r.blips) {
        const isPlayer = b.kind === 'player';
        if (isPlayer !== (pass === 1)) continue;
        if (b.kind === 'site') {
          const z = nearestZone(b.x, b.z, zoneKind || 'site');
          const k = place(b.x, b.z, 10 * unit, p);
          const rad = 8.5 * unit * (k < 1 ? 0.85 : 1);
          const color = z?.kind === 'extract' ? COL.green : COL.amber;
          ctx.beginPath();
          ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(4, 16, 31, 0.72)';
          ctx.fill();
          ctx.lineWidth = 1.6 * unit;
          ctx.strokeStyle = color;
          ctx.stroke();
          label(z ? zoneLabel(z) : '•', p.x, p.y, 10.5 * unit * (k < 1 ? 0.85 : 1), color);
        } else if (b.kind === 'bomb') {
          const k = place(b.x, b.z, 8 * unit, p);
          const s = 6.2 * unit * (k < 1 ? 0.85 : 1);
          // Dossier: amber folder with an exclamation mark.
          ctx.beginPath();
          ctx.roundRect(p.x - s, p.y - s * 0.78, s * 2, s * 1.56, s * 0.25);
          ctx.fillStyle = COL.amber;
          ctx.fill();
          ctx.lineWidth = 1.4 * unit;
          ctx.strokeStyle = COL.ink;
          ctx.stroke();
          ctx.fillStyle = COL.ink;
          ctx.fillRect(p.x - s * 0.17, p.y - s * 0.5, s * 0.34, s * 0.62);
          ctx.fillRect(p.x - s * 0.17, p.y + s * 0.24, s * 0.34, s * 0.3);
        } else if (b.kind === 'sample') {
          const k = place(b.x, b.z, 8 * unit, p);
          const s = 5.4 * unit * (k < 1 ? 0.85 : 1);
          // Cooler: light box with a cross.
          ctx.beginPath();
          ctx.roundRect(p.x - s, p.y - s, s * 2, s * 2, s * 0.3);
          ctx.fillStyle = '#d6efff';
          ctx.fill();
          ctx.lineWidth = 1.4 * unit;
          ctx.strokeStyle = COL.ink;
          ctx.stroke();
          ctx.fillStyle = '#1f6fb8';
          ctx.fillRect(p.x - s * 0.2, p.y - s * 0.62, s * 0.4, s * 1.24);
          ctx.fillRect(p.x - s * 0.62, p.y - s * 0.2, s * 1.24, s * 0.4);
        } else {
          const k = place(b.x, b.z, 6 * unit, p);
          const mate = b.team === f.team;
          const rad = 4.6 * unit * k;
          ctx.globalAlpha = k < 1 ? 0.85 : 1;
          ctx.beginPath();
          if (mate) ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
          else {
            // Enemies are diamonds: readable without relying on colour alone.
            const d = rad * 1.3;
            ctx.moveTo(p.x, p.y - d);
            ctx.lineTo(p.x + d, p.y);
            ctx.lineTo(p.x, p.y + d);
            ctx.lineTo(p.x - d, p.y);
            ctx.closePath();
          }
          ctx.fillStyle = teamColor(b.team);
          ctx.fill();
          ctx.lineWidth = 1.5 * unit;
          ctx.strokeStyle = mate ? 'rgba(255, 255, 255, 0.95)' : COL.ink;
          ctx.stroke();
          if (!mate) {
            ctx.lineWidth = 0.9 * unit;
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
        }
      }
    }

    // --- Local player ---
    const a = 6.4 * unit;
    ctx.beginPath();
    ctx.moveTo(c, c - a * 1.25);
    ctx.lineTo(c + a * 0.92, c + a * 0.95);
    ctx.lineTo(c, c + a * 0.42);
    ctx.lineTo(c - a * 0.92, c + a * 0.95);
    ctx.closePath();
    ctx.fillStyle = COL.white;
    ctx.fill();
    ctx.lineWidth = 1.5 * unit;
    ctx.strokeStyle = COL.ink;
    ctx.stroke();

    // --- North ---
    const nr = R - 9 * unit;
    label('N', c + sin * nr, c - cos * nr, 9.5 * unit, 'rgba(210, 230, 250, 0.9)');
  }

  function teamColor(team: TeamId): string {
    return team === 0 ? '#3d93e6' : team === 1 ? '#f0414c' : TEAMS[2].css;
  }

  function nearestZone(x: number, z: number, kind: string): ZoneDef | null {
    let best: ZoneDef | null = null;
    let bestD = Infinity;
    for (const zn of zones) {
      if (zn.kind !== kind) continue;
      const dx = Math.max(zn.min.x - x, 0, x - zn.max.x);
      const dz = Math.max(zn.min.z - z, 0, z - zn.max.z);
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = zn;
      }
    }
    return best;
  }

  function signature(f: HudFrame, aspect: number): number {
    const r = f.radar!;
    let sig = r.x * 3.1 + r.z * 7.3 + r.yaw * 113.7 + f.fov * 0.37 + aspect + f.team * 17 + modeIndex(f.mode) * 29 + r.blips.length * 1009;
    for (let i = 0; i < r.blips.length; i++) {
      const b = r.blips[i]!;
      sig += (b.x * (i + 1.37) + b.z * (i + 2.11)) * 1.7 + b.team * 3.7 * (i + 1) + (KIND_INDEX[b.kind] ?? 0) * 5.3 * (i + 1);
    }
    return sig;
  }

  const modeIndex = (m: GameModeId): number => (m === 'tdm' ? 0 : m === 'defuse' ? 1 : 2);

  return {
    el,

    setMap(map) {
      zones = map.zones.filter((z) => z.kind === 'site' || z.kind === 'extract');
      const pad = 1;
      mapX = map.bounds.min.x - pad;
      mapZ = map.bounds.min.z - pad;
      mapW = Math.max(1, map.bounds.max.x - map.bounds.min.x + pad * 2);
      mapD = Math.max(1, map.bounds.max.z - map.bounds.min.z + pad * 2);
      const scale = Math.min(MAX_PX_PER_M, MAX_MAP_PX / Math.max(mapW, mapD));
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.ceil(mapW * scale));
      cv.height = Math.max(1, Math.ceil(mapD * scale));
      const g = cv.getContext('2d');
      if (g) {
        g.setTransform(scale, 0, 0, scale, -mapX * scale, -mapZ * scale);
        g.lineJoin = 'miter';
        // Three passes so that walls always end up on top of floors and low cover.
        for (let pass = 0; pass < 3; pass++) {
          g.fillStyle = pass === 0 ? COL.floor : pass === 1 ? COL.low : COL.wall;
          g.strokeStyle = g.fillStyle;
          // Thin partitions get a minimum thickness so they survive the down-scaling.
          g.lineWidth = pass === 2 ? 0.28 : 0;
          for (const s of map.solids) {
            if (s.min.y >= SLICE_Y) continue; // entirely above the slice (ceilings, upper floors)
            const kind = s.max.y > SLICE_Y ? 2 : s.max.y > FLOOR_TOP ? 1 : 0;
            if (kind !== pass) continue;
            const w = s.max.x - s.min.x;
            const d = s.max.z - s.min.z;
            if (w <= 0 || d <= 0) continue;
            g.fillRect(s.min.x, s.min.z, w, d);
            if (pass === 2) g.strokeRect(s.min.x, s.min.z, w, d);
          }
        }
      }
      mapCanvas = cv;
      dirty = true;
    },

    update(f, aspect) {
      const on = f.radar !== null;
      if (on !== shown) {
        shown = on;
        el.hidden = !on;
        dirty = true;
      }
      if (!on || cssSize <= 0) return;
      const sig = signature(f, aspect);
      if (!dirty && sig === lastSig) return;
      dirty = false;
      lastSig = sig;
      draw(f, aspect);
    },

    dispose() {
      observer?.disconnect();
    },
  };
}
