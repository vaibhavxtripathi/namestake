import { useState, useEffect, useRef, useCallback } from 'react'
import {
  connectWallet, claimName, transferName, releaseName,
  lookupName, reverseLookup, isAvailable, getTotalNames,
  validateNameClient, CONTRACT_ID,
} from './lib/stellar'

const short = (a) => a ? `${a.toString().slice(0, 6)}…${a.toString().slice(-4)}` : '—'
const xlm   = (s)  => (Number(s) / 10_000_000).toFixed(1)

// ── Availability badge ─────────────────────────────────────────────────────
function AvailBadge({ state }) {
  if (state === 'idle')      return null
  if (state === 'checking')  return <span className="badge badge-checking">CHECKING…</span>
  if (state === 'available') return <span className="badge badge-avail">AVAILABLE</span>
  if (state === 'taken')     return <span className="badge badge-taken">TAKEN</span>
  if (state === 'invalid')   return <span className="badge badge-invalid">INVALID</span>
  return null
}

// ── Search bar ─────────────────────────────────────────────────────────────
function SearchBar({ onResult }) {
  const [name,   setName]   = useState('')
  const [state,  setState]  = useState('idle') // idle|checking|available|taken|invalid
  const [record, setRecord] = useState(null)
  const timerRef = useRef(null)

  const check = useCallback(async (val) => {
    if (!val) { setState('idle'); setRecord(null); return }
    const { ok, msg } = validateNameClient(val)
    if (!ok) { setState('invalid'); setRecord(null); onResult(null, null, msg); return }

    setState('checking')
    try {
      const avail = await isAvailable(val)
      if (avail) {
        setState('available')
        setRecord(null)
        onResult(val, null, null)
      } else {
        const rec = await lookupName(val)
        setState('taken')
        setRecord(rec)
        onResult(val, rec, null)
      }
    } catch { setState('idle') }
  }, [onResult])

  const handleChange = (e) => {
    const val = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')
    setName(val)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => check(val), 500)
  }

  return (
    <div className="search-wrap">
      <div className="search-box">
        <span className="search-prefix">@</span>
        <input
          className="search-input"
          value={name}
          onChange={handleChange}
          placeholder="search a name…"
          maxLength={20}
          autoComplete="off"
          spellCheck={false}
        />
        <AvailBadge state={state} />
      </div>
      <div className="search-rules">
        3–20 chars · a–z · 0–9 · hyphens · no leading/trailing hyphens
      </div>
    </div>
  )
}

// ── Name card (claimed) ────────────────────────────────────────────────────
function NameCard({ name, record, wallet, onAction }) {
  const [showTransfer, setShowTransfer] = useState(false)
  const [toAddr,       setToAddr]       = useState('')
  const [busy,         setBusy]         = useState(false)
  const isOwner = wallet && record?.owner?.toString() === wallet
  const date    = record?.claimed_at
    ? new Date(Number(record.claimed_at) * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
    : '—'

  const handle = async (fn, msg) => {
    setBusy(true)
    try {
      const hash = await fn()
      onAction({ ok: true, msg, hash })
      setShowTransfer(false)
      setToAddr('')
    } catch (e) { onAction({ ok: false, msg: e.message }) }
    finally { setBusy(false) }
  }

  return (
    <div className="name-card">
      <div className="nc-header">
        <div className="nc-name">@{name}</div>
        <span className="nc-chip chip-registered">REGISTERED</span>
      </div>
      <div className="nc-meta-grid">
        <div className="nc-meta-item">
          <span className="nm-label">OWNER</span>
          <span className="nm-val">{short(record?.owner)}</span>
        </div>
        <div className="nc-meta-item">
          <span className="nm-label">CLAIMED</span>
          <span className="nm-val">{date}</span>
        </div>
        <div className="nc-meta-item">
          <span className="nm-label">TRANSFERS</span>
          <span className="nm-val">{record?.transferred?.toString() || '0'}</span>
        </div>
      </div>

      {isOwner && (
        <div className="nc-actions">
          <button
            className={`btn-transfer-toggle ${showTransfer ? 'active' : ''}`}
            onClick={() => setShowTransfer(t => !t)}
          >
            TRANSFER NAME
          </button>
          <button
            className="btn-release"
            disabled={busy}
            onClick={() => handle(() => releaseName(wallet, name), `@${name} released`)}
          >
            RELEASE
          </button>
        </div>
      )}

      {isOwner && showTransfer && (
        <div className="transfer-panel">
          <input
            className="transfer-input"
            value={toAddr}
            onChange={e => setToAddr(e.target.value)}
            placeholder="Destination Stellar address G…"
            disabled={busy}
          />
          <button
            className="btn-confirm-transfer"
            disabled={busy || !toAddr}
            onClick={() => handle(() => transferName(wallet, toAddr, name), `@${name} transferred`)}
          >
            {busy ? 'SIGNING…' : 'CONFIRM TRANSFER · 0.2 XLM'}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Available name card ────────────────────────────────────────────────────
function ClaimCard({ name, wallet, onClaimed }) {
  const [busy, setBusy] = useState(false)
  const [err,  setErr]  = useState('')

  const handleClaim = async () => {
    if (!wallet) return
    setBusy(true); setErr('')
    try {
      const hash = await claimName(wallet, name)
      onClaimed({ name, hash })
    } catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  return (
    <div className="claim-card">
      <div className="cc-name">@{name}</div>
      <div className="cc-avail">This name is available</div>
      <div className="cc-price-row">
        <div className="cc-price">
          <span className="cc-xlm">0.5 XLM</span>
          <span className="cc-price-label">registration fee</span>
        </div>
        <button
          className="btn-claim"
          disabled={!wallet || busy}
          onClick={handleClaim}
        >
          {!wallet ? 'Connect wallet' : busy ? 'CLAIMING…' : 'CLAIM NAME'}
        </button>
      </div>
      {err && <p className="cc-err">{err}</p>}
      {!wallet && <p className="cc-hint">Connect your Freighter wallet to claim</p>}
    </div>
  )
}

// ── My names panel ─────────────────────────────────────────────────────────
function MyNames({ wallet, onAction, refreshKey }) {
  const [names,   setNames]   = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!wallet) return
    setLoading(true)
    reverseLookup(wallet).then(setNames).finally(() => setLoading(false))
  }, [wallet, refreshKey])

  if (!wallet) return null
  if (loading) return <div className="my-names-loading">Loading your names…</div>
  if (names.length === 0) return (
    <div className="my-names-empty">You haven't claimed any names yet.</div>
  )

  return (
    <div className="my-names-list">
      {names.map(n => (
        <MyNameRow key={n} name={n} wallet={wallet} onAction={onAction} />
      ))}
    </div>
  )
}

function MyNameRow({ name, wallet, onAction }) {
  const [rec, setRec] = useState(null)
  useEffect(() => { lookupName(name).then(setRec) }, [name])

  return rec ? (
    <NameCard name={name} record={rec} wallet={wallet} onAction={onAction} />
  ) : (
    <div className="name-card-skeleton" />
  )
}

// ── Main ───────────────────────────────────────────────────────────────────
export default function App() {
  const [wallet,      setWallet]      = useState(null)
  const [tab,         setTab]         = useState('search')
  const [totalNames,  setTotalNames]  = useState(0)
  const [toast,       setToast]       = useState(null)
  const [refreshKey,  setRefreshKey]  = useState(0)

  // Search result state
  const [searchName,   setSearchName]   = useState(null)
  const [searchRecord, setSearchRecord] = useState(null)
  const [searchErr,    setSearchErr]    = useState('')

  useEffect(() => { getTotalNames().then(setTotalNames) }, [])

  const handleConnect = async () => {
    try { setWallet(await connectWallet()) }
    catch (e) { showToast(false, e.message) }
  }

  const showToast = (ok, msg, hash) => {
    setToast({ ok, msg, hash })
    setTimeout(() => setToast(null), 6000)
  }

  const handleSearchResult = (name, record, err) => {
    setSearchName(name); setSearchRecord(record); setSearchErr(err || '')
  }

  const handleAction = ({ ok, msg, hash }) => {
    showToast(ok, msg, hash)
    if (ok) { setRefreshKey(k => k + 1); getTotalNames().then(setTotalNames) }
  }

  const handleClaimed = ({ name, hash }) => {
    showToast(true, `@${name} claimed!`, hash)
    setRefreshKey(k => k + 1)
    getTotalNames().then(setTotalNames)
    setTab('mine')
  }

  return (
    <div className="app">
      {/* ── Header ── */}
      <header className="header">
        <div className="header-left">
          <div className="logo-mark">NS</div>
          <div className="logo-text">
            <span className="logo-name">NameStake</span>
            <span className="logo-tld">.stellar</span>
          </div>
        </div>

        <nav className="nav">
          {[
            { id: 'search', label: 'Search' },
            { id: 'mine',   label: 'My Names' },
          ].map(t => (
            <button key={t.id}
              className={`nav-btn ${tab === t.id ? 'nav-active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="header-right">
          <div className="total-badge">
            <span className="total-n">{totalNames}</span>
            <span className="total-l">names registered</span>
          </div>
          {wallet
            ? <div className="wallet-pill"><span className="wdot" />{short(wallet)}</div>
            : <button className="btn-connect" onClick={handleConnect}>Connect Wallet</button>
          }
        </div>
      </header>

      {/* ── Toast ── */}
      {toast && (
        <div className={`toast ${toast.ok ? 'toast-ok' : 'toast-err'}`}>
          <span>{toast.msg}</span>
          {toast.hash && (
            <a href={`https://stellar.expert/explorer/testnet/tx/${toast.hash}`}
              target="_blank" rel="noreferrer" className="toast-link">TX ↗</a>
          )}
        </div>
      )}

      {/* ── Hero (search only) ── */}
      {tab === 'search' && (
        <div className="hero">
          <div className="hero-inner">
            <h1 className="hero-title">
              Claim your identity<br />
              <span className="hero-accent">on Stellar.</span>
            </h1>
            <p className="hero-sub">Register short names on-chain. 0.5 XLM · Transferable · Permanent.</p>
            <SearchBar onResult={handleSearchResult} />

            {/* Search results */}
            {searchErr && <p className="search-err">{searchErr}</p>}
            {searchName && !searchErr && (
              searchRecord
                ? <NameCard name={searchName} record={searchRecord} wallet={wallet} onAction={handleAction} />
                : <ClaimCard name={searchName} wallet={wallet} onClaimed={handleClaimed} />
            )}
          </div>
        </div>
      )}

      {/* ── My Names ── */}
      {tab === 'mine' && (
        <div className="page">
          <div className="page-header">
            <h2 className="page-title">Your Names</h2>
            {!wallet && (
              <button className="btn-connect-inline" onClick={handleConnect}>
                Connect wallet to view
              </button>
            )}
          </div>
          <MyNames wallet={wallet} onAction={handleAction} refreshKey={refreshKey} />
        </div>
      )}

      {/* ── Footer ── */}
      <footer className="footer">
        <span>NameStake · Stellar Testnet</span>
        <div className="footer-links">
          <span>Claim: 0.5 XLM · Transfer: 0.2 XLM · Release: free</span>
          <a href={`https://stellar.expert/explorer/testnet/contract/${CONTRACT_ID}`}
            target="_blank" rel="noreferrer">Contract ↗</a>
        </div>
      </footer>
    </div>
  )
}
