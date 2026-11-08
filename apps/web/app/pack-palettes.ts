import type { CSSProperties } from 'react';
import type { PackMotif } from '@card-engine/core';

// Original wrapper palettes per pack theme: light foil edge, body color, deep
// shadow, ink for print, and an accent for the emblem glow and holo sheen.
const palettes: Record<PackMotif, [string, string, string, string, string]> = {
  collection: ['#f3dcff', '#7a4fd0', '#170f2d', '#efdcff', '#ff7ac6'],
  battle: ['#ffd2c2', '#c2412d', '#240b0e', '#ffc9b5', '#ff9a3d'],
  voyage: ['#cdf6ff', '#2582a6', '#091d2b', '#bdefff', '#ffd36b'],
  fantasy: ['#d9ffe9', '#2f9a6b', '#0b241d', '#c8f7de', '#a78bff'],
  romance: ['#ffe0ec', '#d0537f', '#290f1e', '#ffd0e2', '#ffb3c7'],
  mystery: ['#e2dcff', '#4b3f9a', '#0f0c22', '#d9d1ff', '#7fe3ff'],
  future: ['#d4fbff', '#1aa6c4', '#061923', '#b9f6ff', '#ff4fd8'],
  spirit: ['#efe4ff', '#8a6bd1', '#16112a', '#e9dcff', '#9ff3e4'],
  school: ['#e3f0ff', '#4d7fd8', '#0e162d', '#dbe8ff', '#ffd76a'],
  sports: ['#ffe6c9', '#e27a1f', '#261307', '#ffdcb7', '#5fd1ff'],
  everyday: ['#f4f1e4', '#7a9a6d', '#171d15', '#ebe8d8', '#ffc78a'],
  comedy: ['#fff4c2', '#e3a51b', '#271d07', '#ffefb8', '#ff6fae'],
  drama: ['#f1dde3', '#8c3550', '#1e0e17', '#ecd3db', '#d7dce8'],
  music: ['#ffd9f6', '#b13bc7', '#190a22', '#ffcff4', '#6ab8ff'],
  night: ['#dfe6ff', '#33407a', '#080c1d', '#d3dcff', '#f2e6a8'],
  mecha: ['#e3ecf2', '#5b7487', '#0e141a', '#d8e3ea', '#ffb21f'],
  isekai: ['#dcfff8', '#3bb3a3', '#0d1d24', '#c8fbf2', '#b38cff'],
  shonen: ['#ffe2c6', '#e0482f', '#250c0a', '#ffd6bd', '#ffd23f'],
  shojo: ['#ffe6f6', '#e06fb8', '#271124', '#ffd8ef', '#c9a6ff'],
  seinen: ['#dfe7e8', '#3f6a72', '#0c1416', '#d3dfe1', '#9fe0d0'],
  josei: ['#f6e1f0', '#9a4f86', '#211120', '#f0d6ea', '#ffc2b8'],
  magical: ['#fbe3ff', '#c45be0', '#1b0e2a', '#f6d6ff', '#7fd8ff'],
  historical: ['#f5e7cc', '#9c7440', '#20170e', '#efdcbf', '#e8c46a'],
  custom: ['#f3dcff', '#7a4fd0', '#170f2d', '#efdcff', '#ff7ac6'],
};

/** CSS variables that theme a pack wrapper (see pack-premium.css). */
// Sigil shapes used when a pack has no explicit theme.
const sigilThemes: Record<string, PackMotif> = {
  duel: 'battle',
  petal: 'romance',
  circuit: 'future',
  moon: 'night',
  portal: 'isekai',
  star: 'collection',
};
export function packPaletteStyle(theme: PackMotif | undefined, sigil: string): CSSProperties {
  const key = theme && theme in palettes ? theme : (sigilThemes[sigil] ?? 'collection');
  const [light, color, dark, ink, accent] = palettes[key];
  return {
    '--wrapper-light': light,
    '--wrapper-color': color,
    '--wrapper-dark': dark,
    '--wrapper-ink': ink,
    '--wrapper-accent': accent,
  } as CSSProperties;
}
