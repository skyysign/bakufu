# Security

Please report security problems **privately**, not in public issues: on GitHub
open this repository's **Security** tab and choose **Report a vulnerability**.
Describe what is affected, how to reproduce it and the impact you see. Use
made-up values; never include real tokens, passwords, connection strings or
player data.

Bakufu is an alpha. Fixes go to the latest version on `main`; older versions
are not patched separately.

## For operators

- Keep `.env`, backup passphrases and database connection strings private. Only
  `.env.example` belongs in a repository.
- If a secret leaked (Discord client secret, database password, backup
  passphrase), rotate it at its source right away; deleting the message or file
  is not enough.
- Back up before every update and test a restore now and then:
  [backups](docs/deployment/backups.md), [restore checks](docs/deployment/restore-checks.md).
