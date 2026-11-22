// The desk this build trusts. Built from deployments.json (or the file named by DEPLOYMENTS_FILE at build time); a status that
// disagrees is refused before anything is signed.
import deployments from 'pinned-deployments';
import { pinOf, checkStatus } from '../../lib/client.js';

export function pinnedFor(status) {
  const pin = pinOf(deployments, status.evm.chainId);
  const bad = checkStatus(status, pin);
  if (bad.length) throw new Error('Refusing to use this desk: ' + bad.join('; '));
  return pin;
}
