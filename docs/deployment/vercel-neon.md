# Free hosting: Vercel + Neon

Run Bakufu without your own computer on two free tiers: the website on
[Vercel](https://vercel.com) (Hobby plan) and the database on
[Neon](https://neon.com) (Free plan). Players sign in with **Discord** as usual.
The `/bakufu` slash commands are turned off on this setup, so everything happens
on the website.

> **Free tiers have monthly limits.** Keep a realm under about **2,000
> characters** here and check Neon's usage now and then; see
> [How big can a realm get?](#how-big-can-a-realm-get) below. When a limit runs
> out, Neon pauses the database until the next month and the site shows
> "temporarily unavailable".

## What you get and what you give up

| | Vercel + Neon | Self-hosted Docker |
| --- | --- | --- |
| Cost | Free (Vercel Hobby is for non-commercial use) | Your own server |
| Discord sign-in | Yes | Yes |
| `/bakufu` slash commands | No (they need fast, always-awake replies) | Yes |
| Scheduled backups | No worker; run backups from your PC | Backup worker |
| Address | Permanent `your-project.vercel.app` | Your domain or tunnel |
| First visit after a quiet period | 1–2 s slower while things wake up | Instant |

Limits to know (free plans as of late 2026; check Neon's and Vercel's pricing
pages, they change):

- **Neon Free, network transfer: 5 GB per month.** Everything the database
  sends to the website counts. This is the limit a busy realm hits first; see
  the next section.
- **Neon Free, compute: 100 CU-hours per month.** The database is awake while
  anyone plays and sleeps after a few idle minutes. The live-pulls panel stops
  checking for new pulls after 5 minutes without input, so an open tab doesn't
  keep it awake.
- **Neon Free, storage: 1 GB per project.** That's about 10 MB per 10,000
  characters and 5–6 KB per pack opening, so roughly 160,000 openings next to a
  10,000-character roster. Custom reveal sounds are the big items (about 2.5 MB
  each). When the database is full, actions that add data fail until you free
  space or upgrade.
- When transfer or compute runs out, Neon **pauses the database until the next
  billing month** (or until you upgrade). Nothing is deleted; the site shows
  "temporarily unavailable" and backups fail with code 53000 meanwhile.
- **Vercel Hobby:** a request body can be at most 4.5 MB. The browser
  gzip-compresses large uploads (rosters and sounds), which fits far bigger
  rosters than before; the server applies the same size cap after unpacking. A
  request may run for up to 60 seconds, which large realm creation can need.

## How big can a realm get?

Each web server keeps a copy of the realm's roster and asks the database only
whether it changed (a 32-byte fingerprint), so ordinary requests stay small no
matter how big the roster is. Measured for a 3,000-character realm
(`tests/integration/transfer-budget.test.ts`):

| What happens | Database transfer |
| --- | --- |
| A page view, also after every action (open, recycle, trade, …) | about 20–70 KB: 1 byte per roster character, about 100 bytes per card the player owns, plus the realm's settings |
| A pack opening, even 10 packs | about 13 KB |
| Live pulls check (every 15 s while someone is on Packs) | a few hundred bytes; about 13 KB when a new big pull appears |
| A **new server instance** or a **roster change** (import, Grow the roster, tagging, rarity edits, removals) | the **whole roster once**: about 0.5 KB per character, so 1 MB for 2,000 and 2.5 MB for 5,000 |
| A backup from your PC | the whole database |

Vercel starts new server instances whenever it likes (after quiet periods, under
load, after each deploy), and each one downloads the whole roster on its first
request. That is what makes big rosters expensive on the free plan.

Rough guidance for the 5 GB Neon Free transfer:

| Roster | On Vercel + Neon Free |
| --- | --- |
| up to about 2,000 characters | comfortable for a small community (around 20 players playing about an hour a day) |
| 2,000–5,000 | works, but watch the usage and avoid many roster changes per day |
| more than 5,000 | use a paid Neon plan or self-host with Docker (no transfer limit) |

These are estimates, not promises: how often Vercel starts instances and how
much people play matter more than anything else. The realm wizard and **Grow the
roster** show a note above 2,000 characters.

**Check the usage:** in the Neon Console open the project; the **Overview** page
has a **Usage** panel (compute, storage, network transfer this month). If you
created the database through Vercel (**Storage → Neon**), open it from Vercel's
**Storage** tab.

Versions before the roster cache ("Database transfer" in `CHANGELOG.md`), every
page view downloaded the whole roster (about 1.4 MB for 3,000 characters) and
the live-pulls panel about 330 KB every 15 seconds, which used up 5 GB within
weeks. Update if you run an older version.

## What you need

- The Bakufu repository on GitHub (Vercel deploys from it), for example:
  `gh repo create bakufu --private --source . --remote origin --push`
- A Discord application (the same one as for local sign-in is fine).
- Docker Desktop on your PC, to set up and back up the database. No Node.js
  install is needed. Build the current image once: `docker compose build web`.

## 1. Create the Neon database

1. Sign up at neon.com and create a project. Pick a region near your players,
   for example **AWS Europe Central (Frankfurt)**.
2. Open **Connect** and copy two connection strings:
   - the **pooled** one (its host name contains `-pooler`), for Vercel,
   - the **direct** one (turn pooling off), for setup and backups from your PC.

   Keep both private, like passwords.

## 2. Set up the tables (from your PC)

In PowerShell, in the project folder, with the **direct** connection string:

```powershell
docker compose run --rm --no-deps -e DATABASE_URL='postgresql://…direct…' web pnpm db:migrate
```

Optional: move your existing local game over. Do this before anyone signs in on
the new site, because a restore needs an empty database:

```powershell
docker compose run --rm --no-deps --volume C:\PrivateBackups:/backups web pnpm backup /backups/move-to-neon.backup
docker compose run --rm --no-deps -e DATABASE_URL='postgresql://…direct…' --volume C:\PrivateBackups:/backups web pnpm restore /backups/move-to-neon.backup
```

Both commands ask for the backup passphrase. Your local server must be on the
same version as the image you run them with.

## 3. Create the Vercel project

1. Sign up at vercel.com with GitHub and choose **Add New → Project**, then
   import your Bakufu repository.
2. Set **Root Directory** to `apps/web`. Vercel detects Next.js and pnpm.
3. Add these **Environment Variables**:

   | Name | Value |
   | --- | --- |
   | `DATABASE_URL` | Neon **pooled** connection string |
   | `DATABASE_POOL_MAX` | `3` |
   | `APP_ORIGIN` | `https://your-project.vercel.app` (your production address, no trailing slash) |
   | `COOKIE_SECURE` | `true` |
   | `DISCORD_CLIENT_ID` | from the Discord Developer Portal |
   | `DISCORD_CLIENT_SECRET` | from the Discord Developer Portal |
   | `DISCORD_ADMIN_USER_ID` | your own Discord **user** ID |

   Leave `DISCORD_PUBLIC_KEY` unset: that keeps slash commands off.
4. Deploy. Afterwards, under **Settings → Functions**, set the function region
   to the same area as the Neon database (for example Frankfurt) and redeploy.
   Every request makes several database queries, so a short distance matters.
5. Under **Settings → General**, choose Node.js **24.x** if it isn't already.

If the address Vercel assigned differs from what you entered for `APP_ORIGIN`,
correct the variable and redeploy.

## 4. Discord sign-in

In the [Discord Developer Portal](https://discord.com/developers/applications),
open your application:

1. **OAuth2 → Redirects:** add
   `https://your-project.vercel.app/api/auth/discord/callback`. It never changes,
   unlike a quick tunnel address.
2. **General Information → Interactions Endpoint URL:** leave it empty. Remove an
   old tunnel address if one is still there.
3. If your server still shows `/bakufu` from earlier tests, remove it once from
   your PC (it asks for the server ID):

   ```powershell
   docker compose run --rm --no-deps web pnpm discord:commands remove
   ```

Then open your Vercel address and **Sign in with Discord**. Because your user ID
is `DISCORD_ADMIN_USER_ID` and the database has no admin yet, your account
becomes the instance admin. With a restored backup, your existing admin account
carries over instead. Create a realm and invite players from **Administration →
Players & access**.

## Updating

Vercel deploys whatever you push, but it never changes the database. When a new
version adds a **migration** (new tables or columns), you apply it to Neon from
your PC first. `CHANGELOG.md` says so under the version: "Newest migration:
`00xx_….sql`". Without a new migration, an update is just `git push`.

With a new migration, do these four steps in PowerShell in the project folder.
Pick a moment when nobody is playing:

1. **Get the new version and rebuild the image** the commands run in. This only
   builds the image; a running local server keeps its old version until you
   restart it.

   ```powershell
   git pull
   docker compose build web
   ```

   (Skip `git pull` if the changes were made on this PC.)

2. **Back up Neon** (recommended), with a new file name each time. It asks for a
   passphrase:

   ```powershell
   docker compose run --rm --no-deps -e DATABASE_URL='postgresql://…direct…' --volume C:\PrivateBackups:/backups web pnpm backup /backups/bakufu-before-update.backup
   ```

3. **Migrate Neon** with the **direct** connection string (Neon → your project
   → **Connect** → turn **Connection pooling** off → copy; its host name has no
   `-pooler`). Keep the single quotes: the string contains `&`.

   ```powershell
   docker compose run --rm --no-deps -e DATABASE_URL='postgresql://…direct…' web pnpm db:migrate
   ```

   It prints `Database migrations applied.` All new migrations run in one
   transaction: if something fails, nothing is changed and the old site keeps
   working. Running it again is harmless, because applied migrations are
   skipped.

4. **Deploy:** `git push`. Vercel builds and deploys in a minute or two (watch
   **Deployments** in Vercel).

Between steps 3 and 4 the old site runs against the new database, and pages may
show errors until the deploy finishes. That's why to pick a quiet moment. Not
deployed yet? Then step 2 of the setup above with the new image is all you need.

## Backups

There is no backup worker on Vercel. Neon keeps a short restore history of its
own; for real backups run this from your PC now and then (it asks for a
passphrase) and keep the file somewhere safe:

```powershell
docker compose run --rm --no-deps -e DATABASE_URL='postgresql://…direct…' --volume C:\PrivateBackups:/backups web pnpm backup /backups/bakufu-2026-11-09.backup
```

Restoring works like step 2 into a fresh, empty Neon database.

## Troubleshooting

- **Sign-in says the redirect is invalid:** the Discord redirect must match
  `APP_ORIGIN` exactly, including `https://`.
- **"Request is too large":** the roster is too big even compressed; create the
  realm with fewer characters and add more under **Administration → Characters**.
- **Database connection errors on Vercel:** use the pooled string; if it ends
  with `&channel_binding=require` and connections fail, remove that part.
- **Slow first page:** normal after a quiet period while Neon wakes up.
- **"SECURITY WARNING: The SSL modes 'prefer', 'require', and 'verify-ca'…"**
  when running commands: harmless, the connection is already fully verified. To
  silence it, change `sslmode=require` to `sslmode=verify-full` in the string.
- **"Bakufu is temporarily unavailable", and backups fail with code 53000:**
  a Neon monthly limit (usually network transfer) is used up and the database
  is paused. Check **Usage** on the Neon project's Overview page. It comes back
  at the start of the next billing month, or right away on a paid plan; nothing
  is lost. See [How big can a realm get?](#how-big-can-a-realm-get).
- **Backup or migrate fails:** the message names the cause. "No Bakufu tables
  yet" means the database was never set up: run the step 2 `db:migrate` command.
