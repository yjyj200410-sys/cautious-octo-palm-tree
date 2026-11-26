import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const assets=path.join(root,'app/src/main/assets');fs.mkdirSync(assets,{recursive:true});
const model=fs.readFileSync(path.join(root,'../resources/coloros-mss/model.onnx'));
if(createHash('sha256').update(model).digest('hex')!=='c4e52f3d5e2c7d46d72ffffe16ea5a126c6bb8d034fd5f5e2fd0f04c2e1b3ff7')throw Error('Model checksum mismatch');
fs.writeFileSync(path.join(assets,'model.onnx'),model);
const frames=48000*10,b=Buffer.alloc(44+frames*4);
b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(2,22);b.writeUInt32LE(48000,24);b.writeUInt32LE(192000,28);b.writeUInt16LE(4,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(frames*4,40);
for(let n=0;n<frames;n++)for(let ch=0;ch<2;ch++){const t=n/48000;const s=.15*Math.sin(2*Math.PI*220*t)+.12*Math.sin(2*Math.PI*(ch?660:440)*t);b.writeInt16LE(Math.round(s*32767),44+n*4+ch*2);}
fs.writeFileSync(path.join(assets,'benchmark.wav'),b);
console.log('Verified model and generated synthetic benchmark audio.');
