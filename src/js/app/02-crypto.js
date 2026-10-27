/* ==========================================================================
   Qelemchi · token encryption
   Session token: sessionStorage. Device token: AES-GCM key in IndexedDB.
   Passphrase token: PBKDF2 key derived on unlock. Never localStorage.
   ========================================================================== */

const SESSION_TOKEN_KEY = 'qelemchi.token';

function bufferToB64(buf) {
  return bytesToBase64(new Uint8Array(buf));
}

function b64ToBuffer(b64) {
  const bytes = base64ToBytes(b64);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function randomBytes(n) {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

async function derivePassphraseKey(passphrase, salt, iterations = 150000) {
  const base = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(String(passphrase)),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function getDeviceKey() {
  let key = await idbGet('secrets', 'device-key');
  if (key && key.type === 'secret') return key;
  key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
  await idbPut('secrets', 'device-key', key);
  return key;
}

async function encryptWithKey(key, token) {
  const iv = randomBytes(12);
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(String(token))
  );
  return { v: 1, iv: bufferToB64(iv), data: bufferToB64(data) };
}

async function decryptWithKey(key, record) {
  const iv = new Uint8Array(b64ToBuffer(record.iv));
  const data = b64ToBuffer(record.data);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return new TextDecoder().decode(plain);
}

function storeSessionToken(token) {
  try { sessionStorage.setItem(SESSION_TOKEN_KEY, String(token)); } catch (e) { /* ignore */ }
}

function readSessionToken() {
  try { return sessionStorage.getItem(SESSION_TOKEN_KEY) || ''; } catch (e) { return ''; }
}

function clearSessionToken() {
  try { sessionStorage.removeItem(SESSION_TOKEN_KEY); } catch (e) { /* ignore */ }
}

async function storeRememberedToken(token, mode, passphrase) {
  if (mode === 'session') {
    storeSessionToken(token);
    return;
  }
  if (!crypto.subtle) throw new Error('此浏览器不支持 WebCrypto，无法加密保存令牌。');
  if (mode === 'device') {
    const key = await getDeviceKey();
    const rec = await encryptWithKey(key, token);
    await idbPut('secrets', 'token-device', rec);
    return;
  }
  if (mode === 'passphrase') {
    if (!passphrase || String(passphrase).length < 8) throw new Error('口令至少需要 8 个字符。');
    const salt = randomBytes(16);
    const key = await derivePassphraseKey(passphrase, salt);
    const rec = await encryptWithKey(key, token);
    rec.salt = bufferToB64(salt);
    await idbPut('secrets', 'token-passphrase', rec);
    return;
  }
  throw new Error('未知的令牌保存方式。');
}

async function readRememberedToken(mode, passphrase) {
  if (mode === 'session') return readSessionToken();
  const rec = await idbGet('secrets', mode === 'device' ? 'token-device' : 'token-passphrase');
  if (!rec) return '';
  if (mode === 'device') {
    const key = await getDeviceKey();
    return decryptWithKey(key, rec);
  }
  if (mode === 'passphrase') {
    if (!passphrase) throw new Error('需要输入解锁口令。');
    const salt = new Uint8Array(b64ToBuffer(rec.salt));
    const key = await derivePassphraseKey(passphrase, salt);
    return decryptWithKey(key, rec);
  }
  return '';
}

async function clearRememberedToken(mode) {
  if (mode === 'session' || !mode) clearSessionToken();
  if (mode === 'device') await idbDelete('secrets', 'token-device');
  if (mode === 'passphrase') await idbDelete('secrets', 'token-passphrase');
}

async function hasRememberedToken(mode) {
  if (mode === 'session') return !!readSessionToken();
  const rec = await idbGet('secrets', mode === 'device' ? 'token-device' : 'token-passphrase');
  return !!rec;
}

async function clearAllTokens() {
  clearSessionToken();
  for (const key of ['token-device', 'token-passphrase', 'device-key']) {
    try { await idbDelete('secrets', key); } catch (e) { /* ignore */ }
  }
}
