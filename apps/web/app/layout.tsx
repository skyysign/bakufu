import type { Metadata, Viewport } from 'next';
import { siteName } from '../lib/brand';
import '@fontsource-variable/inter/opsz.css';
import '@fontsource-variable/bricolage-grotesque/opsz.css';
import './theme.css';
import './shell.css';
import './cards.css';
import './screens.css';
import './admin.css';
import './forms.css';
import './opening.css';
import './rarity-motion.css';

export const metadata: Metadata = {
  title: siteName,
  description: 'Open packs, collect characters and trade with your community. Self-hosted.',
};
export const viewport: Viewport = {
  themeColor: '#08080d',
  colorScheme: 'dark',
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
