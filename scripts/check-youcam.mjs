import { writeFile } from 'node:fs/promises';
import { checkYouCam } from '../server/preflight.mjs';
const report=await checkYouCam({apiKey:process.env.YOUCAM_API_KEY});
await writeFile(new URL('../qa/provider-preflight.json',import.meta.url),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
// A pricing observation still does not mean the project is ready for submission or unit use.
process.exitCode=report.status==='pricing_observed' ? 0 : 2;
