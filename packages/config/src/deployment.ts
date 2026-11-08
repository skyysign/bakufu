import { z } from 'zod';
const label = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
export function productionSettings(env: NodeJS.ProcessEnv) {
  const hostname = z.string().min(3).max(253).parse(env.PUBLIC_HOSTNAME),
    labels = hostname.split('.');
  if (
    labels.length < 2 ||
    labels.some((part) => !label.test(part)) ||
    !/[a-z]/.test(labels.at(-1)!)
  )
    throw new Error(
      'Set PUBLIC_HOSTNAME to one lowercase DNS hostname without a scheme, port, or path.',
    );
  const origin = `https://${hostname}`;
  if (env.APP_ORIGIN !== origin)
    throw new Error(
      'APP_ORIGIN must be exactly https:// followed by PUBLIC_HOSTNAME, without a trailing slash.',
    );
  if (env.COOKIE_SECURE !== 'true')
    throw new Error('COOKIE_SECURE must be true for HTTPS deployment.');
  return { hostname, origin };
}
