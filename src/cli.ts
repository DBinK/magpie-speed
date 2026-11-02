import { startServer } from './server';
import { VERSION } from './version';

const argv = process.argv.slice(2);
if (argv.includes('--version')) {
  console.log(VERSION);
  process.exit(0);
}
if (argv.includes('--help')) {
  console.log(
    `Magpie Speed ${VERSION}\n  bun start [--demo] [--port 3489] [--version]\nEnvironment: MAGPIE_SPEED_GATEWAY, MAGPIE_SPEED_API_KEY, MAGPIE_SPEED_DATA_DIR`,
  );
  process.exit(0);
}
const at = argv.indexOf('--port');
const service = await startServer({
  demo: argv.includes('--demo'),
  ...(at >= 0 ? { port: Number(argv[at + 1]) } : {}),
});
console.log(
  `Magpie Speed: http://127.0.0.1:${service.port}${service.demo ? ' (demo; no provider requests)' : ''}`,
);
for (const event of ['SIGINT', 'SIGTERM'] as const)
  process.on(event, async () => {
    await service.close();
    process.exit(0);
  });
