import { z } from 'zod';

// Only public static user/default avatar endpoints, never attachments, signed
// links, arbitrary query parameters, or caller-selected hosts.
export const discordAvatarUrlSchema = z
  .string()
  .regex(
    /^https:\/\/cdn\.discordapp\.com\/(?:avatars\/[0-9]{17,20}\/(?:a_)?[a-f0-9]{32}\.png\?size=128|embed\/avatars\/[0-5]\.png)$/,
    'Use a canonical public Discord avatar reference.',
  );

// Verified /users/@me data is presentation metadata. Malformed or missing
// optional avatar fields must never prevent an otherwise verified login.
export function discordAvatarUrl(
  userId: string,
  avatar: unknown,
  discriminator?: unknown,
): string | null {
  if (!/^[0-9]{17,20}$/.test(userId)) return null;
  if (typeof avatar === 'string' && /^(?:a_)?[a-f0-9]{32}$/.test(avatar))
    return `https://cdn.discordapp.com/avatars/${userId}/${avatar}.png?size=128`;
  if (avatar !== null) return null;
  let index: bigint;
  if (
    typeof discriminator === 'string' &&
    /^[0-9]{1,4}$/.test(discriminator) &&
    discriminator !== '0'
  )
    index = BigInt(discriminator) % 5n;
  else index = (BigInt(userId) >> 22n) % 6n;
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}
