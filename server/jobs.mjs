import { randomUUID, createHash } from 'node:crypto';
import { AppError, publicError } from './errors.mjs';
import { validateImage } from './images.mjs';
export const TTL_MS = 30 * 60 * 1000;
const POLL_MS = 2500;
const POLL_WINDOW_MS = 3 * 60 * 1000;
const labels = { field: 'The Field / olive', dress: 'The Dress / ivory', diver: 'The Diver / midnight' };
export class JobStore {
  constructor({ adapter, liveEnabled = false, now = Date.now, fixtureDelay = 1600 } = {}) {
    Object.assign(this, { adapter, liveEnabled, now, fixtureDelay });
    this.jobs = new Map();
    this.pending = new Map();
    this.epochs = new Map();
    this.resultCache = new Map();
  }
  cleanup() {
    for (const [id, job] of this.jobs) if (job.expiresAt <= this.now()) { job.deleted = true; this.jobs.delete(id); }
    for(const [key,value] of this.resultCache)if(!this.jobs.has(value.jobId))this.resultCache.delete(key);
  }
  rememberResult(job,index,media) {
    this.cleanup();
    if(job.deleted || !this.jobs.has(job.id))return;
    const key=job.id+':'+index;
    this.resultCache.delete(key);
    let bytes=[...this.resultCache.values()].reduce((n,item)=>n+item.media.bytes.length,0);
    for(const [oldKey,old] of this.resultCache){
      if(bytes+media.bytes.length<=32*1024*1024)break;
      this.resultCache.delete(oldKey);bytes-=old.media.bytes.length;
    }
    if(media.bytes.length<=32*1024*1024)this.resultCache.set(key,{jobId:job.id,media});
  }
  get(id, owner) {
    this.cleanup();
    const job = this.jobs.get(id);
    if (!job || job.owner !== owner) throw new AppError('NOT_FOUND', 'This comparison has expired or was cleared. Start a new session.', 404);
    return job;
  }
  view(job) {
    return {
      id: job.id, mode: job.mode, state: job.state, createdAt: job.createdAt, expiresAt: job.expiresAt,
      error: job.error, retryAt: job.retryAt, uploadsConfirmed: job.uploadsConfirmed,
      canResume: job.state === 'paused' || (job.state === 'uncertain' && job.items.some(item => item.taskId && !['success', 'error'].includes(item.state))),
      items: job.items.map((item, index) => ({ label: item.label, productId: item.productId, state: item.state, error: item.error,
        hasProviderTask: Boolean(item.taskId),
        result: item.state === 'success' ? (job.mode === 'fixture' ? `/fixtures/${item.productId}-on-wrist.svg` : `/api/jobs/${job.id}/results/${index}`) : null,
      })),
    };
  }
  async create(input, owner, key) {
    this.cleanup();
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(key || '')) throw new AppError('IDEMPOTENCY_REQUIRED', 'A valid comparison request ID is required.');
    const mode = input?.mode;
    if (!['fixture', 'live'].includes(mode)) throw new AppError('MODE_INVALID', 'Choose a valid preview mode.');
    const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const existing = [...this.jobs.values()].find(j => j.owner === owner && j.key === key);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new AppError('REQUEST_CHANGED', 'This request ID belongs to a different comparison.', 409);
      return existing;
    }
    const pendingKey = owner + ':' + key;
    if (this.pending.has(pendingKey)) {
      const pending = this.pending.get(pendingKey);
      if (pending.fingerprint !== fingerprint) throw new AppError('REQUEST_CHANGED', 'This request ID belongs to a different comparison.', 409);
      return pending.promise;
    }
    if (mode === 'live' && !this.liveEnabled) throw new AppError('LIVE_DISABLED', 'Live YouCam previews need an approved API key and unit-usage permission on the server.', 503);
    if ([...this.jobs.values()].filter(j => j.owner === owner).length >= 6 || this.jobs.size + this.pending.size >= 100 || [...this.pending.keys()].filter(k => k.startsWith(owner + ':')).length >= 2) {
      throw new AppError('CAPACITY', 'Clear an old comparison before creating another.', 429);
    }
    const epoch = this.epochs.get(owner) || 0;
    const promise = this.prepare(input, owner, key, fingerprint, epoch);
    this.pending.set(pendingKey, { fingerprint, promise });
    try { return await promise; } finally { this.pending.delete(pendingKey); }
  }
  async prepare(input, owner, key, fingerprint, epoch) {
    let images;
    if (input.mode === 'live') {
      if (input.consent?.version !== 'photo-transfer-v1' || input.consent?.rights !== true || input.consent?.transfer !== true || input.consent?.units !== true) {
        throw new AppError('CONSENT_REQUIRED', 'Confirm image rights, photo transfer to YouCam, and API unit use before continuing.');
      }
      if (!Array.isArray(input.products) || input.products.length !== 2) throw new AppError('PRODUCTS_REQUIRED', 'Choose two watch product images.');
      images = await Promise.all([validateImage(input.source), ...input.products.map(p => validateImage(p?.image))]);
    } else {
      if (input.source || input.products) throw new AppError('FIXTURE_ONLY', 'Demo mode accepts fixture IDs only. Personal images are never sent in demo mode.');
      if (!Array.isArray(input.productIds) || input.productIds.length !== 2 || new Set(input.productIds).size !== 2 || input.productIds.some(p => !labels[p])) throw new AppError('FIXTURE_INVALID', 'Choose two different sample watches.');
      if (!['success','rate-limit','detection','timeout'].includes(input.scenario || 'success')) throw new AppError('SCENARIO_INVALID', 'Choose a known demo scenario.');
    }
    if ((this.epochs.get(owner) || 0) !== epoch) throw new AppError('SESSION_CLEARED', 'This session was cleared while preparing the comparison.', 409);
    const job = {
      id: randomUUID(), owner, key, fingerprint, mode: input.mode, createdAt: this.now(), expiresAt: this.now() + TTL_MS,
      state: 'uploading', scenario: input.scenario || 'success', polls: 0, uploadsConfirmed: 0,
      items: input.mode === 'fixture'
        ? input.productIds.map(id => ({ label: labels[id], productId: id, state: 'queued' }))
        : input.products.map((p, i) => ({ label: String(p.label || `Watch ${i + 1}`).trim().slice(0, 60), state: 'queued' })),
    };
    this.jobs.set(job.id, job);
    // The runner retains sanitized bytes only while transferring them. Never store images in the job record.
    this.launch(job, images).catch(error => {
      if (job.deleted) return;
      job.error = publicError(error);
      job.state = job.items.some(i => i.taskId) ? 'paused' : (job.uploadsConfirmed === 3 ? 'uncertain' : 'error');
      if (job.state === 'uncertain') job.error = { code: 'SUBMISSION_UNCERTAIN', message: 'Task creation was not acknowledged. Check your YouCam console before starting another comparison; units may have been used.' };
    });
    return job;
  }
  async launch(job, images) {
    if (job.mode === 'fixture') { job.state = 'running'; job.items.forEach(i => i.state = 'running'); return; }
    const ids = [];
    for (const image of images) {
      if (job.deleted) return;
      ids.push(await this.adapter.upload(image)); job.uploadsConfirmed++;
    }
    // Create separately so recovery preserves each acknowledged task ID if the second submission fails.
    for (let i = 0; i < 2; i++) {
      if (job.deleted) return;
      job.items[i].state = 'submitting';
      job.items[i].taskId = await this.adapter.create(ids[0], ids[i + 1]);
      job.items[i].state = 'running';
    }
    job.state = 'running';
  }
  async refresh(job, resume = false) {
    if (['success','error','uploading'].includes(job.state) || job.deleted) return job;
    // An unacknowledged second submission must not strand an acknowledged first task.
    // Only explicit resume may check that known task; it never creates a replacement.
    if (job.state === 'uncertain' && (!resume || !job.items.some(item => item.taskId && !['success','error'].includes(item.state)))) return job;
    if (job.refreshPromise) return job.refreshPromise;
    const promise = this.doRefresh(job, resume).finally(() => { job.refreshPromise = null; });
    job.refreshPromise = promise;
    return promise;
  }
  async doRefresh(job, resume) {
    if (job.retryAt > this.now()) return job;
    if (job.lastPoll && this.now() - job.lastPoll < POLL_MS) return job;
    if (['paused','uncertain'].includes(job.state) && !resume) return job;
    job.pollStarted ??= this.now();
    if (resume) { job.pollStarted = this.now(); job.state = 'running'; job.error = null; }
    if (this.now() - job.pollStarted > POLL_WINDOW_MS) {
      job.state = 'paused'; job.error = { code: 'POLL_TIMEOUT', message: 'Still waiting. Check the same task again without creating another render.' }; return job;
    }
    job.lastPoll = this.now(); job.polls++;
    if (job.mode === 'fixture') {
      if (this.now() - job.createdAt < this.fixtureDelay) return job;
      if (job.scenario === 'rate-limit' && !job.fixtureLimited) {
        job.fixtureLimited = true; job.state = 'paused'; job.retryAt = this.now() + 5000;
        job.error = { code: 'PROVIDER_RATE_LIMIT', message: 'Simulated YouCam rate limit. Wait 5 seconds, then check the same task.' }; return job;
      }
      if (job.scenario === 'timeout' && !job.fixtureTimedOut) {
        job.fixtureTimedOut = true; job.state = 'paused'; job.retryAt = this.now() + POLL_MS; job.error = { code: 'POLL_TIMEOUT', message: 'Simulated slow task. Check the same task again; no second render is created.' }; return job;
      }
      job.items.forEach((item, i) => {
        item.state = job.scenario === 'detection' && i === 1 ? 'error' : 'success';
        if (item.state === 'error') item.error = { code: 'PHOTO_DETECTION_FAIL', message: 'Simulated detection failure. Retake a photo with all five fingers visible.' };
      });
      job.state = job.items.every(i => i.state === 'success') ? 'success' : 'error';
      return job;
    }
    for (const item of job.items) {
      if (job.deleted) return job;
      if (!item.taskId || ['success', 'error'].includes(item.state)) continue;
      try { Object.assign(item, await this.adapter.poll(item.taskId)); }
      catch (error) {
        job.state = 'paused'; job.error = publicError(error); job.retryAt = this.now() + (error.retryAfter || 5) * 1000; return job;
      }
    }
    if (job.items.every(i => i.state === 'success')) job.state = 'success';
    else if (job.items.some(i => !i.taskId && i.state === 'submitting')) {
      job.state = 'uncertain'; job.error = { code: 'SUBMISSION_UNCERTAIN', message: 'One task was not acknowledged. Existing results are preserved. Check your YouCam console before creating another comparison.' };
    }
    else if (job.items.every(i => ['success','error'].includes(i.state))) job.state = 'error';
    return job;
  }
  clear(owner) {
    if ([...this.pending.keys()].some(k => k.startsWith(owner + ':'))) this.epochs.set(owner, (this.epochs.get(owner) || 0) + 1);
    for (const [id, job] of this.jobs) if (job.owner === owner) { job.deleted = true; this.jobs.delete(id); }
    this.cleanup();
  }
}
