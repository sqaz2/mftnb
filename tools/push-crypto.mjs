// Deterministic RFC 6979 ES256 signatures; no random-number shim in Apps Script.
import { p256 } from '@noble/curves/nist.js';
export const publicKey = key => p256.getPublicKey(key, false);
export const sign = (message, key) => p256.sign(message, key, { prehash: true, format: 'compact', extraEntropy: false });
