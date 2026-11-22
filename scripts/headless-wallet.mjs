// A WizardConnect wallet with no screen: pairs to a dapp URI, answers key requests and signs P2PKH inputs.
// Stand-in for Paytaca or Cashonize in automated runs. The seed is the caller's; nothing here prints it.
import { createHash } from 'node:crypto';
import { WalletConnectionManager } from '@wizardconnect/wallet';
import { deriveHdPrivateNodeFromSeed, deriveHdPath, deriveHdPathRelative, deriveHdPublicNode, encodeHdPublicKey, secp256k1, hash160, encodeCashAddress, CashAddressType, decodeTransaction, encodeTransaction, hexToBin, binToHex, generateSigningSerializationBch, SigningSerializationFlag, encodeDataPush, sha256 } from '@bitauth/libauth';

const CHILD = { receive: 0, change: 1, defi: 7 };
const unbig = (v) => BigInt(String(v).replace(/^<bigint: (\d+)n>$/, '$1'));
const unrelay = (s) => ({
  ...s,
  outpointTransactionHash: hexToBin(s.outpointTransactionHash), unlockingBytecode: hexToBin(s.unlockingBytecode), lockingBytecode: hexToBin(s.lockingBytecode),
  valueSatoshis: unbig(s.valueSatoshis),
  ...(s.token ? { token: { ...s.token, category: hexToBin(s.token.category), amount: unbig(s.token.amount) } } : {}),
});

export class HeadlessWallet {
  constructor(seed) {
    this.seed = seed;
    this.root = deriveHdPrivateNodeFromSeed(seed, { assumeValidity: true });
    this.account = deriveHdPath(this.root, "m/44'/145'/0'");
    this.signed = 0;
  }
  node(path, index) { return deriveHdPathRelative(this.account, CHILD[path] + '/' + index); }
  pubkey(path, index) { return secp256k1.derivePublicKeyCompressed(this.node(path, index).privateKey); }
  address(path, index, prefix, tokens = false) {
    return encodeCashAddress({ prefix, type: tokens ? CashAddressType.p2pkhWithTokens : CashAddressType.p2pkh, payload: hash160(this.pubkey(path, index)) }).address;
  }

  // WalletAdapter
  walletName = 'Headless test wallet';
  walletIcon = '';
  getRelayPrivateKey(uri) { return new Uint8Array(createHash('sha256').update(Buffer.concat([Buffer.from(this.seed), Buffer.from(uri)])).digest()); }
  getPublicKey(path, index) { return this.pubkey(Object.keys(CHILD).find((k) => CHILD[k] === path), Number(index)); }
  getXpub(path) { return encodeHdPublicKey({ network: 'mainnet', node: deriveHdPublicNode(deriveHdPathRelative(this.account, String(path))) }).hdPublicKey; }

  async signTransaction(request) {
    const tx = decodeTransaction(hexToBin(request.transaction.transaction));
    if (typeof tx === 'string') throw new Error(tx);
    const sources = request.transaction.sourceOutputs.map(unrelay);
    const inputs = tx.inputs.map((i) => ({ ...i }));
    for (const [n, path, index] of request.inputPaths) {
      const node = this.node(path, index);
      const pub = secp256k1.derivePublicKeyCompressed(node.privateKey);
      const covered = sources[n].lockingBytecode;
      if (binToHex(covered) !== '76a914' + binToHex(hash160(pub)) + '88ac') throw new Error('input ' + n + ' is not ours');
      const flag = SigningSerializationFlag.allOutputs | SigningSerializationFlag.forkId;
      const ser = generateSigningSerializationBch({ transaction: tx, sourceOutputs: sources, inputIndex: n }, { coveredBytecode: covered, signingSerializationType: new Uint8Array([flag]) });
      const sig = secp256k1.signMessageHashSchnorr(node.privateKey, sha256.hash(sha256.hash(ser)));
      inputs[n].unlockingBytecode = Uint8Array.from([...encodeDataPush(Uint8Array.from([...sig, flag])), ...encodeDataPush(pub)]);
    }
    this.signed++;
    return { signedTransaction: binToHex(encodeTransaction({ ...tx, inputs })) };
  }

  /** Pair to a dapp URI and sign whatever it asks for. */
  connect(uri) {
    const manager = new WalletConnectionManager(this);
    manager.on('pendingSignRequest', async ({ connectionId, request }) => {
      try {
        const r = await this.signTransaction(request);
        await manager.sendSignResponse(connectionId, request.sequence, r.signedTransaction);
      } catch (e) {
        await manager.sendSignError(connectionId, request.sequence, e.message);
      }
    });
    this.manager = manager;
    return manager.connect(uri);
  }
  stop() { this.manager?.disconnectAll(); }
}
