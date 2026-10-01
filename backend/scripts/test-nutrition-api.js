#!/usr/bin/env node
// Calls a running backend's POST /api/nutrition for a list of dishes and
// prints a table (console only — writes no files).
//   PORT=3100 node server.js        (in one terminal)
//   node scripts/test-nutrition-api.js [baseUrl]
'use strict';

const base = process.argv[2] || 'http://localhost:3100';
const D = { size: 'M', cookingMethod: '水煮', sugar: '無糖', salt: '無鹽' };
const dishes = [
  ['白飯', 'food', 'bowl'], ['炒麵', 'food', 'plate'], ['花椰菜', 'food', 'plate'],
  ['香蕉', 'food', 'plate'], ['蘋果切片', 'food', 'plate'], ['義式拿鐵', 'beverage', 'cup'],
  ['黑咖啡', 'beverage', 'cup'], ['水煮蛋', 'food', 'plate'], ['番茄炒蛋', 'food', 'plate'],
  ['煎餃', 'food', 'plate'], ['照燒雞', 'food', 'plate'], ['玉米', 'food', 'plate'],
  ['高麗菜', 'food', 'plate'], ['雞腿便當', 'food', 'plate']
];

async function call(name, category, containerType, over = {}){
  const res = await fetch(`${base}/api/nutrition`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, category, containerType, ...D, ...over })
  });
  return res.json();
}
const row = r => r.status === 'ok'
  ? `${r.match} | ${r.matchedName} | ${r.source} | ${r.kcal} kcal (P${r.proteinG} F${r.fatG} C${r.carbohydrateG} Na${r.sodiumMg}) | ${r.explanation}`
  : `${r.status} | ${r.explanation || r.error}`;

(async () => {
  for (const [n, c, k] of dishes){
    const sugar = c === 'beverage' ? '無糖' : D.sugar;
    console.log(`【${n}】 M ${k}: ${row(await call(n, c, k, { sugar }))}`);
  }
  console.log('\n-- 白飯 size');
  for (const s of ['XS', 'M', 'XL']) console.log(`  ${s}: ${row(await call('白飯', 'food', 'bowl', { size: s }))}`);
  console.log('\n-- 白飯 salt (only sodium may change)');
  for (const s of ['無鹽', '1/2 茶匙', '1 茶匙']) console.log(`  ${s}: ${row(await call('白飯', 'food', 'bowl', { salt: s }))}`);
  console.log('\n-- 白飯 cooking/sugar (nothing may change)');
  for (const [m, s] of [['水煮', '無糖'], ['炒', '全糖'], ['煎', '半糖']]) {
    console.log(`  ${m}/${s}: ${row(await call('白飯', 'food', 'bowl', { cookingMethod: m, sugar: s }))}`);
  }
  console.log('\n-- bad input');
  console.log('  ', JSON.stringify(await call('白飯', 'food', 'bowl', { size: 'XXL' })));
})();
