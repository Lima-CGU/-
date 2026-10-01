#!/usr/bin/env node
// Prints the top matches for a list of dish names so the matching can be
// eyeballed:  node scripts/test-nutrition-db.js [--limit=N] [name ...]
// Loads foods1000 from Firestore the same way the server does (prints to the
// console only — writes no files).
'use strict';

const nutrition = require('../nutrition-db');

const args = process.argv.slice(2);
const limitArg = args.find(a => a.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : 3;
const names = args.filter(a => !a.startsWith('--'));
const keywords = names.length ? names : ['白飯', '炒麵', '花椰菜', '香蕉', '蘋果切片', '義式拿鐵', '黑咖啡',
  '水煮蛋', '番茄炒蛋', '煎餃', '照燒雞', '玉米', '高麗菜', '雞腿便當'];

(async () => {
  await nutrition.init();
  const s = nutrition.getStatus();
  console.log(`foods1000: ${s.foods1000} (${s.foods1000Count})${s.foods1000Error ? ' — ' + s.foods1000Error : ''}; tfnd: ${s.tfndCount}\n`);
  for (const kw of keywords){
    const hits = nutrition.searchFoods(kw, { limit });
    console.log(`【${kw}】${hits.length ? '' : ' (no match)'}`);
    hits.forEach((h, i) => {
      const per = h.basis === 'perUnit' ? `per 1 ${h.unit} (${h.weightText || '?'} g)` : 'per 100 g';
      const via = h.matchedOn !== h.name ? ` 〔via「${h.matchedOn}」〕` : '';
      console.log(`  ${i + 1}. ${h.name}${via}  ${h.kcal} kcal ${per}  [${h.source} · ${h.matchType}]`);
    });
  }
  process.exit(0);
})();
