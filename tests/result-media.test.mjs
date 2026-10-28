import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {YouCamAdapter} from '../server/youcam.mjs';
const png=await readFile(new URL('./fixture-input.png',import.meta.url));
const make=(bytes,type)=>new YouCamAdapter({urlValidator:async u=>u,fetchImpl:async()=>new Response(bytes,{headers:{'Content-Type':type}})});
test('real-provider binary/octet-stream PNG is validated and served with canonical image MIME',async()=>{
 const result=await make(png,'binary/octet-stream').download('https://fixture.s3.amazonaws.com/result');
 assert.equal(result.type,'image/png');assert.deepEqual(result.bytes,png);
});
test('generic binary results cannot smuggle HTML or a truncated PNG',async()=>{
 for(const bytes of [Buffer.from('<html>not an image</html>'),png.subarray(0,40)]){
  await assert.rejects(make(bytes,'application/octet-stream').download('https://fixture.s3.amazonaws.com/result'),{code:'PROVIDER_RESULT_INVALID'});
 }
});
test('declared image content is decoded rather than trusted',async()=>{
 await assert.rejects(make(Buffer.from('<script>bad</script>'),'image/png').download('https://fixture.s3.amazonaws.com/result'),{code:'PROVIDER_RESULT_INVALID'});
 await assert.rejects(make(png,'text/html').download('https://fixture.s3.amazonaws.com/result'),{code:'RESULT_EXPIRED'});
});
