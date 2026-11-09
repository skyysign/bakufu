# Changing your local password

Sign in and choose **Account settings** in the main navigation to open `/account`. Enter your
current password, a new password of **12 to 256 characters**, and its confirmation.
Choose **Change password**. This browser stays signed in; your other sessions,
including sessions issued through a linked Discord identity, are revoked.
Your account, Discord link, realm permissions, cards and balances stay intact.
This works for ordinary players as well as administrators, even without a realm.

If a connection fails after submission, keep this page open and choose **Retry
password change**. The form retains the same attempt in page memory and locks
editing until its result is known. A successful retry confirms the current
credential without changing it again or revoking sessions issued after the
first change. The fields are cleared after success or a definitive rejection.
Reloading discards this pending attempt; sign in with the new password if it
already took effect. Passwords are never written to browser storage.

A stale form cannot overwrite a more recent password. Reload on a revision
conflict. Failed verification is limited to eight attempts per account in
fifteen minutes, separately from email login limits. The service requires the
initiating session and verifies ownership and expiry again under an account
lock. Login also rechecks its verified hash under that lock before issuing a
session, so a racing old-password login cannot escape revocation.

Discord-only accounts show an explanation instead of a password form. This
flow cannot add a password, unlink Discord, or change your email. Password
recovery is outside the current Discord-focused scope. Session lists, account
deletion/anonymization and operator reset tooling remain future work. A linked
Discord identity still provides its existing sign-in method. Account deletion
must account for realm ownership and ledger/trade history before implementation.

Schema migration **0013** adds an integer password revision with default zero;
existing hashes and progress are preserved. Encrypted instance snapshots include
the revision, while older snapshots restore it as zero. Sessions are never
restored. Player archives contain no credential, session or password revision.
