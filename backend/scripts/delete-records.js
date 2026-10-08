#!/usr/bin/env node
// Lists, and with --yes deletes, every study record (meals + photos) of one
// participant id — e.g. the test data written with pid DEVTEST:
//   node scripts/delete-records.js --pid=DEVTEST          (dry run: counts only)
//   node scripts/delete-records.js --pid=DEVTEST --yes    (delete)
// Uses the same credentials as the server (env FIREBASE_SERVICE_ACCOUNT or
// backend/firebase-key.json). Prints counts and record ids only.
'use strict';

const { getFirestore } = require('../firebase-admin-init');
const { MEALS, PHOTOS } = require('../records');

const args = process.argv.slice(2);
const pidArg = args.find(a => a.startsWith('--pid='));
const pid = pidArg ? pidArg.slice(6) : '';
const doDelete = args.includes('--yes');

(async () => {
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(pid)){
    console.error('usage: node scripts/delete-records.js --pid=DEVTEST [--yes]');
    process.exit(2);
  }
  const { db, projectId } = getFirestore();
  const [meals, photos] = await Promise.all([
    db.collection(MEALS).where('pid', '==', pid).get(),
    db.collection(PHOTOS).where('pid', '==', pid).get()
  ]);
  console.log(`project ${projectId}, pid "${pid}": ${meals.size} meals, ${photos.size} photos`);
  meals.docs.forEach(d => console.log(`  meal ${d.id}  group ${d.get('group')}  done ${d.get('times.doneAt') || '-'}  uploads ${d.get('uploadCount')}`));
  if (!doDelete){
    console.log('dry run — add --yes to delete these');
    process.exit(0);
  }
  const refs = [...meals.docs, ...photos.docs].map(d => d.ref);
  for (let i = 0; i < refs.length; i += 400){
    const batch = db.batch();
    refs.slice(i, i + 400).forEach(ref => batch.delete(ref));
    await batch.commit();
  }
  console.log(`deleted ${meals.size} meals and ${photos.size} photos`);
  process.exit(0);
})().catch(err => { console.error('failed:', err.message); process.exit(1); });
