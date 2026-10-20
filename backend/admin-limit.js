/**
 * Wrong-password limit for /api/admin/*: an IP with MAX_FAILURES wrong
 * ADMIN_TOKENs within WINDOW_MS is refused (429) until the oldest of those
 * failures is older than the window — even with the right token, so
 * guessing can't continue. A correct token clears that IP's failures.
 * In memory only (a restart forgets it), which is enough to stop guessing.
 */
'use strict';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;

function createFailureLimiter({ windowMs = WINDOW_MS, maxFailures = MAX_FAILURES, now = () => Date.now() } = {}){
  const failures = new Map(); // ip -> [timestamps]
  const recent = ip => {
    const t = now();
    const list = (failures.get(ip) || []).filter(x => t - x < windowMs);
    if (list.length) failures.set(ip, list); else failures.delete(ip);
    return list;
  };
  return {
    // seconds until this IP may try again; 0 = not blocked
    blockedFor(ip){
      const list = recent(ip);
      if (list.length < maxFailures) return 0;
      return Math.max(1, Math.ceil((list[list.length - maxFailures] + windowMs - now()) / 1000));
    },
    fail(ip){
      const list = recent(ip);
      list.push(now());
      failures.set(ip, list);
      if (failures.size > 10000){ // never grow without bound
        for (const key of failures.keys()){ recent(key); if (failures.size <= 5000) break; }
      }
    },
    succeed(ip){ failures.delete(ip); }
  };
}

module.exports = { createFailureLimiter, WINDOW_MS, MAX_FAILURES };
