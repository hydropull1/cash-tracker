import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import './App.css'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const supabase =
  supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null

const todayKey = toDateKey(new Date())
const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
})

function toDateKey(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function parseDateKey(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number)

  return new Date(year, month - 1, day)
}

function formatDate(dateKey, options = {}) {
  return parseDateKey(dateKey).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...options,
  })
}

function getWeekStart(dateKey) {
  const date = parseDateKey(dateKey)
  const day = date.getDay()
  const diff = day === 0 ? -6 : 1 - day

  date.setDate(date.getDate() + diff)

  return toDateKey(date)
}

function addDays(dateKey, days) {
  const date = parseDateKey(dateKey)
  date.setDate(date.getDate() + days)

  return toDateKey(date)
}

function getTotals(transactions) {
  return transactions.reduce(
    (totals, transaction) => {
      const amount = Number(transaction.amount)

      if (transaction.type === 'pickup') {
        totals.pickups += amount
      } else {
        totals.dropoffs += amount
      }

      totals.net = totals.pickups - totals.dropoffs

      return totals
    },
    { pickups: 0, dropoffs: 0, net: 0 },
  )
}

function groupTransactionsByWeek(transactions) {
  const weeks = new Map()

  transactions.forEach((transaction) => {
    const weekStart = getWeekStart(transaction.transaction_date)
    const weekEnd = addDays(weekStart, 6)

    if (!weeks.has(weekStart)) {
      weeks.set(weekStart, {
        id: weekStart,
        label: `${formatDate(weekStart, { year: undefined })} - ${formatDate(weekEnd)}`,
        weekStart,
        weekEnd,
        transactions: [],
      })
    }

    weeks.get(weekStart).transactions.push(transaction)
  })

  return Array.from(weeks.values())
    .map((week) => ({
      ...week,
      totals: getTotals(week.transactions),
      days: dayNames.map((name, index) => {
        const dateKey = addDays(week.weekStart, index)
        const transactionsForDay = week.transactions.filter(
          (transaction) => transaction.transaction_date === dateKey,
        )

        return {
          name,
          dateKey,
          transactions: transactionsForDay,
          totals: getTotals(transactionsForDay),
        }
      }),
    }))
    .sort((a, b) => b.weekStart.localeCompare(a.weekStart))
}

function App() {
  const [activeTab, setActiveTab] = useState('today')
  const [authMode, setAuthMode] = useState('sign-in')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authLoading, setAuthLoading] = useState(false)
  const [session, setSession] = useState(null)
  const [loadingSession, setLoadingSession] = useState(Boolean(supabase))
  const [transactions, setTransactions] = useState([])
  const [transactionsLoading, setTransactionsLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [expandedWeek, setExpandedWeek] = useState('')
  const [form, setForm] = useState({
    type: 'pickup',
    place: '',
    amount: '',
    transaction_date: todayKey,
    note: '',
  })

  useEffect(() => {
    if (!supabase) {
      return undefined
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoadingSession(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      if (!nextSession) {
        setTransactions([])
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (session?.user && supabase) {
      loadTransactions(session.user.id)
    }
  }, [session])

  const todayTransactions = useMemo(
    () => transactions.filter((transaction) => transaction.transaction_date === todayKey),
    [transactions],
  )
  const todayTotals = useMemo(() => getTotals(todayTransactions), [todayTransactions])
  const weeklyGroups = useMemo(() => groupTransactionsByWeek(transactions), [transactions])

  async function loadTransactions(userId) {
    setTransactionsLoading(true)
    setMessage('')

    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', userId)
      .order('transaction_date', { ascending: false })
      .order('created_at', { ascending: false })

    if (error) {
      setMessage(error.message)
    } else {
      setTransactions(data ?? [])
    }

    setTransactionsLoading(false)
  }

  async function handleAuth(event) {
    event.preventDefault()
    setAuthLoading(true)
    setMessage('')

    const credentials = {
      email: authEmail,
      password: authPassword,
    }
    const { error } =
      authMode === 'sign-in'
        ? await supabase.auth.signInWithPassword(credentials)
        : await supabase.auth.signUp(credentials)

    if (error) {
      setMessage(error.message)
    } else if (authMode === 'sign-up') {
      setMessage('Account created. Check your email if confirmation is enabled.')
    }

    setAuthLoading(false)
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    setTransactions([])
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setMessage('')

    const amount = Number(form.amount)

    if (!form.place.trim() || !Number.isFinite(amount) || amount <= 0) {
      setMessage('Enter a place and a dollar amount greater than zero.')
      return
    }

    const { error } = await supabase.from('transactions').insert({
      user_id: session.user.id,
      type: form.type,
      place: form.place.trim(),
      amount,
      transaction_date: form.transaction_date,
      note: form.note.trim() || null,
    })

    if (error) {
      setMessage(error.message)
      return
    }

    setForm((current) => ({
      ...current,
      place: '',
      amount: '',
      note: '',
    }))
    await loadTransactions(session.user.id)
  }

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  if (!supabase) {
    return (
      <main className="setup-screen">
        <section className="setup-card">
          <p className="eyebrow">Supabase setup required</p>
          <h1>Connect your project</h1>
          <p>
            Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to a
            local <code>.env</code> file, then restart the dev server.
          </p>
        </section>
      </main>
    )
  }

  if (loadingSession) {
    return (
      <main className="setup-screen">
        <section className="setup-card">
          <p className="eyebrow">Loading</p>
          <h1>Checking your session...</h1>
        </section>
      </main>
    )
  }

  if (!session) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <p className="eyebrow">Cash Tracker</p>
          <h1>{authMode === 'sign-in' ? 'Welcome back' : 'Create your account'}</h1>
          <p className="muted">
            Track pickups and dropoffs with totals grouped by day and week.
          </p>

          <form className="stack" onSubmit={handleAuth}>
            <label>
              Email
              <input
                type="email"
                value={authEmail}
                onChange={(event) => setAuthEmail(event.target.value)}
                placeholder="you@example.com"
                required
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={authPassword}
                onChange={(event) => setAuthPassword(event.target.value)}
                placeholder="At least 6 characters"
                minLength="6"
                required
              />
            </label>

            {message && <p className="message">{message}</p>}

            <button type="submit" className="primary-button" disabled={authLoading}>
              {authLoading
                ? 'Please wait...'
                : authMode === 'sign-in'
                  ? 'Sign in'
                  : 'Sign up'}
            </button>
          </form>

          <button
            type="button"
            className="text-button"
            onClick={() => {
              setAuthMode((current) => (current === 'sign-in' ? 'sign-up' : 'sign-in'))
              setMessage('')
            }}
          >
            {authMode === 'sign-in'
              ? 'Need an account? Sign up'
              : 'Already have an account? Sign in'}
          </button>
        </section>
      </main>
    )
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Cash Tracker</p>
          <h1>Pickups and dropoffs</h1>
          <p className="muted">{session.user.email}</p>
        </div>
        <button type="button" className="secondary-button" onClick={handleSignOut}>
          Sign out
        </button>
      </header>

      <nav className="tabs" aria-label="Dashboard views">
        <button
          type="button"
          className={activeTab === 'today' ? 'active' : ''}
          onClick={() => setActiveTab('today')}
        >
          Today
        </button>
        <button
          type="button"
          className={activeTab === 'weekly' ? 'active' : ''}
          onClick={() => setActiveTab('weekly')}
        >
          Weekly
        </button>
      </nav>

      {message && <p className="message dashboard-message">{message}</p>}

      {activeTab === 'today' ? (
        <section className="dashboard-grid">
          <div className="panel full-width">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Today</p>
                <h2>{formatDate(todayKey)}</h2>
              </div>
              {transactionsLoading && <span className="loading-pill">Refreshing...</span>}
            </div>
            <div className="stats-grid">
              <article className="stat-card pickup">
                <span>Total picked up</span>
                <strong>{currency.format(todayTotals.pickups)}</strong>
              </article>
              <article className="stat-card dropoff">
                <span>Total dropped off</span>
                <strong>{currency.format(todayTotals.dropoffs)}</strong>
              </article>
              <article className={`stat-card net ${todayTotals.net < 0 ? 'negative' : ''}`}>
                <span>Net</span>
                <strong>{currency.format(todayTotals.net)}</strong>
              </article>
            </div>
          </div>

          <section className="panel">
            <p className="eyebrow">Log transaction</p>
            <h2>New cash movement</h2>
            <form className="transaction-form" onSubmit={handleSubmit}>
              <div className="segmented-control" aria-label="Transaction type">
                <button
                  type="button"
                  className={form.type === 'pickup' ? 'pickup active' : 'pickup'}
                  onClick={() => updateForm('type', 'pickup')}
                >
                  Pick Up
                </button>
                <button
                  type="button"
                  className={form.type === 'dropoff' ? 'dropoff active' : 'dropoff'}
                  onClick={() => updateForm('type', 'dropoff')}
                >
                  Drop Off
                </button>
              </div>

              <label>
                Place
                <input
                  value={form.place}
                  onChange={(event) => updateForm('place', event.target.value)}
                  placeholder="Store, client, or route"
                  required
                />
              </label>
              <label>
                Amount
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={form.amount}
                  onChange={(event) => updateForm('amount', event.target.value)}
                  placeholder="0.00"
                  required
                />
              </label>
              <label>
                Date
                <input
                  type="date"
                  value={form.transaction_date}
                  onChange={(event) => updateForm('transaction_date', event.target.value)}
                  required
                />
              </label>
              <label>
                Note
                <textarea
                  value={form.note}
                  onChange={(event) => updateForm('note', event.target.value)}
                  placeholder="Optional details"
                  rows="3"
                />
              </label>

              <button type="submit" className="primary-button">
                Save transaction
              </button>
            </form>
          </section>

          <section className="panel">
            <p className="eyebrow">Today&apos;s activity</p>
            <h2>{todayTransactions.length} transactions</h2>
            <TransactionList transactions={todayTransactions} emptyText="No transactions today." />
          </section>
        </section>
      ) : (
        <section className="panel weekly-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Weekly</p>
              <h2>Totals by week</h2>
            </div>
            {transactionsLoading && <span className="loading-pill">Refreshing...</span>}
          </div>

          {weeklyGroups.length === 0 ? (
            <p className="empty-state">No transactions logged yet.</p>
          ) : (
            <div className="week-list">
              {weeklyGroups.map((week) => (
                <article className="week-card" key={week.id}>
                  <button
                    type="button"
                    className="week-summary"
                    onClick={() =>
                      setExpandedWeek((current) => (current === week.id ? '' : week.id))
                    }
                  >
                    <span>
                      <strong>{week.label}</strong>
                      <small>{week.transactions.length} transactions</small>
                    </span>
                    <span className="summary-totals">
                      <span className="pickup">{currency.format(week.totals.pickups)}</span>
                      <span className="dropoff">{currency.format(week.totals.dropoffs)}</span>
                      <span className={week.totals.net < 0 ? 'negative' : 'net'}>
                        {currency.format(week.totals.net)}
                      </span>
                    </span>
                  </button>

                  {expandedWeek === week.id && (
                    <div className="day-breakdown">
                      {week.days.map((day) => (
                        <section className="day-card" key={day.dateKey}>
                          <div className="day-heading">
                            <span>
                              <strong>{day.name}</strong>
                              <small>{formatDate(day.dateKey)}</small>
                            </span>
                            <span className="day-net">{currency.format(day.totals.net)}</span>
                          </div>
                          <div className="mini-totals">
                            <span className="pickup">
                              Pickups {currency.format(day.totals.pickups)}
                            </span>
                            <span className="dropoff">
                              Dropoffs {currency.format(day.totals.dropoffs)}
                            </span>
                          </div>
                          <TransactionList
                            transactions={day.transactions}
                            emptyText="No transactions."
                            compact
                          />
                        </section>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  )
}

function TransactionList({ transactions, emptyText, compact = false }) {
  if (transactions.length === 0) {
    return <p className="empty-state">{emptyText}</p>
  }

  return (
    <ul className={compact ? 'transaction-list compact' : 'transaction-list'}>
      {transactions.map((transaction) => (
        <li key={transaction.id}>
          <span className={`type-dot ${transaction.type}`}></span>
          <div>
            <strong>{transaction.place}</strong>
            <small>
              {formatDate(transaction.transaction_date)}
              {transaction.note ? ` - ${transaction.note}` : ''}
            </small>
          </div>
          <span className={transaction.type}>
            {transaction.type === 'pickup' ? '+' : '-'}
            {currency.format(Number(transaction.amount))}
          </span>
        </li>
      ))}
    </ul>
  )
}

export default App
