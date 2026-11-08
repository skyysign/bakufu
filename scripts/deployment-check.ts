import { productionSettings } from '../packages/config/src/deployment';
try {
  productionSettings(process.env);
  console.log(
    'HTTPS settings passed. Verify DNS, firewall access, backups, and public certificate issuance on the host.',
  );
} catch {
  console.error(
    'HTTPS settings failed. Use one lowercase PUBLIC_HOSTNAME, its exact https:// APP_ORIGIN without a trailing slash, and COOKIE_SECURE=true.',
  );
  process.exitCode = 1;
}
