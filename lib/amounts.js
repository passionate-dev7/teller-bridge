import { RATIO, BPS } from './config.js';

/** BCH stable units the user sends -> USDC units the desk pays (BCH to Base). */
export const bchToBaseOut = (bchUnits, feeBps) => (BigInt(bchUnits) * RATIO * (BPS - feeBps)) / BPS;
/** USDC units the user sends -> BCH stable units the desk pays (Base to BCH). */
export const baseToBchOut = (usdcUnits, feeBps) => (BigInt(usdcUnits) * (BPS - feeBps)) / BPS / RATIO;
/** Largest BCH-stable send the desk can pay out of `usdcAvail` USDC units. */
export const maxBchSend = (usdcAvail, feeBps) => (BigInt(usdcAvail) * BPS) / (RATIO * (BPS - feeBps));
/** Largest USDC send the desk can pay out of `bchAvail` BCH stable units. */
export const maxUsdcSend = (bchAvail, feeBps) => ((BigInt(bchAvail) * BPS) / (BPS - feeBps)) * RATIO;
export const fmtUsd = (units, decimals) => {
  const d = 10n ** BigInt(decimals);
  const u = BigInt(units);
  return (u / d).toString() + '.' + (u % d).toString().padStart(decimals, '0');
};
