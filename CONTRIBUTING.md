# Contributing

Thanks for helping with Bakufu. It is an alpha, so small, focused pull requests
are the easiest to review. For bigger changes, open an issue first to agree on
the approach.

1. **Read the rules.** [AGENTS.md](AGENTS.md) applies to every contributor,
   human or coding agent: each realm's data stays separate, ownership, gems and
   trades change only inside database transactions, permissions are checked in
   the services (not just the UI), and no secrets or real user data are ever
   committed. The [specification](docs/specification.md) describes the intended
   game; [implementation status](docs/implementation-status.md) says what exists.
2. **Set up** as in the README's [Development](README.md#development) section.
3. **Test your change.** Add or update tests for any behavior change, then run
   what CI runs:

   ```sh
   pnpm lint
   pnpm typecheck
   pnpm test
   pnpm test:integration
   pnpm build
   ```

   For interface changes, also run `pnpm test:e2e` if you can. Tests use
   fixtures and a disposable PostgreSQL; they never call external character APIs.
4. **Keep the docs in step.** Note user-visible changes under "Unreleased" in
   [CHANGELOG.md](CHANGELOG.md). Schema changes need a new migration (never edit
   one that has shipped) and backup/restore support for it.
5. **Content.** Only original artwork and data. No third-party character art,
   scraped datasets or provider data dumps.

By contributing you agree that your contribution is released under the
project's [MIT license](LICENSE).
