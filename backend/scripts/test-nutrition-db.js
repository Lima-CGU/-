#!/usr/bin/env node
// Prints the top matches for a list of keywords so the matching can be
// eyeballed:  node scripts/test-nutrition-db.js [keyword ...]
'use strict';

const { searchFoods, getMeta } = require('../nutrition-db');

const keywords = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['雞蛋', '番茄', '白飯', '麵條', '高麗菜', '豬肉', '雞腿', '大豆油', '砂糖', '牛奶'];

const meta = getMeta();
console.log(`TFND: ${meta.foodCount} foods, source file ${meta.sourceFile}; kcal = ${meta.kcalField}\n`);

for (const kw of keywords){
  const hits = searchFoods(kw, { limit: 5 });
  console.log(`【${kw}】 ${hits.length ? '' : '(no match)'}`);
  hits.forEach((h, i) => {
    const f = h.food;
    const via = h.matchedOn !== f.name ? ` (俗名「${h.matchedOn}」)` : '';
    console.log(`  ${i + 1}. ${f.name}${via}  ${f.per100g.kcal} kcal/100g  [${h.matchType}] ${f.id} ${f.category} — ${f.description}`);
  });
  console.log('');
}
