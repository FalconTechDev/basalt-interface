// Vault encryption for remote sync: AES-SIV (RFC 5297) for v2/v3 vaults, plain AES-GCM for v0,
// scrypt password stretching and HKDF key hashes. Every constant below (info strings, scrypt
// parameters, IV layout, hex encodings) is part of the sync wire format and must not change.

const subtle = () => globalThis.crypto.subtle;
const randomBytes = () => globalThis.crypto.getRandomValues(new Uint8Array(16));

// --- small buffer helpers -------------------------------------------------



export function utf8Bytes(str) {
  const encoded = new TextEncoder().encode(str);
  return encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);
}

export function utf8String(buf) {
  return new TextDecoder().decode(new Uint8Array(buf));
}



export function decodeBase64(b64) {
  const bin = globalThis.atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

export function encodeBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  return globalThis.btoa(bin);
}

export function sha256(data) {
  return subtle().digest("SHA-256", new Uint8Array(data));
}

export function randomSaltHex() {
  return bufferToHex(randomBytes().buffer);
}

// --- GF(2^128) doubling for CMAC/S2V subkeys (R = 0x87) --------------------

const BLOCK_SIZE = 16;
const BLOCK_R = 135;

class Block {
  constructor() { this.data = new Uint8Array(BLOCK_SIZE); }
  clear() { this.data.fill(0); }
  clone() { const b = new Block(); b.data.set(this.data); return b; }
  copy(other) { this.data.set(other.data); }
  dbl() {
    let carry = 0;
    for (let i = BLOCK_SIZE - 1; i >= 0; i--) {
      const next = this.data[i] >>> 7;
      this.data[i] = ((this.data[i] << 1) | carry) & 255;
      carry = next;
    }
    this.data[BLOCK_SIZE - 1] ^= (~(carry - 1) & BLOCK_R) | (carry - 1 & 0);
  }
}



export function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return (1 & ((diff - 1) >>> 8)) !== 0;
}

class SivError extends Error {}
export function defineSivError() { return SivError; }

// --- AES-CMAC (RFC 4493) on top of AES-CBC -------------------------------

// HKDF salt/info used to derive the CMAC key: "ObsidianAesSivMac".
class CbcMacCipher {
  constructor(key) { this.key = key; this.iv = new Block(); }
  static async importKey(hkdfKey, saltBytes) {
    const key = await subtle().deriveKey(
      { name: "HKDF", salt: saltBytes, info: utf8Bytes("ObsidianAesSivMac"), hash: "SHA-256" },
      hkdfKey, { name: "AES-CBC", length: 256 }, false, ["encrypt"]);
    return new CbcMacCipher(key);
  }
  encryptBlock(block) {
    return subtle().encrypt({ name: "AES-CBC", iv: this.iv.data }, this.key, block.data)
      .then((out) => { block.data.set(new Uint8Array(out, 0, BLOCK_SIZE)); });
  }
}

class Cmac {
  constructor(cipher, subkey1, subkey2) {
    this.cipher = cipher;
    this.subkey1 = subkey1;
    this.subkey2 = subkey2;
    this.bufferPos = 0;
    this.finished = false;
    this.buffer = new Block();
  }
  static async importKey(hkdfKey, saltBytes) {
    const cipher = await CbcMacCipher.importKey(hkdfKey, saltBytes);
    const l = new Block();
    await cipher.encryptBlock(l);
    l.dbl();
    const k1 = l.clone();
    k1.dbl();
    return () => new Cmac(cipher, l, k1);
  }
  async update(data) {
    if (this.finished) throw new Error("Cannot update finished CMAC");
    const tail = BLOCK_SIZE - this.bufferPos;
    let offset = 0;
    let remaining = data.length;
    if (remaining > tail) {
      for (let i = 0; i < tail; i++) this.buffer.data[this.bufferPos + i] ^= data[i];
      remaining -= tail; offset += tail;
      await this.cipher.encryptBlock(this.buffer);
      this.bufferPos = 0;
    }
    while (remaining > BLOCK_SIZE) {
      for (let i = 0; i < BLOCK_SIZE; i++) this.buffer.data[i] ^= data[offset + i];
      remaining -= BLOCK_SIZE; offset += BLOCK_SIZE;
      await this.cipher.encryptBlock(this.buffer);
    }
    for (let i = 0; i < remaining; i++) this.buffer.data[this.bufferPos++] ^= data[offset + i];
    return this;
  }
  async finish() {
    if (!this.finished) {
      const subkey = this.bufferPos < BLOCK_SIZE ? this.subkey2 : this.subkey1;
      xorInto(this.buffer.data, subkey.data);
      if (this.bufferPos < BLOCK_SIZE) this.buffer.data[this.bufferPos] ^= 128;
      await this.cipher.encryptBlock(this.buffer);
      this.finished = true;
    }
    return this.buffer.data;
  }
}

// --- AES-CTR for SIV payload encryption ------------------------------------

// HKDF info "ObsidianAesSivEnc" derives an AES-CTR key; counter = first arg block.
class CtrCipher {
  constructor(key) { this.key = key; }
  static async importKey(hkdfKey, saltBytes) {
    const key = await subtle().deriveKey(
      { name: "HKDF", salt: saltBytes, info: utf8Bytes("ObsidianAesSivEnc"), hash: "SHA-256" },
      hkdfKey, { name: "AES-CTR", length: 256 }, false, ["encrypt"]);
    return new CtrCipher(key);
  }
  encryptCtr(counterBlock, data) {
    return subtle().encrypt({ name: "AES-CTR", counter: counterBlock, length: 16 }, this.key, data)
      .then((out) => new Uint8Array(out));
  }
}

// --- AES-SIV (RFC 5297) ----------------------------------------------------

class Siv {
  constructor(cmacFactory, ctr) { this.cmacFactory = cmacFactory; this.ctr = ctr; }
  static async importKey(hkdfKey, saltBytes) {
    const cmacFactory = await Cmac.importKey(hkdfKey, saltBytes);
    const ctr = await CtrCipher.importKey(hkdfKey, saltBytes);
    return new Siv(cmacFactory, ctr);
  }
  async seal(plaintext) {
    const pt = plaintext instanceof Uint8Array ? plaintext : new Uint8Array(plaintext);
    const out = new Uint8Array(BLOCK_SIZE + pt.length);
    const tag = await this.s2v(pt);
    out.set(tag);
    maskTagBits(tag);
    out.set(await this.ctr.encryptCtr(tag, pt), BLOCK_SIZE);
    return out;
  }
  async open(ciphertext) {
    if (ciphertext.length < BLOCK_SIZE) throw new SivError("AES-SIV: ciphertext is truncated");
    const tag = new Uint8Array(ciphertext.subarray(0, BLOCK_SIZE));
    const masked = new Uint8Array(BLOCK_SIZE);
    masked.set(tag);
    maskTagBits(masked);
    const plaintext = await this.ctr.encryptCtr(masked, ciphertext.subarray(BLOCK_SIZE));
    const expected = await this.s2v(plaintext);
    if (!constantTimeEqual(tag, expected)) {
      zeroFill(plaintext);
      throw new SivError("AES-SIV: ciphertext verification failure!");
    }
    return plaintext;
  }
  async s2v(msg) {
    const cmac = this.cmacFactory();
    const double = new Block();
    const result = new Block();
    await cmac.update(double.data);
    result.data.set(await cmac.finish());
    const cmac2 = this.cmacFactory();
    double.clear();
    if (msg.length >= BLOCK_SIZE) {
      const head = msg.length - BLOCK_SIZE;
      double.data.set(msg.subarray(head));
      await cmac2.update(msg.subarray(0, head));
    } else {
      double.data.set(msg);
      double.data[msg.length] = 128;
      result.dbl();
    }
    xorInto(double.data, result.data);
    await cmac2.update(double.data);
    return cmac2.finish();
  }
}

// Jb equivalent: clear the two bits S2V reserves in the tag.
function maskTagBits(tag) {
  tag[tag.length - 8] &= 127;
  tag[tag.length - 4] &= 127;
}

// --- AES-GCM helpers (v0 vaults + generic payload encryption) --------------

const AES_GCM = "AES-GCM";

export function importAesGcmKey(rawKey) {
  return subtle().importKey("raw", rawKey, AES_GCM, false, ["encrypt", "decrypt"]);
}

// Encrypt: returns iv(12) || ciphertext. Caller may pass a fixed iv for deterministic mode.
export function aesGcmEncrypt(data, key, iv) {
  const nonce = iv || globalThis.crypto.getRandomValues(new Uint8Array(12));
  return subtle().encrypt({ name: AES_GCM, iv: nonce }, key, data).then((ct) => {
    const out = new ArrayBuffer(nonce.byteLength + ct.byteLength);
    const bytes = new Uint8Array(out);
    bytes.set(new Uint8Array(nonce), 0);
    bytes.set(new Uint8Array(ct), nonce.byteLength);
    return out;
  });
}

export function aesGcmDecrypt(data, key) {
  return (async () => {
    if (data.byteLength < 12) throw new Error("Encrypted data is bad");
    if (data.byteLength === 12) return new ArrayBuffer(0);
    const iv = new Uint8Array(data, 0, 12);
    const ct = new Uint8Array(data, 12);
    return subtle().decrypt({ name: AES_GCM, iv }, key, ct);
  })();
}

// --- scrypt password stretching --------------------------------------------

const SCRYPT_N = 32768;
const SCRYPT_PARAMS = { N: SCRYPT_N, r: 8, p: 1, maxmem: 67108864 };

// Derive the 32-byte vault key from password + salt. Output is an ArrayBuffer.
export function deriveScryptKey(password, salt) {
  const pwd = password.normalize("NFKC");
  const slt = salt.normalize("NFKC");
  return (async () => {
    const nodeCrypto = globalThis.window && globalThis.window.require && globalThis.window.require("crypto");
    if (nodeCrypto) {
      return new Promise((resolve, reject) => {
        nodeCrypto.scrypt(Buffer.from(pwd, "utf8"), Buffer.from(slt, "utf8"), 32, SCRYPT_PARAMS,
          (err, key) => (err ? reject(err) : resolve(key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength))));
      });
    }
    const out = await globalThis.window.scrypt.scrypt(
      new Uint8Array(utf8Bytes(pwd)), new Uint8Array(utf8Bytes(slt)), SCRYPT_N, 8, 1, 32);
    return ownBuffer(out);
  })();
}


// --- key hash (what /vault/* calls carry instead of the password) -----------

// HKDF info "ObsidianKeyHash": v0 hashes the raw key with SHA-256, v2/v3 derive via HKDF/AES-CBC.
export async function deriveKeyHash(keyBytes, salt, encryptionVersion) {
  switch (encryptionVersion) {
    case 0: {
      const digest = await sha256(keyBytes);
      return bufferToHex(digest);
    }
    case 2:
    case 3: {
      const hkdfKey = await subtle().importKey("raw", keyBytes, "HKDF", false, ["deriveKey"]);
      const derived = await subtle().deriveKey(
        { name: "HKDF", salt: utf8Bytes(salt), info: utf8Bytes("ObsidianKeyHash"), hash: "SHA-256" },
        hkdfKey, { name: "AES-CBC", length: 256 }, true, ["encrypt"]);
      const raw = await subtle().exportKey("raw", derived);
      return bufferToHex(raw);
    }
    default:
      throw new Error("Encryption version not supported");
  }
}

// password + salt -> { key: 32-byte key, keyhash: hex string } for /vault/create.
export async function deriveVaultSecrets(password, salt, encryptionVersion) {
  const key = await deriveScryptKey(password, salt);
  const keyhash = await deriveKeyHash(key, salt, encryptionVersion);
  return { key, keyhash };
}

// wk: password + salt -> keyhash hex only (what /vault/create and /vault/migrate carry).
export async function deriveVaultKeyhash(password, salt, encryptionVersion) {
  const key = await deriveScryptKey(password, salt);
  return deriveKeyHash(key, salt, encryptionVersion);
}

// --- cipher providers --------------------------------------------------------

// v0: raw key is the AES-GCM key; keyhash is plain SHA-256 hex.
class CipherV0 {
  constructor(keyHash, cryptoKey) { this.encryptionVersion = 0; this.keyHash = keyHash; this.cryptoKey = cryptoKey; }
  static async init(keyBytes) {
    if (keyBytes.byteLength !== 32) throw new Error("Invalid encryption key");
    const digest = await sha256(keyBytes);
    const keyHash = bufferToHex(digest);
    const cryptoKey = await importAesGcmKey(keyBytes);
    return new CipherV0(keyHash, cryptoKey);
  }
  deterministicEncodeStr(str) {
    const data = utf8Bytes(str);
    return (async () => {
      const digest = await sha256(data);
      const iv = new Uint8Array(digest, 0, 12);
      return bufferToHex(await aesGcmEncrypt(data, this.cryptoKey, iv));
    })();
  }
  deterministicDecodeStr(hex) {
    return (async () => {
      const data = hexToBuffer(hex);
      const plain = await aesGcmDecrypt(data, this.cryptoKey);
      return utf8String(plain);
    })();
  }
  encrypt(data) { return aesGcmEncrypt(data, this.cryptoKey); }
  decrypt(data) { return aesGcmDecrypt(data, this.cryptoKey); }
}

// v2/v3: SIV for deterministic strings, AES-GCM for payloads.
// keyHash = HKDF("ObsidianKeyHash")/AES-CBC export; siv + gcm keys derived from raw key + salt.
class CipherV23 {
  constructor(keyHash, cryptoKey, siv, encryptionVersion) {
    this.keyHash = keyHash;
    this.cryptoKey = cryptoKey;
    this.siv = siv;
    if (encryptionVersion !== 2 && encryptionVersion !== 3) throw new Error("Invalid encryption version");
    this.encryptionVersion = encryptionVersion;
  }
  static async init(keyBytes, salt, encryptionVersion) {
    if (keyBytes.byteLength !== 32) throw new Error("Invalid encryption key");
    const hkdfKey = await subtle().importKey("raw", keyBytes, "HKDF", false, ["deriveKey"]);
    const saltBytes = utf8Bytes(salt);
    const hashDerived = await subtle().deriveKey(
      { name: "HKDF", salt: saltBytes, info: utf8Bytes("ObsidianKeyHash"), hash: "SHA-256" },
      hkdfKey, { name: "AES-CBC", length: 256 }, true, ["encrypt"]);
    const keyHash = bufferToHex(await subtle().exportKey("raw", hashDerived));
    const siv = await Siv.importKey(hkdfKey, saltBytes);
    const gcmDerived = await subtle().deriveKey(
      { name: "HKDF", salt: new Uint8Array(0), info: utf8Bytes("ObsidianAesGcm"), hash: "SHA-256" },
      hkdfKey, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    return new CipherV23(keyHash, gcmDerived, siv, encryptionVersion);
  }
  deterministicEncodeStr(str) {
    return this.siv.seal(utf8Bytes(str)).then((sealed) => bufferToHex(ownBuffer(sealed)));
  }
  deterministicDecodeStr(hex) {
    return this.siv.open(new Uint8Array(hexToBuffer(hex))).then((opened) => utf8String(ownBuffer(opened)));
  }
  encrypt(data) { return aesGcmEncrypt(data, this.cryptoKey); }
  decrypt(data) { return aesGcmDecrypt(data, this.cryptoKey); }
}

export async function initCipher(encryptionVersion, keyBytes, salt) {
  switch (encryptionVersion) {
    case 0: return CipherV0.init(keyBytes);
    case 2:
    case 3: return CipherV23.init(keyBytes, salt, encryptionVersion);
    default: throw new Error("Encryption version not supported");
  }
}

// /vault/access call with a derived keyhash (used when joining an existing vault).
export async function requestVaultAccess(vaultUid, password, salt, host, encryptionVersion) {
  const keyhash = await deriveVaultKeyhash(password, salt, encryptionVersion);
  return acctVaultAccess(account.token, vaultUid, keyhash, host, encryptionVersion);
}

// obsidian:// callback URL parser (sync-setup deep links etc.). Kept for wire/URI compatibility.
export function parseCallbackUrl(url) {
  if (!url.startsWith("obsidian://")) return null;
  const params = {};
  let rest = url.substr(11);
  if (rest.startsWith("vault/")) {
    const parts = rest.substr(6).split("/").map(decodeURIComponent);
    params.action = "open";
    params.vault = parts[0];
    params.file = parts.slice(1).join("/");
  } else {
    let query = "", hash = "";
    const qi = rest.indexOf("?");
    const hi = rest.indexOf("#", Math.max(0, qi));
    if (hi >= 0) { hash = rest.substr(hi + 1); rest = rest.substr(0, hi); params.hash = hash; }
    if (qi >= 0) { query = rest.substr(qi + 1); rest = rest.substr(0, qi); }
    const pairs = query.split("&");
    for (let i = 0; i < pairs.length; i++) {
      const kv = pairs[i].split("=");
      let value = "true";
      if (kv.length > 1) value = decodeURIComponent(kv[1]);
      params[decodeURIComponent(kv[0])] = value;
    }
    params.action = rest.replace(/\/+$/g, "");
  }
  return params;
}

// Simple "**bold**" + newline renderer used by the onboarding screens.
export function renderFormattedDescription(containerEl, text) {
  const bold = /(\*\*(.*?)\*\*)/g;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let last = 0, match;
    const p = containerEl.createEl("p");
    while ((match = bold.exec(line)) !== null) {
      if (last < match.index) p.appendText(line.slice(last, match.index));
      p.createEl("strong", { text: match[2] });
      last = bold.lastIndex;
    }
    if (last < line.length) p.appendText(line.slice(last));
  }
}

// Adds/removes "mod-loading" around an async action.

// Feature-type sets shown in the sync settings summary.
export const SYNCABLE_FEATURE_TYPES = ["app", "appearance", "appearance-data", "hotkey", "core-plugin", "core-plugin-data"];
export const MEDIA_FEATURE_TYPES = ["image", "audio", "pdf", "video"];

// Manifest factories: each returns the class the minified initializer produced.
export function defineBlock() { return Block; }
export function defineCbcMacCipher() { return CbcMacCipher; }
export function defineCtrCipher() { return CtrCipher; }
export function defineCmac() { return Cmac; }
export function defineSiv() { return Siv; }
export function defineCipherV0() { return CipherV0; }
export function defineCipherV23() { return CipherV23; }
