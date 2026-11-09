'use client';
import { siteName } from '../lib/brand';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main id="main" className="shell">
      <section className="panel">
        <h1>{siteName} is temporarily unavailable</h1>
        <p>Check that PostgreSQL is running and migrations have been applied, then try again.</p>
        <p>
          On free hosting (Vercel + Neon), the database is also paused when a monthly limit is used
          up: the admin can check Usage in the Neon Console.
        </p>
        <button onClick={reset}>Try again</button>
      </section>
    </main>
  );
}
