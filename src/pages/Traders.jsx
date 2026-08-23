import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Traders() {
  const [traders, setTraders] = useState([])
  const [name, setName] = useState('')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    const { data, error } = await supabase.from('traders').select('*').order('name')
    if (error) setError(error.message)
    else setTraders(data)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    const { error } = await supabase.from('traders').insert({ name: name.trim() })
    setSubmitting(false)
    if (error) {
      setError(error.message)
      return
    }
    setName('')
    load()
  }

  async function toggleActive(trader) {
    setError(null)
    const { error } = await supabase.from('traders').update({ active: !trader.active }).eq('trader_id', trader.trader_id)
    if (error) setError(error.message)
    else load()
  }

  async function handleDelete(traderId) {
    if (!window.confirm('Permanently delete this trader? This cannot be undone.')) return
    setError(null)
    const { error } = await supabase.from('traders').delete().eq('trader_id', traderId)
    if (error) {
      setError(
        error.code === '23503'
          ? 'Cannot delete this trader — it already has invoices recorded against it. Use Archive instead to hide it without losing that history.'
          : error.message
      )
      return
    }
    load()
  }

  return (
    <div className="page">
      <h1>Traders</h1>

      <form className="inline-form" onSubmit={handleSubmit}>
        <input placeholder="Trader name" value={name} onChange={(e) => setName(e.target.value)} required />
        <button type="submit" disabled={submitting || !name.trim()}>{submitting ? 'Adding…' : 'Add trader'}</button>
      </form>

      {error && <p className="error">{error}</p>}

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Name</th><th>Active</th><th></th><th></th>
            </tr>
          </thead>
          <tbody>
            {traders.map((t) => (
              <tr key={t.trader_id} className={t.active ? '' : 'archived-row'}>
                <td>{t.name}</td>
                <td>{t.active ? 'Yes' : 'No'}</td>
                <td><button type="button" onClick={() => toggleActive(t)}>{t.active ? 'Archive' : 'Unarchive'}</button></td>
                <td><button type="button" onClick={() => handleDelete(t.trader_id)}>Delete</button></td>
              </tr>
            ))}
            {traders.length === 0 && (
              <tr><td colSpan={4}>No traders yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
