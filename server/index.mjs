import { createApp } from './app.mjs';
import { YouCamAdapter } from './youcam.mjs';
import { fileURLToPath } from 'node:url';
import express from 'express';
const production = process.argv.includes('--production');
const liveEnabled = process.env.YOUCAM_LIVE_ENABLED === 'true' && process.env.YOUCAM_ALLOW_UNIT_USAGE === 'true' && Boolean(process.env.YOUCAM_API_KEY);
const { app, store } = createApp({ adapter: new YouCamAdapter({ apiKey: process.env.YOUCAM_API_KEY }), liveEnabled });
const sweeper = setInterval(() => store.cleanup(), 15000);
sweeper.unref();
let vite;
if (production) {
  app.use(express.static(fileURLToPath(new URL('../dist', import.meta.url))));
  app.get('/{*path}', (_req, res) => res.sendFile(fileURLToPath(new URL('../dist/index.html', import.meta.url))));
} else {
  const { createServer } = await import('vite');
  vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT || 4818);
const server = app.listen(port, '127.0.0.1', () => console.log(`FitCheck Studio: http://127.0.0.1:${server.address().port}\nMode: ${liveEnabled ? 'LIVE AVAILABLE — photo consent required' : 'LOCAL FIXTURE — YouCam calls disabled'}`));
const stop = async () => { clearInterval(sweeper); await vite?.close(); server.close(); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
