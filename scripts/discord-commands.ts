import { registerDiscordCommands } from '../packages/db/src/discord-command-registration';
import { promptText } from './prompt';
try {
  const applicationId = process.env.DISCORD_CLIENT_ID,
    secret = process.env.DISCORD_CLIENT_SECRET;
  if (!applicationId || !secret) throw new Error('Configure the Discord application first.');
  const guildId = await promptText('Discord server ID to register /bakufu in: ');
  await registerDiscordCommands(applicationId, secret, guildId);
  console.log(
    '/bakufu commands registered for this server. Link its realm on the website and configure the public interactions endpoint.',
  );
} catch {
  console.error(
    'Could not register commands. Check the application credentials, server ID, application installation, and network access. No credentials were printed.',
  );
  process.exitCode = 1;
}
