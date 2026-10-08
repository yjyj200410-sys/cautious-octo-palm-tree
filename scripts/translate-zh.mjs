import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { translate } from '@vitalets/google-translate-api';
import { HttpsProxyAgent } from 'https-proxy-agent';

const zhPath = resolve(import.meta.dirname, '..', 'src/renderer/src/assets/locales/zh/zh.json');
const zh = JSON.parse(readFileSync(zhPath, 'utf-8'));
const agent = new HttpsProxyAgent('http://172.24.0.1:7897');

function collectStrings(obj) {
  const result = [];
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      if (/[a-zA-Z]{2,}/.test(value) && !value.startsWith('{{count}}') && !value.startsWith('$t(')) {
        result.push(value);
      }
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result.push(...collectStrings(value));
    }
  }
  return result;
}

const strings = collectStrings(zh);
const unique = [...new Set(strings)];
console.log(`Still need: ${unique.length} unique`);

const map = {};
let done = 0;
const BATCH = 50;
const DELAY = 5000; // 5秒一批

for (let i = 0; i < unique.length; i += BATCH) {
  const batch = unique.slice(i, i + BATCH);
  console.log(`Batch ${Math.floor(i/BATCH)+1}/${Math.ceil(unique.length/BATCH)} (${i+1}-${Math.min(i+BATCH, unique.length)})`);

  for (const text of batch) {
    try {
      const result = await translate(text, { from: 'en', to: 'zh-CN', fetchOptions: { agent } });
      map[text] = result.text;
      done++;
    } catch (e) {
      // skip rate-limited
    }
    await new Promise(r => setTimeout(r, 200));
  }

  if (i + BATCH < unique.length) {
    console.log(`  Done batch, waiting ${DELAY/1000}s...`);
    await new Promise(r => setTimeout(r, DELAY));
  }
}

console.log(`Newly translated: ${done}/${unique.length}`);

function apply(obj) {
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string' && map[value]) {
      obj[key] = map[value];
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      apply(value);
    }
  }
  return obj;
}

const result = apply(zh);
writeFileSync(zhPath, JSON.stringify(result, null, 2), 'utf-8');
console.log(`Done. Total translated confirmed:`, Object.keys(map).length);
