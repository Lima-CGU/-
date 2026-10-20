/**
 * Study data: one Firestore document per saved meal.
 *
 *   meals/{recordId}   the whole record (no image), written by POST /api/records
 *   photos/{recordId}  the compressed JPEG (bytes field), only when one is sent
 *
 * Only this backend writes (firebase-admin, the service account); Firestore
 * security rules keep denying every client. The record id is the document
 * id, so a retried upload overwrites the same document instead of adding a
 * duplicate. Everything is validated first; a bad request gets a 400 with a
 * reason and never reaches Firestore.
 */
'use strict';

const crypto = require('crypto');

const MEALS = 'meals';
const PHOTOS = 'photos';
// Firestore's hard limit is 1 MiB per document (incl. field names); keep a margin.
const MAX_RECORD_BYTES = 900 * 1024;
const MAX_PHOTO_BYTES = 900 * 1024;
const MAX_DEPTH = 12;
const MAX_STRING = 5000;
// A = buttons/options, B = chat, C = chat + suggestion buttons
const GROUPS = ['A', 'B', 'C'];
const CHAT_GROUPS = ['B', 'C'];
// timing / interaction events (one list per meal)
const MAX_EVENTS = 3000;
const EVENT_ACTORS = ['user', 'system', 'ai'];
const EVENT_SOURCES = ['typed', 'voice', 'suggestion'];
const EVENT_STATUSES = ['success', 'failed', 'cancelled'];
const MEAL_ID_RE = /^[A-Za-z0-9_-]{0,20}$/;
const SAVE_PHOTOS = !/^(0|false|no|off)$/i.test(process.env.SAVE_PHOTOS || '');

class BadRequest extends Error {}

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isIso = v => typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v));

function need(cond, msg){ if (!cond) throw new BadRequest(msg); }

// Firestore rejects arrays directly inside arrays and field names like __x__;
// also bound depth and string length so one record can't be pathological.
function checkValue(v, where, depth, inArray){
  need(depth <= MAX_DEPTH, `${where}: nested too deeply`);
  if (v === null || typeof v === 'boolean') return;
  if (typeof v === 'number'){ need(Number.isFinite(v), `${where}: not a finite number`); return; }
  if (typeof v === 'string'){ need(v.length <= MAX_STRING, `${where}: string too long`); return; }
  if (Array.isArray(v)){
    need(!inArray, `${where}: arrays inside arrays are not allowed`);
    // events may hold up to MAX_EVENTS; every other list stays <= 1000
    need(v.length <= (where === 'record.events' ? MAX_EVENTS : 1000), `${where}: too many items`);
    v.forEach((x, i) => checkValue(x, `${where}[${i}]`, depth + 1, true));
    return;
  }
  need(isObj(v), `${where}: unsupported value`);
  for (const [k, x] of Object.entries(v)){
    need(k.length > 0 && k.length <= 100 && !/^__.*__$/.test(k) && !k.includes('/'), `${where}: bad field name "${k.slice(0, 20)}"`);
    checkValue(x, `${where}.${k}`, depth + 1, false);
  }
}

const optStr = (v, max) => v == null || (typeof v === 'string' && v.length <= max);
function validateEvent(e, where){
  need(isObj(e), `${where} must be an object`);
  need(Number.isInteger(e.seq) && e.seq >= 1, `${where}.seq must be an integer >= 1`);
  need(typeof e.event === 'string' && /^[a-z_]{1,40}$/.test(e.event), `${where}.event must be a lowercase name`);
  need(isIso(e.at), `${where}.at must be an ISO date`);
  need(typeof e.elapsedMs === 'number' && Number.isFinite(e.elapsedMs) && e.elapsedMs >= 0, `${where}.elapsedMs must be a number >= 0`);
  need(optStr(e.page, 40), `${where}.page must be a string`);
  need(EVENT_ACTORS.includes(e.actor), `${where}.actor must be user, system or ai`);
  need(e.target == null || (typeof e.target === 'number' && Number.isFinite(e.target)) || (typeof e.target === 'string' && e.target.length <= 80), `${where}.target must be a number or string`);
  need(optStr(e.field, 120), `${where}.field must be a string`);
  need(optStr(e.attemptId, 20), `${where}.attemptId must be a string`);
  need(e.source == null || EVENT_SOURCES.includes(e.source), `${where}.source must be typed, voice or suggestion`);
  need(EVENT_STATUSES.includes(e.status), `${where}.status must be success, failed or cancelled`);
  need(e.detail == null || isObj(e.detail), `${where}.detail must be an object`);
  // before / after: any JSON value (checked below with the whole record)
}

/** Throws BadRequest with a reason; returns the record ready to store. */
function validateRecord(r){
  need(isObj(r), 'record must be an object');
  need(typeof r.id === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(r.id), 'record.id: 8–80 letters, digits, - or _');
  need(typeof r.pid === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(r.pid), 'record.pid: 1–40 letters, digits, - or _');
  need(GROUPS.includes(r.group), 'record.group must be "A", "B" or "C"');
  need(typeof r.appVersion === 'string' && r.appVersion.length <= 80, 'record.appVersion must be a string');
  need(r.userAgent == null || (typeof r.userAgent === 'string' && r.userAgent.length <= 600), 'record.userAgent must be a string');
  need(isObj(r.times), 'record.times must be an object');
  for (const k of ['startedAt', 'nextAt', 'doneAt']) need(r.times[k] == null || isIso(r.times[k]), `record.times.${k} must be an ISO date`);
  need(r.times.durationSec == null || (typeof r.times.durationSec === 'number' && r.times.durationSec >= 0), 'record.times.durationSec must be a number >= 0');
  need(Array.isArray(r.dishes) && r.dishes.length <= 60, 'record.dishes must be an array (max 60)');
  r.dishes.forEach((d, i) => {
    need(isObj(d), `record.dishes[${i}] must be an object`);
    need(typeof d.name === 'string' && d.name.length <= 80, `record.dishes[${i}].name must be a string`);
    need(d.detail == null || isObj(d.detail), `record.dishes[${i}].detail must be an object`);
    need(d.nutrition == null || isObj(d.nutrition), `record.dishes[${i}].nutrition must be an object`);
  });
  need(r.aiDetections == null || (Array.isArray(r.aiDetections) && r.aiDetections.length <= 60), 'record.aiDetections must be an array');
  need(r.editLog == null || isObj(r.editLog), 'record.editLog must be an object');
  need(r.apiErrors == null || (Array.isArray(r.apiErrors) && r.apiErrors.length <= 300), 'record.apiErrors must be an array');
  need(r.nutrition == null || isObj(r.nutrition), 'record.nutrition must be an object');
  need(r.chat == null || (isObj(r.chat) && Array.isArray(r.chat.messages)), 'record.chat must be an object with messages');
  need(r.mealId == null || (typeof r.mealId === 'string' && MEAL_ID_RE.test(r.mealId)), 'record.mealId: up to 20 letters, digits, - or _');
  for (const k of ['taskStartAt', 'photoConfirmedAt', 'aiDraftAt', 'firstEditAt', 'finalConfirmedAt']) need(r.times[k] == null || isIso(r.times[k]), `record.times.${k} must be an ISO date`);
  for (const k of ['totalSec', 'correctionSec', 'aiProcessingSec', 'preEditDelaySec']) need(r.times[k] == null || (typeof r.times[k] === 'number' && Number.isFinite(r.times[k]) && r.times[k] >= 0), `record.times.${k} must be a number >= 0`);
  need(r.userActionCount == null || (Number.isInteger(r.userActionCount) && r.userActionCount >= 0), 'record.userActionCount must be an integer >= 0');
  need(r.events == null || (Array.isArray(r.events) && r.events.length <= MAX_EVENTS), `record.events must be an array (max ${MAX_EVENTS})`);
  (r.events || []).forEach((e, i) => validateEvent(e, `record.events[${i}]`));
  checkValue(r, 'record', 0, false);
  need(Buffer.byteLength(JSON.stringify(r)) <= MAX_RECORD_BYTES, `record is larger than ${MAX_RECORD_BYTES} bytes`);
  return r;
}

/** "data:image/jpeg;base64,…" -> Buffer (JPEG, <= MAX_PHOTO_BYTES), or throws. */
function decodePhoto(photo){
  need(typeof photo === 'string', 'photo must be a data URL string');
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(photo);
  need(m, 'photo must be a base64 JPEG data URL');
  const buf = Buffer.from(m[1], 'base64');
  need(buf.length > 100 && buf[0] === 0xFF && buf[1] === 0xD8, 'photo is not a JPEG');
  need(buf.length <= MAX_PHOTO_BYTES, `photo is larger than ${MAX_PHOTO_BYTES} bytes`);
  return buf;
}

/**
 * Writes meals/{id} (and photos/{id} when a photo is sent). Idempotent per id:
 * a retry overwrites; firstReceivedAt and uploadCount survive overwrites.
 */
async function saveRecord(db, body){
  need(isObj(body), 'body must be an object');
  const record = validateRecord(body.record);
  const photo = body.photo != null && SAVE_PHOTOS ? decodePhoto(body.photo) : null;
  const { FieldValue } = require('firebase-admin/firestore');
  const mealRef = db.collection(MEALS).doc(record.id);
  const nowIso = new Date().toISOString();

  await db.runTransaction(async tx => {
    const prev = await tx.get(mealRef);
    const prevData = prev.exists ? prev.data() : null;
    tx.set(mealRef, {
      ...record,
      receivedAt: nowIso,
      receivedAtTs: FieldValue.serverTimestamp(),
      firstReceivedAt: (prevData && prevData.firstReceivedAt) || nowIso,
      uploadCount: ((prevData && prevData.uploadCount) || 0) + 1,
      // a later re-sync without the photo keeps the earlier photo's info
      photoStored: !!photo || !!(prevData && prevData.photoStored),
      photoBytes: photo ? photo.length : ((prevData && prevData.photoBytes) || null)
    });
    if (photo){
      tx.set(db.collection(PHOTOS).doc(record.id), {
        recordId: record.id,
        pid: record.pid,
        group: record.group,
        contentType: 'image/jpeg',
        bytes: photo.length,
        width: (record.photo && record.photo.width) || null,
        height: (record.photo && record.photo.height) || null,
        data: photo,
        uploadedAt: nowIso
      });
    }
  });
  return { id: record.id, photoStored: !!photo };
}

/* ---------- admin ---------- */

// Constant-time comparison of the presented token with env ADMIN_TOKEN.
function checkAdmin(req){
  const expected = process.env.ADMIN_TOKEN || '';
  if (expected.length < 16) return { ok: false, status: 503, error: '伺服器沒有設定 ADMIN_TOKEN(至少 16 字元),匯出功能停用。' };
  const auth = String(req.get('authorization') || '');
  const given = auth.startsWith('Bearer ') ? auth.slice(7).trim() : String(req.get('x-admin-token') || '').trim();
  const h = s => crypto.createHash('sha256').update(s).digest();
  if (!given || !crypto.timingSafeEqual(h(given), h(expected))) return { ok: false, status: 401, error: '需要正確的 ADMIN_TOKEN。' };
  return { ok: true };
}

async function loadRecords(db, { pid, group, mealId } = {}){
  let q = db.collection(MEALS);
  if (pid) q = q.where('pid', '==', pid);
  if (group) q = q.where('group', '==', group);
  if (mealId) q = q.where('mealId', '==', mealId);
  const snap = await q.get();
  return snap.docs.map(d => {
    const { receivedAtTs, ...rest } = d.data();
    return rest;
  }).sort((a, b) => String(a.times && a.times.doneAt).localeCompare(String(b.times && b.times.doneAt)));
}

const CSV_COLUMNS = [
  'recordId', 'pid', 'group', 'mealId', 'appVersion', 'startedAt', 'nextAt', 'doneAt', 'durationSec',
  'totalSec', 'correctionSec', 'aiProcessingSec', 'preEditDelaySec', 'userActionCount',
  'dishNo', 'dishSource', 'aiName', 'aiConfidence', 'finalName', 'renamedFrom',
  'containerType', 'size', 'cookingMethod', 'sugar', 'salt',
  'aiCount', 'finalCount', 'countUnit', 'countEdits',
  'kcal', 'nutritionStatus', 'match', 'matchedName', 'nutritionSource',
  'proteinG', 'fatG', 'carbohydrateG', 'sodiumMg', 'notes',
  'mealTotalKcal', 'messageCount', 'userMessageCount', 'clarificationCount',
  'suggestionShownCount', 'suggestionTapCount', 'offTopicCount',
  'renameCount', 'fieldChangeCount', 'fieldSetCount', 'deletedDishes', 'addedDishes',
  'apiErrorCount', 'deletedFromDiary', 'photoStored', 'firstReceivedAt', 'receivedAt'
];

function csvCell(v){
  if (v == null) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const names = list => (Array.isArray(list) ? list.map(x => (isObj(x) ? x.name : x)).filter(Boolean).join('; ') : '');
const stripPct = s => String(s || '').replace(/\(\d+%\)$/, '');

function toCsv(records){
  const rows = [CSV_COLUMNS.join(',')];
  for (const r of records){
    const t = r.times || {}, e = r.editLog || {}, c = r.chat || {};
    const chat = CHAT_GROUPS.includes(r.group);
    const meal = {
      recordId: r.id, pid: r.pid, group: r.group, mealId: r.mealId || '', appVersion: r.appVersion,
      startedAt: t.startedAt, nextAt: t.nextAt, doneAt: t.doneAt, durationSec: t.durationSec,
      totalSec: t.totalSec, correctionSec: t.correctionSec, aiProcessingSec: t.aiProcessingSec,
      preEditDelaySec: t.preEditDelaySec, userActionCount: r.userActionCount,
      mealTotalKcal: r.nutrition ? r.nutrition.totalKcal : null,
      messageCount: chat ? c.messageCount : null,
      userMessageCount: chat ? c.userMessageCount : null,
      clarificationCount: chat ? c.clarificationCount : null,
      // suggestion buttons exist only in Group C
      suggestionShownCount: r.group === 'C' ? c.suggestionShownCount ?? 0 : null,
      suggestionTapCount: r.group === 'C' ? c.suggestionTapCount ?? 0 : null,
      offTopicCount: chat ? c.offTopicCount ?? 0 : null,
      renameCount: e.renameCount, fieldChangeCount: e.fieldChangeCount, fieldSetCount: e.fieldSetCount,
      deletedDishes: names(e.deletedDishes), addedDishes: names(e.addedDishes),
      apiErrorCount: Array.isArray(r.apiErrors) ? r.apiErrors.length : 0,
      deletedFromDiary: !!r.deletedFromDiary, photoStored: !!r.photoStored,
      firstReceivedAt: r.firstReceivedAt, receivedAt: r.receivedAt
    };
    const dishes = Array.isArray(r.dishes) && r.dishes.length ? r.dishes : [null];
    dishes.forEach((d, i) => {
      const x = (d && d.detail) || {}, n = (d && d.nutrition) || {}, ai = (d && d.aiOriginal) || {};
      const row = d ? {
        ...meal,
        dishNo: i + 1, dishSource: d.source, aiName: ai.name || null, aiConfidence: ai.confidence ?? null,
        finalName: stripPct(d.name), renamedFrom: d.renamedFrom,
        containerType: x.containerType, size: x.size, cookingMethod: x.cookingMethod, sugar: x.sugar, salt: x.salt,
        aiCount: ai.count ?? null, finalCount: d.count ?? null, countUnit: d.countUnit || ai.countUnit || null,
        countEdits: d.countEdits ?? (d.count != null || ai.count != null ? 0 : null),
        kcal: n.status === 'ok' ? n.kcal : null, nutritionStatus: n.status, match: n.match,
        matchedName: n.matchedName, nutritionSource: n.source,
        proteinG: n.proteinG, fatG: n.fatG, carbohydrateG: n.carbohydrateG, sodiumMg: n.sodiumMg,
        notes: Array.isArray(d.notes) ? d.notes.join('; ') : ''
      } : meal;
      rows.push(CSV_COLUMNS.map(k => csvCell(row[k])).join(','));
    });
  }
  // BOM so Excel opens the UTF-8 Chinese text correctly
  return '﻿' + rows.join('\r\n') + '\r\n';
}

// format=events: one row per event (every record's events, in order)
const EVENT_CSV_COLUMNS = [
  'recordId', 'pid', 'group', 'mealId',
  'seq', 'event', 'at', 'elapsedMs', 'page', 'actor', 'target', 'field', 'before', 'after',
  'attemptId', 'source', 'status', 'detail'
];
function toEventsCsv(records){
  const rows = [EVENT_CSV_COLUMNS.join(',')];
  for (const r of records){
    for (const e of Array.isArray(r.events) ? r.events : []){
      if (!isObj(e)) continue;
      const row = { ...e, recordId: r.id, pid: r.pid, group: r.group, mealId: r.mealId || '' };
      rows.push(EVENT_CSV_COLUMNS.map(k => csvCell(row[k])).join(','));
    }
  }
  return '﻿' + rows.join('\r\n') + '\r\n';
}

async function getPhoto(db, id){
  need(typeof id === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(id), 'id is not a record id');
  const snap = await db.collection(PHOTOS).doc(id).get();
  if (!snap.exists) return null;
  return snap.get('data');
}

module.exports = { GROUPS, MAX_EVENTS, saveRecord, validateRecord, decodePhoto, checkAdmin, loadRecords, toCsv, toEventsCsv, getPhoto, BadRequest, MEALS, PHOTOS };
