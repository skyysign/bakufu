import { z } from 'zod';

// An image URL is a reference, never an instruction for the server to fetch it.
// These are the character-image hosts returned by the supported providers.
export function providerArtworkUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 500) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      url.hash ||
      !['cdn.myanimelist.net', 's4.anilist.co'].includes(url.hostname) ||
      !(url.hostname === 'cdn.myanimelist.net'
        ? /^\/images\/characters\/[a-zA-Z0-9_./-]+\.(?:jpe?g|png|webp)$/.test(url.pathname)
        : /^\/file\/anilistcdn\/character\/[a-zA-Z0-9_./-]+\.(?:jpe?g|png|webp)$/.test(
            url.pathname,
          ))
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

export const providerArtworkSchema = z.strictObject({
  url: z
    .string()
    .refine(
      (value) => providerArtworkUrl(value) !== null,
      'Use a supported HTTPS character image URL.',
    ),
  sourceUrl: z
    .url()
    .max(500)
    .refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === 'https:' &&
        !url.username &&
        !url.password &&
        !url.port &&
        ['myanimelist.net', 'anilist.co'].includes(url.hostname)
      );
    }, 'Use a provider character page as attribution.'),
  permission: z.string().trim().min(1).max(200),
});
export type ProviderArtwork = z.infer<typeof providerArtworkSchema>;
