import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { PackMotif } from '@card-engine/core';
import './pack-art.css';
import './pack-premium.css';
import { packPaletteStyle } from './pack-palettes';
import {
  providerArtworkSchema,
  type ProviderArtwork,
} from '../../../packages/importers/src/artwork';
import {
  artworkFailed,
  demoPortraitAtlas,
  holdPreparedArtwork,
  portraitAssetSource,
  preparedArtworkImage,
  preparedArtworkState,
} from './opening-assets';

export type IconName =
  | 'packs'
  | 'collection'
  | 'market'
  | 'trades'
  | 'ranks'
  | 'wishlist'
  | 'gem'
  | 'spark'
  | 'arrow'
  | 'chevron'
  | 'user'
  | 'logout'
  | 'settings'
  | 'shield'
  | 'download'
  | 'refresh'
  | 'plus'
  | 'clock'
  | 'info'
  | 'search'
  | 'close'
  | 'check'
  | 'recycle'
  | 'copy'
  | 'tag'
  | 'lock'
  | 'grid';
const paths: Record<IconName, string> = {
  packs: 'M5 4h14v16H5z M5 8h14 M9 12l3-2 3 2-3 5z',
  collection: 'M4 5h6v7H4z M14 5h6v7h-6z M4 16h6v4H4z M14 16h6v4h-6z',
  market: 'M3 9l3-5h12l3 5 M4 9v11h16V9 M3 9c0 4 5 4 6 0 0 4 6 4 6 0 1 4 6 4 6 0 M9 20v-6h6v6',
  trades: 'M4 7h15l-4-4 M20 17H5l4 4 M19 7l-4 4 M5 17l4-4',
  ranks: 'M3 6l5 5 4-8 4 8 5-5-3 13H6z M6 22h12',
  wishlist: 'M12 3l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z',
  gem: 'M6 4h12l4 6-10 12L2 10z M2 10h20 M6 4l6 18 6-18',
  spark: 'M12 2l3 7 7 3-7 3-3 7-3-7-7-3 7-3z',
  arrow: 'M4 12h16 M14 6l6 6-6 6',
  chevron: 'M6 9l6 6 6-6',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6',
  logout: 'M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3 M16 17l5-5-5-5 M21 12H9',
  settings: 'M4 7h9 M17 7h3 M15 5v4 M4 17h3 M11 17h9 M9 15v4',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z M9 12l2 2 4-4',
  download: 'M12 4v11 M7 10l5 5 5-5 M5 20h14',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7 M20 4v7h-7',
  plus: 'M12 5v14 M5 12h14',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 7v5l3 2',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 11v6 M12 7.5v.5',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M20 20l-4-4',
  close: 'M6 6l12 12 M18 6L6 18',
  check: 'M5 12l5 5 9-10',
  recycle:
    'M3 12a9 9 0 0 1 15-6.7L21 8 M21 3v5h-5 M21 12a9 9 0 0 1-15 6.7L3 16 M3 21v-5h5',
  copy: 'M9 9h11v11H9z M5 15H4V4h11v1',
  tag: 'M3 12l9-9h8v8l-9 9z M16 8h.01',
  lock: 'M6 11h12v9H6z M8 11V8a4 4 0 0 1 8 0v3',
  grid: 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z',
};
export function GameIcon({ name, className = '' }: { name: IconName; className?: string }) {
  return (
    <svg
      className={`game-icon ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
// Original vector portraits. The catalog's stable identity selects a palette;
// these are engine artwork, never fetched character images or provider assets.
function VectorPortrait({ seed, variant = 0 }: { seed: string; variant?: number }) {
  const uid = useId().replaceAll(':', '');
  const value = Array.from(seed).reduce((sum, c) => sum + c.charCodeAt(0), variant * 19);
  const palette = [
    ['#9c7bff', '#392267', '#e7ceff'],
    ['#53d5d1', '#183f5b', '#c1fbff'],
    ['#faac6c', '#6a314e', '#ffdfba'],
    ['#f884bf', '#4c275c', '#ffd7ec'],
    ['#7baaf4', '#283566', '#dbeaff'],
    ['#a8e5a2', '#234c46', '#e5ffd8'],
  ][value % 6];
  const [accent, dark, light] = palette;
  const longHair = value % 2 === 0;
  return (
    <svg
      className="character-portrait"
      viewBox="0 0 320 360"
      role="presentation"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`${uid}-bg`} x2="0.8" y2="1">
          <stop stopColor={dark} />
          <stop offset="1" stopColor="#101522" />
        </linearGradient>
        <linearGradient id={`${uid}-hair`} x2="0.6" y2="1">
          <stop stopColor={accent} />
          <stop offset=".7" stopColor={dark} />
          <stop offset="1" stopColor="#12101f" />
        </linearGradient>
        <linearGradient id={`${uid}-coat`} x2="0.8" y2="1">
          <stop stopColor={dark} />
          <stop offset="1" stopColor="#101323" />
        </linearGradient>
        <radialGradient id={`${uid}-halo`}>
          <stop stopColor={accent} stopOpacity=".5" />
          <stop offset="1" stopColor={accent} stopOpacity="0" />
        </radialGradient>
      </defs>
      <path fill={`url(#${uid}-bg)`} d="M0 0h320v360H0z" />
      <circle cx="173" cy="116" r="160" fill={`url(#${uid}-halo)`} />
      <g fill="none" stroke={accent} opacity=".22">
        <circle cx="160" cy="152" r="113" />
        <circle cx="160" cy="152" r="126" strokeDasharray="3 12" />
        <path d="M0 298l320-198 M0 328l320-198 M0 358l320-198" />
      </g>
      <path
        d={
          longHair
            ? 'M90 98Q99 38 162 42q82 5 79 107l14 145-45 22-113-24-25-13 15-99z'
            : 'M87 113Q76 56 141 38l42 2 49 35 12 70-33 48-114-6-21-33z'
        }
        fill={`url(#${uid}-hair)`}
      />
      <path d="M137 218l-1 39 25 30 28-32-6-41" fill="#e1b6ad" />
      <path
        d="M49 360q-4-69 55-100l32-10 25 25 27-26 36 16q54 29 55 95"
        fill={`url(#${uid}-coat)`}
        stroke={accent}
        strokeOpacity=".35"
      />
      <path
        d="M127 247l34 30-22 53-34-61 M194 247l-33 30 22 53 35-61"
        fill={dark}
        stroke={accent}
        strokeOpacity=".7"
      />
      <path d="M148 277h26l-7 15 10 68h-29l10-68z" fill={accent} opacity=".8" />
      <path d="M108 133q-12-7-9 16l15 17 M209 133q14-8 10 16l-14 17" fill="#deb0aa" />
      <path d="M106 102q17-35 60-30 49 4 48 45l-10 61q-5 37-43 51-39-13-48-50z" fill="#f0c9bd" />
      <path
        d="M108 143l31-8 17 7 M172 141l18-7 20 8"
        fill="none"
        stroke="#654d67"
        strokeWidth="2.5"
      />
      <path d="M118 151q14-11 29 0-10 19-26 4 M176 151q15-11 29 0-6 18-23 5" fill="#fff5ef" />
      <ellipse cx="134" cy="153" rx="7" ry="10" fill={accent} />
      <ellipse cx="190" cy="153" rx="7" ry="10" fill={accent} />
      <path d="M131 149v8 M188 149v8" stroke="#231d36" strokeWidth="3" />
      <g fill="white">
        <circle cx="136" cy="149" r="2.6" />
        <circle cx="192" cy="149" r="2.6" />
      </g>
      <path
        d="M117 150q15-11 31 0 M174 150q18-12 31 0"
        fill="none"
        stroke="#33263f"
        strokeWidth="3"
      />
      <path
        d="M160 162l-3 13 5 1 M150 194q11 6 22-1"
        fill="none"
        stroke="#b57e7e"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d={
          longHair
            ? 'M100 131q0-70 61-66 48 2 54 56l-26-15 1-17-14 28-19-13-4-19-22 45-5-26-18 39z'
            : 'M95 139q-15-42 26-70 39-23 68-1l23 19 10 53-28-22 1-25-17 36-14-26-8 29-17-34-21 48-7-27z'
        }
        fill={`url(#${uid}-hair)`}
      />
      <path
        d="M119 88q15-18 30-16 M181 80l19 21 M102 184l4 49"
        stroke={light}
        strokeWidth="3"
        opacity=".55"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M225 200l4 8 9 2-7 6 1 9-8-5-8 4 2-9-6-7 9-1z M61 112l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z"
        fill={light}
        opacity=".8"
      />
      <path d="M65 342h190" stroke={accent} opacity=".4" />
    </svg>
  );
}
const demoNames = [
  'Mira Tidekeeper',
  'Oren Cloudwright',
  'Fern Mosskeeper',
  'Ivo Copperhand',
  'Luma Starcartographer',
  'Brin Rootmender',
  'Sable Reefrunner',
  'Pip Windpost',
  'Vale Emberpotter',
  'Tavi Saltweaver',
  'Nell Kitewatch',
  'Ro Pebblebard',
];
const demoIds = demoNames.map(
  (_, index) => `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
);

// Reuse the decoded image itself instead of assigning its URL to another img.
// This works even when the provider/browser disables the HTTP cache. Duplicate
// portraits can paint that same resource without a CORS readback or new request.
function PreparedPortrait({ image, atlasIndex }: { image: HTMLImageElement; atlasIndex: number }) {
  const target = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const node = target.current;
    if (!node) return;
    const release = holdPreparedArtwork(image);
    const remote = atlasIndex < 0;
    let rendered: HTMLImageElement | HTMLCanvasElement;
    if (!image.parentNode) {
      rendered = image;
      image.alt = '';
      image.draggable = false;
      image.className = remote ? 'character-portrait provider-portrait' : 'portrait-atlas';
      image.style.cssText = remote
        ? 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover'
        : `left:-${(atlasIndex % 3) * 100}%;top:-${Math.floor(atlasIndex / 3) * 100}%`;
    } else {
      const canvas = document.createElement('canvas');
      rendered = canvas;
      const width = remote ? image.naturalWidth : image.naturalWidth / 3,
        height = remote ? image.naturalHeight : image.naturalHeight / 4;
      canvas.width = width;
      canvas.height = height;
      canvas.className = remote
        ? 'character-portrait provider-portrait prepared-copy'
        : 'character-portrait prepared-copy';
      canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover';
      try {
        const context = canvas.getContext('2d');
        if (remote) context?.drawImage(image, 0, 0);
        else
          context?.drawImage(
            image,
            (atlasIndex % 3) * width,
            Math.floor(atlasIndex / 3) * height,
            width,
            height,
            0,
            0,
            width,
            height,
          );
      } catch {
        // A lost drawing context leaves the original vector fallback visible.
      }
    }
    rendered.setAttribute('aria-hidden', 'true');
    node.appendChild(rendered);
    return () => {
      if (rendered.parentNode === node) node.removeChild(rendered);
      release();
    };
  }, [image, atlasIndex]);
  return <span ref={target} className="prepared-portrait" />;
}

export function CharacterPortrait({
  seed,
  variant = 0,
  characterId,
  artwork,
  priority = false,
}: {
  seed: string;
  variant?: number;
  characterId?: string;
  artwork?: ProviderArtwork;
  priority?: boolean;
}) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const index = characterId ? demoIds.indexOf(characterId.toLowerCase()) : -1;
  const permittedArtwork = providerArtworkSchema.safeParse(artwork);
  const source = portraitAssetSource(characterId, artwork),
    remoteUrl = permittedArtwork.success ? source : null,
    failed = !!source && (failedSource === source || preparedArtworkState(source) === 'failed'),
    prepared = priority && source && !failed ? preparedArtworkImage(source) : undefined;
  return (
    <div className="portrait-frame" aria-hidden="true">
      <VectorPortrait seed={seed} variant={variant} />
      {prepared ? (
        <PreparedPortrait image={prepared} atlasIndex={remoteUrl ? -1 : index} />
      ) : remoteUrl && !failed ? (
        <img
          className="character-portrait provider-portrait"
          src={remoteUrl}
          alt=""
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : 'auto'}
          decoding="async"
          referrerPolicy="no-referrer"
          draggable={false}
          onError={() => {
            setFailedSource(remoteUrl);
            artworkFailed(remoteUrl);
          }}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
        />
      ) : null}
      {!prepared && index >= 0 && !remoteUrl && !failed && (
        <img
          className="portrait-atlas"
          src={demoPortraitAtlas}
          alt=""
          draggable={false}
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : 'auto'}
          referrerPolicy="no-referrer"
          onError={() => {
            setFailedSource(demoPortraitAtlas);
            artworkFailed(demoPortraitAtlas);
          }}
          style={{ left: `-${(index % 3) * 100}%`, top: `-${Math.floor(index / 3) * 100}%` }}
        />
      )}
    </div>
  );
}
export function packMotif(name: string, theme?: PackMotif) {
  if (theme && ['battle', 'shonen', 'sports'].includes(theme)) return 'duel';
  if (theme && ['romance', 'school', 'everyday', 'shojo', 'josei'].includes(theme)) return 'petal';
  if (theme && ['future', 'mecha'].includes(theme)) return 'circuit';
  if (theme && ['mystery', 'spirit', 'night', 'seinen'].includes(theme)) return 'moon';
  if (theme && ['fantasy', 'isekai', 'voyage'].includes(theme)) return 'portal';
  if (/sh[oō]nen|battle|arena|action|sport/i.test(name)) return 'duel';
  if (/sh[oō]jo|sakura|romance|heartstring|school|slice|cozy|everyday/i.test(name)) return 'petal';
  if (/mecha|sci-fi|cyber|future|machine/i.test(name)) return 'circuit';
  if (/mystery|detective|supernatural|spirit|night|occult|thriller|horror/i.test(name))
    return 'moon';
  if (/isekai|fantasy|otherworld|adventure|voyage|portal/i.test(name)) return 'portal';
  return 'star';
}
function PackSigil({ motif }: { motif: ReturnType<typeof packMotif> }) {
  return (
    <svg className="pack-sigil" viewBox="0 0 160 180" fill="none" aria-hidden="true">
      <circle cx="80" cy="83" r="59" stroke="currentColor" opacity=".25" />
      <circle cx="80" cy="83" r="68" stroke="currentColor" opacity=".18" strokeDasharray="2 9" />
      <path d="M80 5v14M80 147v14M2 83h15M143 83h15" stroke="currentColor" opacity=".6" />
      <g stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
        {motif === 'duel' ? (
          <>
            <path d="M36 29l15 6 65 83-11 10-65-84zM124 29l-15 6-65 83 11 10 65-84z" />
            <path d="M99 124l15-12M48 112l15 12M108 132l10 12M52 132l-10 12" />
            <path
              d="M80 35l3 13 12 5-12 4-3 13-4-13-12-4 12-5z"
              fill="currentColor"
              opacity=".45"
            />
          </>
        ) : motif === 'petal' ? (
          <>
            {Array.from({ length: 5 }, (_, index) => (
              <ellipse
                key={index}
                cx="80"
                cy="59"
                rx="17"
                ry="29"
                transform={`rotate(${index * 72} 80 83)`}
                fill="currentColor"
                fillOpacity=".08"
              />
            ))}
            <circle cx="80" cy="83" r="9" fill="currentColor" fillOpacity=".3" />
            <path d="M44 133q33-20 72-2M43 137l4-8M112 127l4 8" opacity=".5" />
          </>
        ) : motif === 'circuit' ? (
          <>
            <path d="M80 39l39 44-39 44-39-44zM80 59l21 24-21 24-21-24z" />
            <path d="M80 19v20M80 127v20M20 83h21M119 83h21M39 40l17 17M104 109l17 17M39 126l17-17M104 57l17-17" />
            <path d="M39 40V26h16M121 126v14h-16M121 40V26h-16M39 126v14h16" opacity=".5" />
          </>
        ) : motif === 'moon' ? (
          <>
            <path
              d="M101 34a51 51 0 1 0 17 86A53 53 0 0 1 101 34z"
              fill="currentColor"
              fillOpacity=".12"
            />
            <path d="M110 57l3 12 12 4-12 4-3 12-4-12-12-4 12-4zM128 33v10M123 38h10M70 128v12M64 134h12" />
          </>
        ) : motif === 'portal' ? (
          <>
            <path d="M50 126V63a30 30 0 0 1 60 0v63zM61 126V64a19 19 0 0 1 38 0v62M40 127h80M32 139h96" />
            <path
              d="M80 62l11 21-11 21-11-21zM29 48l4 8 8 3-8 3-4 8-3-8-8-3 8-3zM129 90l3 6 6 2-6 3-3 6-2-6-6-3 6-2z"
              fill="currentColor"
              fillOpacity=".15"
            />
          </>
        ) : (
          <>
            <path
              d="M80 28l14 40 41 15-41 14-14 41-14-41-41-14 41-15zM80 56l7 20 20 7-20 7-7 20-7-20-20-7 20-7z"
              fill="currentColor"
              fillOpacity=".12"
            />
            <path d="M40 33l80 100M31 113l98-60" opacity=".3" />
            <circle cx="40" cy="33" r="3" fill="currentColor" />
            <circle cx="120" cy="133" r="3" fill="currentColor" />
          </>
        )}
      </g>
    </svg>
  );
}
export function PackArtwork({
  index = 0,
  name = 'All Characters',
  characterId,
  artwork,
  franchiseTitle,
  motif: theme,
}: {
  index?: number;
  name?: string;
  characterId?: string;
  artwork?: ProviderArtwork;
  /** Set only for a pack whose actual pool is restricted to this franchise. */
  franchiseTitle?: string;
  motif?: PackMotif;
}) {
  const motif = packMotif(name, theme);
  return (
    <div
      className={`foil-pack foil-${index % 4} illustrated-pack motif-${motif}`}
      data-pack-style={franchiseTitle ? 'franchise' : 'themed'}
      style={packPaletteStyle(theme, motif)}
    >
      <span className="pack-crimp crimp-top" />
      <span className="pack-crimp crimp-bottom" />
      <span className="pack-tear-line" aria-hidden="true" />
      <span className="pack-holo" aria-hidden="true" />
      {!franchiseTitle && <span className="pack-medallion" aria-hidden="true" />}
      <span className="pack-edition">CHARACTER COLLECTION</span>
      {franchiseTitle ? (
        <div className="foil-portrait">
          <CharacterPortrait
            seed={franchiseTitle}
            variant={index}
            characterId={characterId}
            artwork={artwork}
          />
        </div>
      ) : (
        <PackSigil motif={motif} />
      )}
      <span className="pack-wrapper-title">{franchiseTitle ?? name.replace(/ pack$/i, '')}</span>
      <span className="pack-wrapper-rule" aria-hidden="true">
        <i />
        <GameIcon name="spark" />
        <i />
      </span>
      <span className="foil-bottom">UNSEAL A NEW STORY</span>
    </div>
  );
}
