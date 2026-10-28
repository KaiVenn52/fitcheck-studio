import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
const directory = new URL('../public/fixtures/', import.meta.url);
await mkdir(directory, { recursive: true });
const styles = {
  field: { strap: '#455944', face: '#f0e5c7', metal: '#b1b6ad', ink: '#344432' },
  dress: { strap: '#71503b', face: '#f9f4e8', metal: '#c7a778', ink: '#4e4333' },
  diver: { strap: '#343e44', face: '#244652', metal: '#b5c1c2', ink: '#edf0e3' },
};
function watch(id) {
  const c = styles[id];
  const ticks = Array.from({ length: 12 }, (_, i) => `<path d="M0 -55v${i % 3 ? 5 : 10}" transform="rotate(${i * 30})" stroke="${c.ink}" stroke-width="${i % 3 ? 1.5 : 3}"/>`).join('');
  return `<g><rect x="-36" y="-158" width="72" height="316" rx="14" fill="${c.strap}"/><path d="M-28 -145v290M28 -145v290" stroke="#ffffff" opacity=".16" stroke-dasharray="3 5"/><rect x="-48" y="-78" width="96" height="156" rx="12" fill="${c.metal}"/><rect x="70" y="-9" width="10" height="19" rx="3" fill="${c.metal}"/><circle r="75" fill="${c.metal}"/><circle r="67" fill="${c.face}"/><circle r="62" fill="none" stroke="${c.ink}" opacity=".3"/>${ticks}<path d="M0 0l-26 -28M0 0l34 -41" fill="none" stroke="${c.ink}" stroke-width="4" stroke-linecap="round"/><circle r="4" fill="${c.ink}"/><text y="31" font-family="sans-serif" font-size="7" letter-spacing="2" fill="${c.ink}" text-anchor="middle">SAMPLE</text></g>`;
}
const hand = `<g fill="#ceae8c" stroke="#9f8062" stroke-width="1.5"><path d="M212 660l8-196c-10-31-22-66-33-98l-38-89q-8-22 5-28t25 17l33 56-17-163q-3-22 12-24t20 19l18 134-1-176q0-23 16-23t18 24l9 175 11-157q2-21 17-19t15 24l-3 173 18-116q4-22 18-18t12 24l-13 155c8 41 5 83-8 117l10 194z"/><path d="M231 433q46 12 98-3M224 448q44 13 108-1M241 305l6 58M280 305l1 61M314 319l-6 43" fill="none" opacity=".4"/></g>`;
const svg = body => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 560 660" width="560" height="660"><rect width="560" height="660" fill="#e9e6dc"/><path d="M40 45h20M40 45v20M520 45h-20M520 45v20M40 615h20M40 615v-20M520 615h-20M520 615v-20" stroke="#b7b5a6" fill="none"/><text x="40" y="90" font-family="sans-serif" font-size="10" letter-spacing="2" fill="#6a7064">FITCHECK / LOCAL ILLUSTRATION</text>${body}</svg>`;
await writeFile(new URL('wrist.svg', directory), svg(hand));
for (const id of Object.keys(styles)) {
  await writeFile(new URL(`${id}.svg`, directory), svg(`<g transform="translate(280 335) scale(1.3)">${watch(id)}</g>`));
  await writeFile(new URL(`${id}-on-wrist.svg`, directory), svg(`${hand}<g transform="translate(276 456) rotate(-4) scale(.86)">${watch(id)}</g>`));
}
// Explicitly synthetic test raster; never used for live provider validation.
await sharp(Buffer.from(svg(hand))).resize({width:640}).png().toFile(fileURLToPath(new URL('../../tests/fixture-input.png', directory)));
console.log('Created original vector workflow fixtures and one PNG test input. No AI or provider images used.');
