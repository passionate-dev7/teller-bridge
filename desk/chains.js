// Chain adapters the desk engine drives: BCH (cashscript provider + key) and EVM (viem + key). Same code runs on
// chipnet / Base Sepolia / mainnet; tests swap in an in-memory BCH validator and a local anvil node.
import { ElectrumNetworkProvider, MockNetworkProvider } from 'cashscript';
import { binToHex, hexToBin, sha256 as libauthSha256, decodeTransactionUnsafe } from '@bitauth/libauth';
import { swapLock, fundedLocks, lockBuilder, addressInputs, claimBuilder, refundBuilder, lockingBytecodeOf, medianTimePast, confirmationsOf, secretFromClaimTx, tokenAddressOf } from '../lib/bch.js';
import { addressesOf } from '../lib/keys.js';
import { DESK_LOCK_ABI, ERC20_ABI, LOCK_STATE, lockId, readLock } from '../lib/evm.js';
import { parseAbiItem } from 'viem';

const scriptHash = (lockingHex) => binToHex(libauthSha256.hash(hexToBin(lockingHex)).reverse());

/** Electrum-backed provider with the two extra reads the desk needs: script history and median time past. */
export class ElectrumChain extends ElectrumNetworkProvider {
  async history(lockingHex) {
    const rows = await this.performRequest('blockchain.scripthash.get_history', scriptHash(lockingHex));
    return rows.map((r) => r.tx_hash);
  }
  medianTime() { return medianTimePast(this); }
  confirmations(txid) { return confirmationsOf(this, txid); }
}

/** In-memory chain that validates every spend against the BCH VM (tests). Mirrors ElectrumChain's extra reads. */
export class MemoryChain extends MockNetworkProvider {
  mtp = 0;
  /** a node refuses a time-locked spend until the median time past reaches its locktime */
  async sendRawTransaction(hex) {
    const tx = decodeTransactionUnsafe(hexToBin(hex));
    if (tx.locktime >= 500_000_000 && tx.locktime > this.mtp && tx.inputs.some((i) => i.sequenceNumber !== 0xffffffff)) throw new Error('non-final: locktime ' + tx.locktime + ' above median time past ' + this.mtp);
    return super.sendRawTransaction(hex);
  }
  async history(lockingHex) {
    const txs = Object.entries(this.transactionMap).map(([txid, hex]) => ({ txid, tx: decodeTransactionUnsafe(hexToBin(hex)) }));
    const mine = new Set();
    const outpoints = new Set();
    for (const { txid, tx } of txs) tx.outputs.forEach((o, i) => { if (binToHex(o.lockingBytecode) === lockingHex) { mine.add(txid); outpoints.add(txid + ':' + i); } });
    for (const { txid, tx } of txs) if (tx.inputs.some((i) => outpoints.has(binToHex(i.outpointTransactionHash) + ':' + i.outpointIndex))) mine.add(txid);
    return [...mine];
  }
  async medianTime() { return this.mtp; }
  confirmed = new Set();
  /** tests decide when a tx counts as confirmed */
  async confirmations(txid) { return this.confirmed.has(txid) ? 1 : 0; }
}

export class BchDesk {
  constructor({ provider, prefix, keyHex }) {
    this.provider = provider;
    this.prefix = prefix;
    this.keyHex = keyHex;
    const a = addressesOf(keyHex);
    this.address = prefix === 'bitcoincash' ? a.mainnet : a.chipnet;
    this.lockingHex = lockingBytecodeOf(this.address);
  }

  contract(s) {
    const recipientLock = s.dir === 'bch2base' ? this.lockingHex : s.userBchLock;
    const refundLock = s.dir === 'bch2base' ? s.userBchLock : this.lockingHex;
    return swapLock({ hashlock: s.hashlock, recipientLock, refundLock, refundTime: s.bchRefundTime }, this.provider);
  }

  async utxos() { return this.provider.getUtxos(this.address); }
  async tokenBalance(category) { return (await this.utxos()).reduce((a, u) => (u.token && u.token.category === category && !u.token.nft ? a + u.token.amount : a), 0n); }
  async plainSats() { return (await this.utxos()).reduce((a, u) => (u.token ? a : a + u.satoshis), 0n); }
  mtp() { return this.provider.medianTime(); }
  confirmations(txid) { return this.provider.confirmations(txid); }
  /** does the chain server know this transaction (mempool or block)? */
  async txKnown(txid) { try { return !!(await this.provider.getRawTransaction(txid)); } catch { return false; } }

  /** Funded swap UTXOs at the lock address of swap `s` (carrying at least the amount the swap is about). */
  async funded(s) {
    const tokens = s.dir === 'bch2base' ? s.sendUnits : s.recvUnits;
    return fundedLocks(this.contract(s), s.category, tokens);
  }

  async lock(s) {
    const inputs = await addressInputs(this.provider, this.address, { keyHex: this.keyHex });
    const b = lockBuilder({ provider: this.provider, contract: this.contract(s), category: s.category, tokenAmount: BigInt(s.recvUnits), inputs, changeTo: this.tokenAddress() });
    return (await b.send()).txid;
  }

  /** Broadcast the claim of `utxo` with the secret; the covenant pays the swap's recipient whoever sends it. */
  async claim(s, utxo, secret) {
    const c = this.contract(s);
    const recipientLock = s.dir === 'bch2base' ? this.lockingHex : s.userBchLock;
    return (await claimBuilder({ provider: this.provider, contract: c, utxo, secretHex: secret, recipientLock, prefix: this.prefix }).send()).txid;
  }

  async refund(s, utxo) {
    const refundLock = s.dir === 'bch2base' ? s.userBchLock : this.lockingHex;
    return (await refundBuilder({ provider: this.provider, contract: this.contract(s), utxo, refundLock, refundTime: s.bchRefundTime, prefix: this.prefix }).send()).txid;
  }

  /** The secret, if a claim of this swap's lock was ever broadcast, read from the chain. */
  async findSecret(s) {
    for (const txid of await this.provider.history(lockingBytecodeOf(this.contract(s).address))) {
      const secret = secretFromClaimTx(await this.provider.getRawTransaction(txid), s.hashlock);
      if (secret) return secret;
    }
    return null;
  }

  async lockAddress(s) { return this.contract(s).tokenAddress; }
  tokenAddress() { return tokenAddressOf(this.lockingHex, this.prefix); }
}

export class EvmDesk {
  constructor({ publicClient, walletClient, account, deskLock, token }) {
    Object.assign(this, { publicClient, walletClient, account, deskLock, token });
    this.address = account.address;
  }
  async blockNumber() { return Number(await this.publicClient.getBlockNumber()); }
  /** the deployed DeskLock must exist and hold exactly the token this desk pays out */
  async verifyDeployment() {
    const held = await this.publicClient.readContract({ address: this.deskLock, abi: DESK_LOCK_ABI, functionName: 'token' });
    if (held.toLowerCase() !== this.token.toLowerCase()) throw new Error('DeskLock ' + this.deskLock + ' holds token ' + held + ', the desk is configured for ' + this.token);
  }
  async now() { return Number((await this.publicClient.getBlock({ blockTag: 'latest' })).timestamp); }
  usdcBalance() { return this.publicClient.readContract({ address: this.token, abi: ERC20_ABI, functionName: 'balanceOf', args: [this.address] }); }
  ethBalance() { return this.publicClient.getBalance({ address: this.address }); }

  async #send(request) {
    const hash = await this.walletClient.writeContract(request);
    const r = await this.publicClient.waitForTransactionReceipt({ hash });
    if (r.status !== 'success') throw new Error('tx reverted ' + hash);
    return { hash, block: r.blockNumber };
  }

  async ensureAllowance() {
    const a = await this.publicClient.readContract({ address: this.token, abi: ERC20_ABI, functionName: 'allowance', args: [this.address, this.deskLock] });
    if (a >= 2n ** 200n) return null;
    return this.#send({ address: this.token, abi: ERC20_ABI, functionName: 'approve', args: [this.deskLock, 2n ** 255n] });
  }

  lockState(id) { return readLock(this.publicClient, this.deskLock, id); }

  lockId(args) { return lockId(args); }
  lock({ recipient, hashlock, timeout, amount }) {
    return this.#send({ address: this.deskLock, abi: DESK_LOCK_ABI, functionName: 'lock', args: [recipient, '0x' + hashlock, BigInt(timeout), BigInt(amount)], account: this.account });
  }
  claim(id, secret) { return this.#send({ address: this.deskLock, abi: DESK_LOCK_ABI, functionName: 'claim', args: [id, '0x' + secret], account: this.account }); }
  refund(id) { return this.#send({ address: this.deskLock, abi: DESK_LOCK_ABI, functionName: 'refund', args: [id], account: this.account }); }

  async claimedSecret(id, fromBlock) {
    const logs = await this.publicClient.getLogs({ address: this.deskLock, event: parseAbiItem('event Claimed(bytes32 indexed id, bytes32 secret)'), args: { id }, fromBlock: BigInt(fromBlock ?? 0), toBlock: 'latest' });
    return logs.length ? logs[0].args.secret.slice(2) : null;
  }
}

export { LOCK_STATE };
