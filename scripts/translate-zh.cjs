// Batch translate English locale JSON to Chinese using Google Translate API
const fs = require('fs');
const path = require('path');

const enPath = path.join(__dirname, '..', 'src', 'renderer', 'src', 'assets', 'locales', 'en', 'en.json');
const zhPath = path.join(__dirname, '..', 'src', 'renderer', 'src', 'assets', 'locales', 'zh', 'zh.json');

const en = JSON.parse(fs.readFileSync(enPath, 'utf-8'));

// Known good translations (manual + previously generated)
const known = JSON.parse(fs.readFileSync(zhPath, 'utf-8'));

// Collect all leaf string values that still have English
function collectUntranslated(obj, prefix = '') {
  const result = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      // Check if it looks like English (has Latin chars and not just punctuation/numbers)
      if (/[a-zA-Z]{3,}/.test(value) && !value.startsWith('{{') && !value.includes('$t(')) {
        result.push({ key: fullKey, value });
      }
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result.push(...collectUntranslated(value, fullKey));
    }
  }
  return result;
}

const untranslated = collectUntranslated(known);
console.log(`Found ${untranslated.length} untranslated strings`);

// Translate function using Google Translate
const { translate } = require('@vitalets/google-translate-api');

async function translateAll() {
  // Deduplicate by value to minimize API calls
  const uniqueValues = [...new Set(untranslated.map(x => x.value))];
  console.log(`Unique values to translate: ${uniqueValues.length}`);

  // Batch translate (limit to avoid rate limiting)
  const translationMap = {};
  for (let i = 0; i < uniqueValues.length; i++) {
    const val = uniqueValues[i];
    if ((i + 1) % 20 === 0) {
      console.log(`Progress: ${i + 1}/${uniqueValues.length}`);
      // Small delay every 20 to avoid rate limit
      await new Promise(r => setTimeout(r, 1000));
    }
    try {
      const result = await translate(val, { from: 'en', to: 'zh-CN' });
      translationMap[val] = result.text;
    } catch (err) {
      console.error(`Failed to translate: "${val.substring(0, 50)}" - ${err.message}`);
      translationMap[val] = val; // Keep original
    }
  }

  // Apply translations back
  function applyTranslation(obj) {
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string' && translationMap[value]) {
        obj[key] = translationMap[value];
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        applyTranslation(value);
      }
    }
    return obj;
  }

  const result = applyTranslation(known);
  fs.writeFileSync(zhPath, JSON.stringify(result, null, 2), 'utf-8');
  console.log('Done! Written to', zhPath);
}

translateAll().catch(console.error);
