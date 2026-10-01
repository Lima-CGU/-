/**
 * One firebase-admin app for the backend and its scripts.
 *
 * Credentials, in order:
 *   1. env FIREBASE_SERVICE_ACCOUNT — the whole service-account JSON as one
 *      string (this is how Render is configured);
 *   2. backend/firebase-key.json — local development only (git-ignored).
 * Never logs any part of the key.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const KEY_FILE = path.join(__dirname, 'firebase-key.json');
let firestore = null;

function loadServiceAccount(){
  const fromEnv = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (fromEnv && fromEnv.trim()){
    try {
      return { account: JSON.parse(fromEnv), source: 'env FIREBASE_SERVICE_ACCOUNT' };
    } catch (err){
      throw new Error(`FIREBASE_SERVICE_ACCOUNT is set but is not valid JSON (${err.message}) — paste the whole key file content as the value`);
    }
  }
  if (fs.existsSync(KEY_FILE)){
    try {
      return { account: JSON.parse(fs.readFileSync(KEY_FILE, 'utf8')), source: 'backend/firebase-key.json' };
    } catch (err){
      throw new Error(`backend/firebase-key.json is not valid JSON (${err.message})`);
    }
  }
  throw new Error('no Firebase credentials: set env FIREBASE_SERVICE_ACCOUNT, or put the key at backend/firebase-key.json for local use');
}

/** @returns {{ db: import('firebase-admin/firestore').Firestore, projectId: string, source: string }} */
function getFirestore(){
  if (firestore) return firestore;
  const { account, source } = loadServiceAccount();
  if (account.type !== 'service_account' || !account.project_id || !account.private_key || !account.client_email){
    throw new Error(`Firebase credentials from ${source} are not a service-account key (missing type/project_id/private_key/client_email)`);
  }
  const { initializeApp, cert, getApps } = require('firebase-admin/app');
  const { getFirestore: adminFirestore } = require('firebase-admin/firestore');
  const app = getApps()[0] || initializeApp({ credential: cert(account), projectId: account.project_id });
  firestore = { db: adminFirestore(app), projectId: account.project_id, source };
  return firestore;
}

module.exports = { getFirestore };
