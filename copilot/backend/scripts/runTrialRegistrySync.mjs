import dotenv from 'dotenv';

dotenv.config();

const { default: trialRegistryService } = await import('../src/services/trialRegistryService.js');

try {
  const meta = await trialRegistryService.runSync({ reason: 'manual-script', force: true });
  console.log(JSON.stringify(meta, null, 2));
  process.exit(0);
} catch (error) {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
} finally {
  trialRegistryService.stop();
}
