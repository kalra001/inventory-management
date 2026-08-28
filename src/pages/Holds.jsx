import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import SearchableSelect from '../components/SearchableSelect'
import { todayStr, daysAgoStr } from '../lib/csv'

const emptyForm = { product_id: '', packets: '', held_by: '', note: '' }

export default function Holds() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [products, setProducts] = useState([])
  const [holds, setHolds] = useState([])
  const [released, setReleased] = useState([])
  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [available, setAvailable] = useState(null)
  const [editingHoldId, setEditingHoldId] = useState(null)
  const [editingOriginalPackets, setEditingOriginalPackets] = useState(0)

  const productOptions = useMemo(
    () => products.map((p) => ({
      value: p.product_id,
      label: `${p.product_id} — ${p.variety}${p.active ? '' : ' (archived)'}`,
    })),
    [products]
  )

  useEffect(() => {
    loadProducts()
    loadHolds()
    loadReleased()
  }, [])

  useEffect(() => {
    if (!form.product_id) {
      setAvailable(null)
      return
    }
    supabase
      .from('stock_summary')
      .select('packets_available')
      .eq('product_id', form.product_id)
      .single()
      .then(({ data }) => setAvailable(data?.packets_available ?? 0))
  }, [form.product_id])

  async function loadProducts() {
    const { data } = await supabase.from('products').select('product_id, variety, active').order('variety')
    setProducts(data ?? [])
  }

  async function loadHolds() {
    const { data, error } = await supabase
      .from('holds')
      .select('hold_id, packets, held_by, held_date, note, released, product_id, products(product_id, variety), placed_by:profiles!edited_by(name)')
      .eq('released', false)
      .order('held_date', { ascending: false })
      .order('hold_id', { ascending: false })
    if (error) setError(error.message)
    else setHolds(data)
  }

  async function loadReleased() {
    const cutoffStr = daysAgoStr(1)

    const { data, error } = await supabase
      .from('holds')
      .select('hold_id, packets, held_by, released_date, products(product_id, variety), released_by_user:profiles!released_by(name)')
      .eq('released', true)
      .gte('released_date', cutoffStr)
      .order('released_date', { ascending: false })
      .order('hold_id', { ascending: false })
    if (error) setError(error.message)
    else setReleased(data)
  }

  function updateField(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)

    const packets = Number(form.packets)
    // when editing, this hold's own current amount is already excluded from
    // `available`, so add it back before checking whether the new amount fits
    const effectiveAvailable = available !== null ? available + (editingHoldId ? editingOriginalPackets : 0) : null

    if (effectiveAvailable !== null && packets > effectiveAvailable) {
      setError(`Cannot hold ${packets} packets — only ${effectiveAvailable} available for this product.`)
      return
    }

    setSubmitting(true)
    const payload = {
      product_id: form.product_id,
      packets,
      held_by: form.held_by,
      note: form.note || null,
      edited_by: user.id,
    }
    const { error } = editingHoldId
      ? await supabase.from('holds').update(payload).eq('hold_id', editingHoldId)
      : await supabase.from('holds').insert(payload)
    setSubmitting(false)
    if (error) {
      setError(error.message)
      return
    }
    setEditingHoldId(null)
    setEditingOriginalPackets(0)
    setForm(emptyForm)
    loadHolds()
  }

  function startEdit(h) {
    setEditingHoldId(h.hold_id)
    setEditingOriginalPackets(h.packets)
    setForm({
      product_id: h.product_id,
      packets: String(h.packets),
      held_by: h.held_by,
      note: h.note || '',
    })
  }

  function cancelEdit() {
    setEditingHoldId(null)
    setEditingOriginalPackets(0)
    setForm(emptyForm)
  }

  function dispatchFromHold(h) {
    navigate('/dispatches', {
      state: { fromHoldId: h.hold_id, product_id: h.product_id, packets: h.packets },
    })
  }

  async function release(holdId) {
    const { error } = await supabase
      .from('holds')
      .update({
        released: true,
        released_date: todayStr(),
        released_by: user.id,
        edited_by: user.id,
      })
      .eq('hold_id', holdId)
    if (error) setError(error.message)
    else {
      loadHolds()
      loadReleased()
    }
  }

  return (
    <div className="page">
      <h1>Holds (reserved, not yet dispatched)</h1>

      <form className="stack-form" onSubmit={handleSubmit}>
        <label>
          Product
          <SearchableSelect
            options={productOptions}
            value={form.product_id}
            onChange={(v) => updateField('product_id', v)}
            placeholder="Type to search…"
            required
          />
        </label>
        {available !== null && (
          <p className="hint">Available: {available + (editingHoldId ? editingOriginalPackets : 0)} packets</p>
        )}
        <label>
          Packets
          <input type="number" min="0.01" step="any" value={form.packets} onChange={(e) => updateField('packets', e.target.value)} required />
        </label>
        <label>
          Held by
          <input value={form.held_by} onChange={(e) => updateField('held_by', e.target.value)} required />
        </label>
        <label>
          Note
          <input value={form.note} onChange={(e) => updateField('note', e.target.value)} />
        </label>
        <button type="submit" disabled={submitting}>
          {submitting ? 'Saving…' : editingHoldId ? 'Save changes' : 'Place hold'}
        </button>
        {editingHoldId && <button type="button" onClick={cancelEdit}>Cancel</button>}
      </form>

      {error && <p className="error">{error}</p>}

      <h2>Active holds</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Product</th><th>Packets</th><th>Held By</th><th>Date</th><th>Note</th><th>Placed By</th><th></th><th></th><th></th>
            </tr>
          </thead>
          <tbody>
            {holds.map((h) => (
              <tr key={h.hold_id}>
                <td>{h.products?.product_id} — {h.products?.variety}</td>
                <td>{h.packets}</td>
                <td>{h.held_by}</td>
                <td>{h.held_date}</td>
                <td>{h.note}</td>
                <td>{h.placed_by?.name}</td>
                <td><button type="button" onClick={() => startEdit(h)}>Edit</button></td>
                <td><button type="button" onClick={() => release(h.hold_id)}>Release</button></td>
                <td><button type="button" onClick={() => dispatchFromHold(h)}>Dispatch</button></td>
              </tr>
            ))}
            {holds.length === 0 && (
              <tr><td colSpan={9}>No active holds.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <h2>Recently released holds (last 24 hours)</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Product</th><th>Packets</th><th>Held By</th><th>Released Date</th><th>Released By</th>
            </tr>
          </thead>
          <tbody>
            {released.map((h) => (
              <tr key={h.hold_id}>
                <td>{h.products?.product_id} — {h.products?.variety}</td>
                <td>{h.packets}</td>
                <td>{h.held_by}</td>
                <td>{h.released_date}</td>
                <td>{h.released_by_user?.name}</td>
              </tr>
            ))}
            {released.length === 0 && (
              <tr><td colSpan={5}>No holds released in the last 24 hours.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
