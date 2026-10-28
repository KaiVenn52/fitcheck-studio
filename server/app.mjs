import express from 'express';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError, publicError } from './errors.mjs';
import { JobStore, TTL_MS } from './jobs.mjs';
import { YouCamAdapter } from './youcam.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
export function createApp({ adapter, liveEnabled = false, now = Date.now, fixtureDelay } = {}) {
  const app = express();
  app.disable('x-powered-by');
  const store = new JobStore({ adapter: adapter || new YouCamAdapter(), liveEnabled, now, fixtureDelay });
  const sessions = new Map();
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()' });
    // Local application: reject DNS rebinding and cross-origin writes before parsing image bytes.
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(req.hostname)) return res.status(403).json({ error: { code: 'LOCAL_ONLY', message: 'Use the loopback address printed by the server.' } });
    if (req.path.startsWith('/api/')) {
      res.set('Cache-Control', 'no-store');
      if (!['GET','HEAD'].includes(req.method)) {
        if (req.get('sec-fetch-site') === 'cross-site' || (req.get('origin') && req.get('origin') !== `${req.protocol}://${req.get('host')}`)) return res.status(403).json({ error: { code: 'ORIGIN', message: 'Cross-site requests are not allowed.' } });
        if (req.method !== 'DELETE' && !req.is('application/json')) return res.status(415).json({ error: { code: 'CONTENT_TYPE', message: 'JSON is required.' } });
      }
      for (const [id, s] of sessions) if (now() - s.seen > TTL_MS) { store.clear(id); sessions.delete(id); }
      const cookie = req.headers.cookie?.match(/(?:^|;\s*)fitcheck=([a-f0-9]{64})(?:;|$)/)?.[1];
      let id = sessions.has(cookie) ? cookie : undefined;
      if (!id) {
        if (sessions.size >= 200) return res.status(429).json({ error: { code: 'CAPACITY', message: 'Session capacity reached. Try again later.' } });
        id = randomBytes(32).toString('hex'); sessions.set(id, { seen: now(), requests: [] });
        res.cookie('fitcheck', id, { httpOnly: true, sameSite: 'strict', maxAge: TTL_MS, path: '/api', secure: req.secure });
      }
      const session = sessions.get(id); session.seen = now();
      session.requests = session.requests.filter(t => t > now() - 60000);
      if (session.requests.length >= 90) return res.status(429).json({ error: { code: 'RATE_LIMIT', message: 'Too many requests. Wait a minute.' } });
      session.requests.push(now()); req.owner = id;
    }
    next();
  });
  app.get('/api/config', (_req, res) => res.json({ liveEnabled, fixture: true, ttlMinutes: 30, endpoint: '/s2s/v2.0/task/2d-vto/watch', liveVerified: false }));
  app.get('/api/jobs', (req, res) => { store.cleanup(); res.json({ jobs: [...store.jobs.values()].filter(j => j.owner === req.owner).map(j => store.view(j)) }); });
  app.delete('/api/jobs', (req, res) => { store.clear(req.owner); res.json({ cleared: true, scope: 'local-session', providerDeletionConfirmed: false }); });
  app.post('/api/jobs', express.json({ limit: '35mb' }), async (req, res) => {
    const job = await store.create(req.body, req.owner, req.get('idempotency-key'));
    res.status(202).json(store.view(job));
  });
  app.get('/api/jobs/:id', async (req, res) => {
    const job = store.get(req.params.id, req.owner); await store.refresh(job); res.json(store.view(job));
  });
  app.post('/api/jobs/:id/resume', async (req, res) => {
    const job = store.get(req.params.id, req.owner); await store.refresh(job, true); res.json(store.view(job));
  });
  app.get('/api/jobs/:id/results/:index', async (req, res) => {
    const job = store.get(req.params.id, req.owner);
    const item = /^[01]$/.test(req.params.index) ? job.items[Number(req.params.index)] : null;
    if (job.mode !== 'live' || item?.state !== 'success' || !item.resultUrl) throw new AppError('RESULT_UNAVAILABLE', 'This preview is not ready.', 404);
    const cacheKey=job.id+':'+req.params.index;
    const result = store.resultCache.get(cacheKey)?.media || await store.adapter.download(item.resultUrl);
    // A deletion during a download must not resurrect the local result.
    store.get(job.id, req.owner);
    store.rememberResult(job,Number(req.params.index),result);
    res.type(result.type).send(result.bytes);
  });
  app.use('/api', (_req, _res, next) => next(new AppError('NOT_FOUND', 'API route not found.', 404)));
  app.use('/fixtures', express.static(path.join(root, 'public/fixtures'), { maxAge: '1h' }));
  app.use((error, _req, res, _next) => {
    if (error.type === 'entity.too.large') error = new AppError('BODY_SIZE', 'The comparison is too large. Use smaller images.', 413);
    if (error.type === 'entity.parse.failed') error = new AppError('JSON_INVALID', 'Invalid JSON request.');
    if (error.retryAfter) res.set('Retry-After', String(error.retryAfter));
    res.status(error.status || 500).json({ error: publicError(error) });
  });
  return { app, store };
}
