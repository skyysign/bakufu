# Realm admins

A realm can have several admins, so running it doesn't fall on one person.
Admins of a realm open **Administration → Players & access → Realm admins**.

## Adding an admin

The person must already be a member of the realm (invited, or joined through the
realm's Discord server). Under **Add an admin**, search for them by Discord name
or paste their trade ID, choose them and select **Make admin**. It takes effect
on their next page load: **Administration** appears in their account menu.

Admins can change everything in their realm: game rules, packs, rarity, reveal
sounds, player collections and gems, the Discord server link, joining and
invitations, and other admins. Only make people admins you trust.

Two things stay with the **instance admin** (the first account set up on the
server): creating realms and **Administration → Characters** (looking up series
from a provider). Backups and restores happen on the server and are not part of
the website.

## Removing an admin

**Remove admin** next to an admin asks for a confirmation, then makes them a
normal player again. They keep their cards, gems, ranks and history. An admin
can also **Step down** themselves; they lose Administration for that realm until
an admin adds them again.

The realm's **creator** always stays an admin and has no remove button, so a
realm never ends up without one and a new admin cannot lock its creator out.

## Rules the server enforces

- Only admins of that realm can see the admin list or change roles. Being an
  admin of one realm gives nothing in another.
- A trade ID only matches members of the same realm.
- Role changes in a realm happen one at a time: if two admins remove each other
  at the same moment, the first change wins and the second is refused, because
  its sender is no longer an admin.
- Making someone an admin who already is one changes nothing, so a repeated
  request is harmless.
- Writes need the same-origin check as every other change.

Roles are part of each realm membership, so encrypted backups and restores keep
them. No migration is needed. Role changes are not logged with who made them;
check the admin list to see who has access now.

API: `GET /api/realm-admins?realmId=<UUID>` lists the admins (`tradeCode`, names,
optional `avatarUrl`, `creator`, `self`); `POST /api/realm-admins` with
`{realmId, tradeCode, role: "admin" | "player"}` changes one member's role and
returns the new list.
