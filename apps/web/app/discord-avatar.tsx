'use client';
import { useEffect, useRef, useState } from 'react';
import { discordAvatarUrlSchema } from '../../../packages/config/src/discord-avatar';

type PublicProfile = {
  avatarUrl?: string;
  displayName?: string | null;
  username?: string | null;
};
export function DiscordAvatar({
  profile,
  className = '',
}: {
  profile?: PublicProfile | null;
  className?: string;
}) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const parsed = discordAvatarUrlSchema.safeParse(profile?.avatarUrl);
  const source = parsed.success ? parsed.data : null;
  const label = profile?.displayName ?? profile?.username ?? 'Collector';
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    // A cached or very early failure can finish before React installs onError.
    if (source && image.current?.complete && !image.current.naturalWidth) setFailedSource(source);
  }, [source]);
  return (
    <span
      className={`avatar-dot discord-avatar ${className}`}
      role="img"
      aria-label={`${label}'s profile picture`}
      style={{ position: 'relative', overflow: 'hidden', flexShrink: 0 }}
    >
      <span aria-hidden="true">{Array.from(label.trim())[0]?.toUpperCase() ?? 'C'}</span>
      {source && failedSource !== source && (
        <img
          ref={image}
          src={source}
          alt=""
          aria-hidden="true"
          referrerPolicy="no-referrer"
          draggable={false}
          decoding="async"
          onError={() => setFailedSource(source)}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
        />
      )}
    </span>
  );
}
