import * as StellarSdk from '@stellar/stellar-sdk'
import { isConnected, requestAccess, getAddress, signTransaction } from '@stellar/freighter-api'

const CONTRACT_ID = (import.meta.env.VITE_CONTRACT_ID || '').trim()
const XLM_TOKEN   = (import.meta.env.VITE_XLM_TOKEN || '').trim()
const NET         = (import.meta.env.VITE_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015').trim()
const RPC_URL     = (import.meta.env.VITE_SOROBAN_RPC_URL    || 'https://soroban-testnet.stellar.org').trim()
const DUMMY       = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN'

export const rpc = new StellarSdk.rpc.Server(RPC_URL)

export async function connectWallet() {
  const { isConnected: connected } = await isConnected()
  if (!connected) throw new Error('Freighter not installed.')
  const { address, error } = await requestAccess()
  if (error) throw new Error(error)
  return address
}

async function sendTx(publicKey, op) {
  const account = await rpc.getAccount(publicKey)
  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE, networkPassphrase: NET,
  }).addOperation(op).setTimeout(60).build()

  const sim = await rpc.simulateTransaction(tx)
  if (StellarSdk.rpc.Api.isSimulationError(sim)) throw new Error(sim.error)

  const prepared = StellarSdk.rpc.assembleTransaction(tx, sim).build()
  const result = await signTransaction(prepared.toXDR(), { networkPassphrase: NET })
  if (result.error) throw new Error(result.error)
  const signed = StellarSdk.TransactionBuilder.fromXDR(result.signedTxXdr, NET)
  const sent = await rpc.sendTransaction(signed)
  return pollTx(sent.hash)
}

async function pollTx(hash) {
  for (let i = 0; i < 30; i++) {
    const r = await rpc.getTransaction(hash)
    if (r.status === 'SUCCESS') return hash
    if (r.status === 'FAILED')  throw new Error('Transaction failed on-chain')
    await new Promise(r => setTimeout(r, 2000))
  }
  throw new Error('Transaction timed out')
}

async function readContract(op) {
  const dummy = new StellarSdk.Account(DUMMY, '0')
  const tx = new StellarSdk.TransactionBuilder(dummy, {
    fee: StellarSdk.BASE_FEE, networkPassphrase: NET,
  }).addOperation(op).setTimeout(30).build()
  const sim = await rpc.simulateTransaction(tx)
  return StellarSdk.scValToNative(sim.result.retval)
}

const tc = () => new StellarSdk.Contract(CONTRACT_ID)

// ── approve XLM ────────────────────────────────────────────────────────────
async function approveXlm(publicKey, stroops) {
  const xlm = new StellarSdk.Contract(XLM_TOKEN)
  return sendTx(publicKey, xlm.call(
    'approve',
    StellarSdk.Address.fromString(publicKey).toScVal(),
    StellarSdk.Address.fromString(CONTRACT_ID).toScVal(),
    new StellarSdk.XdrLargeInt('i128', BigInt(stroops)).toI128(),
    StellarSdk.xdr.ScVal.scvU32(3_110_400),
  ))
}

// ── claim ──────────────────────────────────────────────────────────────────
export async function claimName(claimer, name) {
  await approveXlm(claimer, 5_000_000) // 0.5 XLM
  return sendTx(claimer, tc().call(
    'claim',
    StellarSdk.Address.fromString(claimer).toScVal(),
    StellarSdk.xdr.ScVal.scvString(name),
    StellarSdk.Address.fromString(XLM_TOKEN).toScVal(),
  ))
}

// ── transfer ───────────────────────────────────────────────────────────────
export async function transferName(from, to, name) {
  await approveXlm(from, 2_000_000) // 0.2 XLM
  return sendTx(from, tc().call(
    'transfer',
    StellarSdk.Address.fromString(from).toScVal(),
    StellarSdk.Address.fromString(to).toScVal(),
    StellarSdk.xdr.ScVal.scvString(name),
    StellarSdk.Address.fromString(XLM_TOKEN).toScVal(),
  ))
}

// ── release ────────────────────────────────────────────────────────────────
export async function releaseName(owner, name) {
  return sendTx(owner, tc().call(
    'release',
    StellarSdk.Address.fromString(owner).toScVal(),
    StellarSdk.xdr.ScVal.scvString(name),
  ))
}

// ── reads ──────────────────────────────────────────────────────────────────
export async function lookupName(name) {
  try {
    return await readContract(tc().call(
      'lookup', StellarSdk.xdr.ScVal.scvString(name)
    ))
  } catch { return null }
}

export async function reverseLookup(owner) {
  try {
    const names = await readContract(tc().call(
      'reverse_lookup',
      StellarSdk.Address.fromString(owner).toScVal(),
    ))
    return Array.isArray(names) ? names : []
  } catch { return [] }
}

export async function isAvailable(name) {
  try {
    return await readContract(tc().call(
      'is_available', StellarSdk.xdr.ScVal.scvString(name)
    ))
  } catch { return false }
}

export async function getTotalNames() {
  try {
    const n = await readContract(tc().call('total_names'))
    return Number(n)
  } catch { return 0 }
}

// ── client-side name validation ────────────────────────────────────────────
export function validateNameClient(name) {
  if (!name) return { ok: false, msg: '' }
  if (name.length < 3) return { ok: false, msg: 'Too short — minimum 3 characters' }
  if (name.length > 20) return { ok: false, msg: 'Too long — maximum 20 characters' }
  if (!/^[a-z0-9-]+$/.test(name)) return { ok: false, msg: 'Only a–z, 0–9, and hyphens' }
  if (name.startsWith('-') || name.endsWith('-')) return { ok: false, msg: 'Cannot start or end with a hyphen' }
  return { ok: true, msg: '' }
}

export { CONTRACT_ID, XLM_TOKEN }


