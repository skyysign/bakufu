'use client';
import { useEffect, useRef } from 'react';
import type { Tier } from '@card-engine/config';

type Mood = Tier | 'sealed';
type Phase = 'idle' | 'charging' | 'face';
const palette: Record<Mood, [string, string, string]> = {
  sealed: ['#7c4dff', '#ff5fa2', '#c9b8ff'],
  common: ['#8f9bbf', '#5b6a96', '#e3e9ff'],
  uncommon: ['#3fb6bb', '#68c9cc', '#c8fff8'],
  rare: ['#8a5cf6', '#b58aee', '#efe2ff'],
  epic: ['#e0559a', '#f18cb4', '#ffe0ee'],
  legendary: ['#f2b84b', '#f7d27d', '#fff6d8'],
};
const intensity: Record<Mood, number> = {
  sealed: 0.55,
  common: 0.6,
  uncommon: 0.75,
  rare: 0.95,
  epic: 1.15,
  legendary: 1.4,
};
type Particle = { angle: number; radius: number; speed: number; size: number; depth: number; tint: number; burst: number };
type Ring = { born: number; strength: number };

function rgba(hex: string, alpha: number) {
  const value = parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${Math.max(0, Math.min(1, alpha))})`;
}

/**
 * Animated background for the opening room: an aurora glow and a particle
 * field that drifts while waiting, swirls inward while a pack charges and
 * bursts outward (with shockwave rings, and light rays for epic/legendary)
 * when a card arrives. Decorative only; not rendered for reduced motion.
 */
export function RevealBackdrop({ tier, phase }: { tier: Mood; phase: Phase }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const state = useRef({ tier, phase, changedAt: 0 });
  useEffect(() => {
    const current = state.current;
    if (current.tier !== tier || current.phase !== phase)
      state.current = { tier, phase, changedAt: performance.now() };
  }, [tier, phase]);
  useEffect(() => {
    const element = canvas.current;
    if (!element || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const context = element.getContext('2d');
    if (!context) return;
    let width = 0,
      height = 0,
      frame = 0,
      last = performance.now(),
      seenChange = -1;
    const particles: Particle[] = [];
    const rings: Ring[] = [];
    const resize = () => {
      const ratio = Math.min(1.5, window.devicePixelRatio || 1);
      width = element.clientWidth;
      height = element.clientHeight;
      element.width = Math.max(1, Math.round(width * ratio));
      element.height = Math.max(1, Math.round(height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const wanted = Math.round(Math.min(240, Math.max(70, (width * height) / 5200)));
      while (particles.length < wanted) particles.push(spawn(Math.random()));
      particles.length = wanted;
    };
    const spawn = (distance: number): Particle => ({
      angle: Math.random() * Math.PI * 2,
      radius: 0.08 + distance * 0.9,
      speed: 0.4 + Math.random() * 0.9,
      size: 0.6 + Math.random() * 1.9,
      depth: 0.35 + Math.random() * 0.65,
      tint: Math.random(),
      burst: 0,
    });
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();

    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (document.visibilityState === 'hidden') return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const { tier: mood, phase: mode, changedAt } = state.current;
      const colors = palette[mood],
        power = intensity[mood],
        since = (now - changedAt) / 1000;
      if (changedAt !== seenChange) {
        seenChange = changedAt;
        if (mode === 'face') {
          const count = mood === 'legendary' ? 3 : mood === 'epic' ? 2 : 1;
          for (let i = 0; i < count; i++) rings.push({ born: now + i * 160, strength: power });
          for (const particle of particles) particle.burst = (0.6 + Math.random()) * power;
        }
      }
      const cx = width / 2,
        cy = height * 0.46,
        reach = Math.hypot(width, height) * 0.55;
      context.globalCompositeOperation = 'source-over';
      context.clearRect(0, 0, width, height);
      context.globalCompositeOperation = 'lighter';

      // Aurora: two slow, tier-tinted glows plus a pulse during charging.
      const t = now / 1000;
      const charge = mode === 'charging' ? Math.min(1, since / 1.6) : 0;
      const flash = mode === 'face' ? Math.max(0, 1 - since / 0.9) : 0;
      for (const [index, color] of [colors[0], colors[1]].entries()) {
        const x = cx + Math.cos(t * 0.13 + index * 2.4) * width * 0.28,
          y = cy + Math.sin(t * 0.17 + index * 1.7) * height * 0.22,
          radius = reach * (0.55 + 0.1 * Math.sin(t * 0.4 + index));
        const glow = context.createRadialGradient(x, y, 0, x, y, radius);
        glow.addColorStop(0, rgba(color, 0.2 * power + 0.12 * charge));
        glow.addColorStop(1, rgba(color, 0));
        context.fillStyle = glow;
        context.fillRect(0, 0, width, height);
      }
      const core = context.createRadialGradient(cx, cy, 0, cx, cy, reach * (0.25 + charge * 0.25));
      core.addColorStop(0, rgba(colors[2], 0.08 + charge * 0.22 * power + flash * 0.55 * power));
      core.addColorStop(1, rgba(colors[0], 0));
      context.fillStyle = core;
      context.fillRect(0, 0, width, height);

      // Light rays for epic and legendary arrivals.
      if (mode === 'face' && (mood === 'epic' || mood === 'legendary')) {
        const rays = mood === 'legendary' ? 14 : 9,
          fade = Math.min(1, since / 0.25) * (0.55 + 0.45 * Math.max(0, 1 - since / 4));
        for (let i = 0; i < rays; i++) {
          const angle = (i / rays) * Math.PI * 2 + t * (mood === 'legendary' ? 0.12 : 0.08);
          const spread = 0.09;
          const ray = context.createLinearGradient(cx, cy, cx + Math.cos(angle) * reach, cy + Math.sin(angle) * reach);
          ray.addColorStop(0, rgba(colors[2], 0.18 * fade));
          ray.addColorStop(1, rgba(colors[1], 0));
          context.fillStyle = ray;
          context.beginPath();
          context.moveTo(cx, cy);
          context.arc(cx, cy, reach, angle - spread, angle + spread);
          context.closePath();
          context.fill();
        }
      }

      // Shockwave rings.
      for (let i = rings.length - 1; i >= 0; i--) {
        const age = (now - rings[i].born) / 1000;
        if (age < 0) continue;
        if (age > 1.4) {
          rings.splice(i, 1);
          continue;
        }
        const radius = 20 + age * reach * 0.9,
          alpha = (1 - age / 1.4) * 0.55 * Math.min(1, rings[i].strength);
        context.strokeStyle = rgba(colors[2], alpha);
        context.lineWidth = 2 + (1 - age / 1.4) * 10;
        context.beginPath();
        context.arc(cx, cy, radius, 0, Math.PI * 2);
        context.stroke();
      }

      // Particles: drift outward when idle, spiral inward while charging,
      // fly outward after an arrival burst.
      const inward = mode === 'charging' ? 0.18 + charge * 0.9 * power : 0;
      const spin = mode === 'charging' ? 0.25 + charge * 2.4 * power : 0.05;
      for (const particle of particles) {
        particle.angle += spin * dt * particle.depth * (particle.tint > 0.5 ? 1 : 0.8);
        let radial = (0.012 + 0.01 * particle.speed) * particle.depth - inward * particle.speed;
        if (particle.burst > 0) {
          radial += particle.burst * 1.4;
          particle.burst = Math.max(0, particle.burst - dt * 1.6);
        }
        const previous = particle.radius;
        particle.radius += radial * dt;
        if (particle.radius > 1.1 || particle.radius < 0.02)
          Object.assign(particle, spawn(mode === 'charging' ? 0.85 + Math.random() * 0.15 : Math.random() * 0.3));
        const x = cx + Math.cos(particle.angle) * particle.radius * reach,
          y = cy + Math.sin(particle.angle) * particle.radius * reach * 0.82;
        const color = particle.tint < 0.45 ? colors[2] : particle.tint < 0.8 ? colors[1] : colors[0];
        const alpha = (0.25 + 0.55 * particle.depth) * Math.min(1, power) * (0.5 + 0.5 * Math.sin(t * 2 + particle.tint * 9) ** 2);
        const moving = Math.abs(particle.radius - previous) * reach;
        if (moving > 1.5) {
          // Streaks while charging or bursting.
          const px = cx + Math.cos(particle.angle) * previous * reach,
            py = cy + Math.sin(particle.angle) * previous * reach * 0.82;
          context.strokeStyle = rgba(color, alpha * 0.8);
          context.lineWidth = particle.size * particle.depth;
          context.beginPath();
          context.moveTo(px, py);
          context.lineTo(x, y);
          context.stroke();
        }
        context.fillStyle = rgba(color, alpha);
        context.beginPath();
        context.arc(x, y, particle.size * particle.depth * (mood === 'legendary' ? 1.25 : 1), 0, Math.PI * 2);
        context.fill();
        // Legendary glitter twinkles as small crosses.
        if (mood === 'legendary' && mode === 'face' && particle.tint > 0.88) {
          const twinkle = particle.size * 3 * (0.5 + 0.5 * Math.sin(t * 6 + particle.angle * 5));
          context.strokeStyle = rgba('#fff6d8', alpha);
          context.lineWidth = 1;
          context.beginPath();
          context.moveTo(x - twinkle, y);
          context.lineTo(x + twinkle, y);
          context.moveTo(x, y - twinkle);
          context.lineTo(x, y + twinkle);
          context.stroke();
        }
      }
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);
  return <canvas ref={canvas} className="reveal-backdrop" aria-hidden="true" />;
}
