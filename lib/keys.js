import { secp256k1, hash160, encodeCashAddress, CashAddressType, hexToBin, binToHex, instantiateSha256 } from '@bitauth/libauth';

/** Public data of a BCH private key (hex): pubkey, pkh and the four addresses. Never returns the key. */
export function addressesOf(keyHex) {
  const pub = secp256k1.derivePublicKeyCompressed(hexToBin(keyHex));
  if (typeof pub === 'string') throw new Error(pub);
  const payload = hash160(pub);
  const enc = (prefix, type) => encodeCashAddress({ prefix, type, payload }).address;
  return {
    pubkeyHex: binToHex(pub),
    pkhHex: binToHex(payload),
    chipnet: enc('bchtest', CashAddressType.p2pkh),
    chipnetTokens: enc('bchtest', CashAddressType.p2pkhWithTokens),
    mainnet: enc('bitcoincash', CashAddressType.p2pkh),
    mainnetTokens: enc('bitcoincash', CashAddressType.p2pkhWithTokens),
  };
}
