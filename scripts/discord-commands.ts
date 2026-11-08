import {
  registerDiscordCommands,
  removeDiscordCommands,
} from '../packages/db/src/discord-command-registration';
import { promptText } from './prompt';

// pnpm discord:commands          registers /bakufu in one server
// pnpm discord:commands remove   removes /bakufu (and the old /atlas) again,
//                                for hosting without slash commands
const remove = process.argv[2] === 'remove';
try {
  const applicationId = process.env.DISCORD_CLIENT_ID,
    secret = process.env.DISCORD_CLIENT_SECRET;
  if (!applicationId || !secret) throw new Error('Configure the Discord application first.');
  const guildId = await promptText(
    remove
      ? 'Discord server ID to remove /bakufu from: '
      : 'Discord server ID to register /bakufu in: ',
  );
  if (remove) {
    const { removed } = await removeDiscordCommands(applicationId, secret, guildId);
    console.log(
      removed
        ? `Removed ${removed} command(s). Players use the website and Discord sign-in.`
        : 'No /bakufu commands were registered in this server.',
    );
  } else {
    await registerDiscordCommands(applicationId, secret, guildId);
    console.log(
      '/bakufu commands registered for this server. Link its realm on the website and configure the public interactions endpoint.',
    );
  }
} catch {
  console.error(
    'Could not update commands. Check the application credentials, server ID, application installation, and network access. No credentials were printed.',
  );
  process.exitCode = 1;
}
