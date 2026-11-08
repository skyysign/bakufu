import { createHash } from 'node:crypto';
import { admissionPolicySchema, defaultAdmission, playerAdmissionSchema } from './admission';
import type { Transaction } from './connection';
export async function validateAdmissionBackup(tx: Transaction) {
  const policies = (await tx.query('SELECT * FROM realm_admission_policies')).rows,
    changes = (await tx.query('SELECT * FROM realm_admission_changes ORDER BY to_revision')).rows;
  const bindings = (await tx.query('SELECT realm_id,guild_id FROM discord_guild_realms')).rows;
  const members = (await tx.query('SELECT * FROM realm_admissions')).rows;
  const identities = (
    await tx.query("SELECT account_id FROM account_identities WHERE provider='discord'")
  ).rows;
  const grants = (
    await tx.query(
      "SELECT * FROM wallet_ledger WHERE reason='starting_grant' AND operation_key='starting-grant'",
    )
  ).rows;
  function check(value: unknown) {
    if (!value) throw new Error('Backup admission history does not reconcile.');
  }
  function parse(input: unknown) {
    const result = admissionPolicySchema.safeParse(input);
    check(result.success);
    return result.data!;
  }
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  for (const row of policies) {
    const current = parse({
        schemaVersion: row.schema_version,
        revision: row.revision,
        mode: row.mode,
        guildId: row.guild_id,
        joinCode: row.join_code,
      }),
      history = changes.filter((change) => change.realm_id === row.realm_id);
    check(history.length === current.revision);
    let previous = { ...defaultAdmission };
    const codes = new Set<string>();
    for (let i = 0; i < history.length; i++) {
      const change = history[i],
        before = parse(change.before_policy),
        after = parse(change.after_policy);
      check(
        change.from_revision === i &&
          change.to_revision === i + 1 &&
          same(before, previous) &&
          after.revision === i + 1,
      );
      check(change.result.ok === true && same(parse(change.result.policy), after));
      const command =
        after.mode === 'invite_only'
          ? { mode: 'invite_only' }
          : { mode: 'discord_server', guildId: after.guildId };
      check(
        createHash('sha256').update(JSON.stringify(command)).digest('hex') === change.fingerprint,
      );
      if (after.mode === 'discord_server') {
        if (before.mode === 'discord_server' && before.guildId === after.guildId)
          check(before.joinCode === after.joinCode);
        else check(!codes.has(after.joinCode!));
        codes.add(after.joinCode!);
      }
      previous = after;
    }
    const last = history[history.length - 1];
    check(
      last &&
        same(current, previous) &&
        last.account_id === row.updated_by &&
        last.created_at.getTime() === row.updated_at.getTime(),
    );
    if (current.mode === 'discord_server')
      check(
        bindings.some(
          (binding) => binding.realm_id === row.realm_id && binding.guild_id === current.guildId,
        ),
      );
  }
  check(changes.every((change) => policies.some((policy) => policy.realm_id === change.realm_id)));
  for (const member of members) {
    check(
      playerAdmissionSchema.safeParse({
        admissionId: member.id,
        method: member.method,
        policyRevision: member.policy_revision,
        guildId: member.guild_id,
        startingGems: member.starting_gems,
        admittedAt: member.admitted_at.toISOString(),
      }).success,
    );
    const change = changes.find(
      (change) =>
        change.realm_id === member.realm_id && change.to_revision === member.policy_revision,
    );
    check(
      change &&
        change.after_policy.mode === 'discord_server' &&
        change.after_policy.guildId === member.guild_id &&
        change.created_at.getTime() <= member.admitted_at.getTime(),
    );
    check(identities.some((identity) => identity.account_id === member.account_id));
    const grant = grants.find(
      (grant) => grant.realm_id === member.realm_id && grant.account_id === member.account_id,
    );
    check(
      grant &&
        grant.amount === member.starting_gems &&
        grant.balance_after === member.starting_gems &&
        grant.created_at.getTime() <= member.admitted_at.getTime(),
    );
  }
}
