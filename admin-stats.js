/**
 * Admin page statistics (also loaded by Node for tests).
 *
 *   PictaAdminStats.overview(rows, { hideExcluded })
 *     rows: the summaries from GET /api/admin/records
 *     -> { A: {...}, B: {...}, C: {...} } with, per group:
 *        records, participants,
 *        correctionSec / totalSec / userActionCount: { mean, sd, n },
 *        aiProcessingSec: { mean, n }
 *
 * mean / sd use only the meals that have the value (n of them); sd is the
 * sample standard deviation (n − 1), null when n < 2. Values are not
 * rounded here — the page shows 2 decimals.
 */
(function (root, factory){
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PictaAdminStats = factory();
})(typeof self !== 'undefined' ? self : this, function (){
  'use strict';

  const GROUPS = ['A', 'B', 'C'];
  // no pid in the URL = TEST; automated tests = DEVTEST (same list as backend/records.js)
  const TEST_PIDS = ['TEST', 'DEVTEST'];
  const isHidden = r => !!r.excluded || TEST_PIDS.includes(r.pid);

  function describe(values){
    const v = values.filter(x => typeof x === 'number' && Number.isFinite(x));
    const n = v.length;
    if (!n) return { mean: null, sd: null, n: 0 };
    const mean = v.reduce((a, b) => a + b, 0) / n;
    const sd = n < 2 ? null : Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
    return { mean, sd, n };
  }

  function overview(rows, opts = {}){
    const list = (Array.isArray(rows) ? rows : []).filter(r => !opts.hideExcluded || !isHidden(r));
    const out = {};
    GROUPS.forEach(g => {
      const rs = list.filter(r => r.group === g);
      const ai = describe(rs.map(r => r.aiProcessingSec));
      out[g] = {
        records: rs.length,
        participants: new Set(rs.map(r => r.pid)).size,
        correctionSec: describe(rs.map(r => r.correctionSec)),
        totalSec: describe(rs.map(r => r.totalSec)),
        userActionCount: describe(rs.map(r => r.userActionCount)),
        aiProcessingSec: { mean: ai.mean, n: ai.n }
      };
    });
    return out;
  }

  // 2 decimals for the table; '—' when there is no number
  const fmt = v => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(2) : '—');

  return { GROUPS, TEST_PIDS, isHidden, describe, overview, fmt };
});
