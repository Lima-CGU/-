/**
 * Calorie-calculation settings. EVERY number in this file is a placeholder
 * 【待老師確認】 (to be confirmed by the teacher) — change them here only;
 * nutrition-calc.js reads nothing else.
 */
'use strict';

/* 1. Size multipliers — applied to items measured in a discrete unit
 *    (份/碗/個/顆/片/根/條/粒/塊/隻/瓣/杯/盒/臺/湯匙/茶匙/把 …):
 *      total = database value × multiplier.
 *
 *    Shaped "per food category" so each category can get its own set later:
 *    put an entry in `byCategory`, keyed by the matched food's category
 *    (foods1000: its 分類 group; tfnd: its 食品分類). A category without an
 *    entry uses `default`. Right now NO category has its own set, so
 *    everything uses `default`.  M must stay 1.0.                */
const SIZE_MULTIPLIERS = {
  default: {                // 【待老師確認】
    XS: 0.5,                // 【待老師確認】
    S: 0.75,                // 【待老師確認】
    M: 1.0,                 // fixed — M is the database's own serving
    L: 1.5,                 // 【待老師確認】
    XL: 2.0                 // 【待老師確認】
  },
  byCategory: {
    // '<category name>': { XS: 0.5, S: 0.75, M: 1.0, L: 1.5, XL: 2.0 },
  }
};

/* 2. Portion table — only used when the matched item is measured in grams
 *    or millilitres: container × size -> roughly how many g / ml was served.
 *    Plates and bowls are grams, cups are millilitres (an item in the other
 *    kind of unit is treated 1 ml ≈ 1 g).                        */
const PORTION_TABLE = {
  plate: { unit: 'g',  XS: 100, S: 150, M: 250, L: 350, XL: 450 },   // 盤子 【待老師確認】
  bowl:  { unit: 'g',  XS: 100, S: 150, M: 200, L: 300, XL: 400 },   // 碗   【待老師確認】
  cup:   { unit: 'ml', XS: 150, S: 250, M: 350, L: 500, XL: 700 }    // 杯子 【待老師確認】
};
const CONTAINER_LABELS = { plate: '盤子', bowl: '碗', cup: '杯子' };

/* 3. Salt: teaspoons of added salt per answer. Salt only changes sodium. */
const SALT_TEASPOONS = {        // 【待老師確認】
  '無鹽': 0,
  '1/4茶匙': 0.25,
  '1/2茶匙': 0.5,
  '3/4茶匙': 0.75,
  '1茶匙': 1
};
const SODIUM_MG_PER_TEASPOON = 2358; // 【待老師確認】

/* Sanity check: a converted result above this many kcal per gram is treated
 * as bad data (pure fat is ~9). 【待老師確認】 */
const MAX_KCAL_PER_GRAM = 9.5;

/* Units that are weights / volumes (continuous). Anything else in the
 * foods1000 unit column is a discrete serving. */
const CONTINUOUS_UNIT = /^(公克|克|g\b|毫升|ml\b|c\.?c\.?)/i;

module.exports = {
  SIZE_MULTIPLIERS, PORTION_TABLE, CONTAINER_LABELS, SALT_TEASPOONS,
  SODIUM_MG_PER_TEASPOON, MAX_KCAL_PER_GRAM, CONTINUOUS_UNIT
};
