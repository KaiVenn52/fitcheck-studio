import dns from 'node:dns/promises';
import { BlockList } from 'node:net';
import { AppError } from './errors.mjs';
import sharp from 'sharp';
const BASE = 'https://yce-api-01.makeupar.com';
const TASK = '/s2s/v2.0/task/2d-vto/watch';
const blocked = new BlockList();
const blocked6 = new BlockList();
for (const [ip, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.168.0.0',16],['192.0.0.0',24],['198.18.0.0',15],['224.0.0.0',4],['240.0.0.0',4]]) blocked.addSubnet(ip, prefix);
for (const [ip, prefix] of [['::',128],['::1',128],['::ffff:0:0',96],['fc00::',7],['fe80::',10],['ff00::',8]]) blocked6.addSubnet(ip, prefix, 'ipv6');
export async function safeProviderUrl(value, lookup = dns.lookup) {
  let url;
  try { url = new URL(value); } catch { throw new AppError('PROVIDER_SCHEMA', 'YouCam returned an invalid media address.', 502); }
  const hosts = ['makeupar.com', 'perfectcorp.com', 'amazonaws.com'];
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !hosts.some(h => url.hostname === h || url.hostname.endsWith('.' + h))) {
    throw new AppError('PROVIDER_MEDIA_HOST', 'YouCam returned a media host that needs review. The result has not been fetched.', 502);
  }
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(a => a.family === 6 ? blocked6.check(a.address, 'ipv6') : blocked.check(a.address, 'ipv4'))) {
    throw new AppError('PROVIDER_MEDIA_HOST', 'YouCam returned an unsafe media address.', 502);
  }
  return url.href;
}
const messageFor = (code) => ({
  CreditInsufficiency: 'Your YouCam account has insufficient units. No task will be automatically resubmitted.',
  PHOTO_DETECTION_FAIL: 'YouCam could not find a clear hand. Use a photo showing the back of your wrist and all five fingers.',
  PHOTO_CHECK_INVALID: 'YouCam could not use this pose. Keep your whole hand visible and unobstructed.',
  OBJECT_DETECTION_FAIL: 'YouCam could not find the watch. Use a clear, upright, front-facing product photo.',
  error_pose: 'YouCam could not use this pose. Please review the photo guide.',
  error_decode_image: 'YouCam could not decode the image.',
}[code] || 'YouCam could not complete this preview. Review your images before starting a new comparison.');

export class YouCamAdapter {
  constructor({ apiKey, fetchImpl = fetch, urlValidator = safeProviderUrl } = {}) {
    this.apiKey = apiKey; this.fetch = fetchImpl; this.urlValidator = urlValidator;
  }
  async request(path, { method = 'GET', body } = {}) {
    let response;
    try {
      response = await this.fetch(BASE + path, {
        method, headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(25000),
      });
    } catch {
      throw new AppError('PROVIDER_UNREACHABLE', 'YouCam did not acknowledge the request. Do not resubmit automatically.', 502);
    }
    const data = await response.json().catch(() => null);
    if (response.status === 401 || response.status === 403) throw new AppError('PROVIDER_AUTH', 'The YouCam API key is missing permission or has expired.', 502);
    if (response.status === 429) throw new AppError('PROVIDER_RATE_LIMIT', 'YouCam is busy. Wait before checking the same task again.', 429, Math.min(120, Math.max(5, Number(response.headers.get('retry-after')) || 10)));
    if (!response.ok || (data?.status && data.status !== 200)) {
      throw new AppError(data?.error_code === 'CreditInsufficiency' ? 'PROVIDER_CREDITS' : 'PROVIDER_ERROR', messageFor(data?.error_code), 502);
    }
    if (!data) throw new AppError('PROVIDER_SCHEMA', 'YouCam returned an unreadable response.', 502);
    return data;
  }
  async upload(image) {
    const payload = await this.request('/s2s/v2.0/file', { method: 'POST', body: { files: [{ content_type: image.type, file_name: 'fitcheck-input.jpg', file_size: image.buffer.length }] } });
    // The downloadable OpenAPI and guide disagree on wrapper nesting. Accept only the two documented wrapper forms.
    const files = payload.data?.files ?? payload.files;
    const file = files?.[0];
    if (files?.length !== 1 || typeof file?.file_id !== 'string' || !Array.isArray(file.requests) || !file.requests.length) {
      throw new AppError('PROVIDER_SCHEMA', 'YouCam did not return complete upload instructions.', 502);
    }
    for (const instruction of file.requests) {
      if (instruction.method !== 'PUT') throw new AppError('PROVIDER_SCHEMA', 'Unsupported provider upload method.', 502);
      const url = await this.urlValidator(instruction.url);
      const headers = instruction.headers ?? {};
      if (Object.keys(headers).some(k => /authorization|cookie|host|proxy/i.test(k))) throw new AppError('PROVIDER_SCHEMA', 'Unexpected provider upload headers.', 502);
      let result;
      try { result = await this.fetch(url, { method: 'PUT', headers, body: image.buffer, redirect: 'error', signal: AbortSignal.timeout(25000) }); }
      catch { throw new AppError('UPLOAD_FAILED', 'Photo transfer to YouCam could not be confirmed.', 502); }
      if (!result.ok) throw new AppError('UPLOAD_FAILED', 'YouCam storage rejected the image transfer.', 502);
    }
    return file.file_id;
  }
  async create(sourceId, productId) {
    const data = await this.request(TASK, { method: 'POST', body: {
      src_file_id: sourceId, ref_file_ids: [productId],
      source_info: { name: sourceId },
      object_infos: [{ name: productId, parameter: { watch_need_remove_background: true, watch_shadow_intensity: 0.3, watch_ambient_light_intensity: 1 } }],
    } });
    if (typeof data.data?.task_id !== 'string' || !data.data.task_id) throw new AppError('PROVIDER_SCHEMA', 'YouCam did not return a task ID. The submission may have been accepted; do not blindly retry.', 502);
    return data.data.task_id;
  }
  async poll(taskId) {
    const payload = await this.request(TASK + '/' + encodeURIComponent(taskId));
    const data = payload.data;
    if (!['running', 'success', 'error'].includes(data?.task_status)) throw new AppError('PROVIDER_SCHEMA', 'YouCam returned an unrecognized task status.', 502);
    if (data.task_status === 'error') return { state: 'error', error: { code: 'PROVIDER_RENDER', message: messageFor(data.error) } };
    if (data.task_status === 'running') return { state: 'running' };
    // Response schema defines a single-url results object. Top-level url is the $ref form in that same schema.
    const value = data.results?.url ?? data.url ?? payload.url;
    if (typeof value !== 'string') throw new AppError('PROVIDER_SCHEMA', 'YouCam marked the task complete without a usable result URL.', 502);
    return { state: 'success', resultUrl: await this.urlValidator(value) };
  }
  async download(url) {
    const safe = await this.urlValidator(url);
    const response = await this.fetch(safe, { redirect: 'error', signal: AbortSignal.timeout(25000) });
    const declaredType=response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
    // Real YouCam result storage also returns PNG files as binary/octet-stream.
    // Treat that header as transport metadata; decode bounded bytes before serving an image.
    if (!response.ok || !['image/jpeg','image/png','application/octet-stream','binary/octet-stream'].includes(declaredType)) throw new AppError('RESULT_EXPIRED', 'This preview is unavailable or expired. It has not been re-generated.', 410);
    if (Number(response.headers.get('content-length')) > 20 * 1024 * 1024) throw new AppError('RESULT_SIZE', 'The result is too large to display safely.', 502);
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 20 * 1024 * 1024) throw new AppError('RESULT_SIZE', 'The result is too large to display safely.', 502);
      chunks.push(chunk);
    }
    const bytes=Buffer.concat(chunks);
    let format;
    try {
      const decoded=sharp(bytes,{limitInputPixels:4096*4096,failOn:'warning'});
      const info=await decoded.metadata();
      if(!['jpeg','png'].includes(info.format) || (info.pages||1)!==1 || info.width>4096 || info.height>4096)throw new Error('Unsupported result');
      await decoded.stats(); // Fully decode; a forged PNG header is not sufficient.
      format=info.format;
    }catch{throw new AppError('PROVIDER_RESULT_INVALID','YouCam returned a result that could not be decoded as a safe PNG or JPEG.',502);}
    return { bytes, type: format==='png'?'image/png':'image/jpeg' };
  }
}
