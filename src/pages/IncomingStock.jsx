import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { rowsToCsv, downloadCsv, addMonths, todayStr, daysAgoStr } from '../lib/csv'
import SearchableSelect from '../components/SearchableSelect'

const emptyForm = { product_id: '', po_id: '', po_item_id: '', expected_date: '', packets: '', vehicle: '', remarks: '' }

const REPORT_COLUMNS = [
  { label: 'Product ID', value: (r) => r.products?.product_id },
  { label: 'Variety', value: (r) => r.products?.variety },
  { label: 'Packets', value: (r) => r.packets },
  { label: 'Expected Date', value: (r) => r.expected_date },
  { label: 'Vehicle', value: (r) => r.vehicle },
  { label: 'SO Number', value: (r) => r.purchase_order_items?.purchase_orders?.so_number },
  { label: 'Remarks', value: (r) => r.remarks },
  { label: 'Status', value: (r) => (r.received ? 'Received' : 'Pending') },
  { label: 'Received Date', value: (r) => r.received_date },
  { label: 'Edited By', value: (r) => r.profiles?.name },
]

export default function IncomingStock() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [products, setProducts] = useState([])
  const [pos, setPos] = useState([])
  const [poItems, setPoItems] = useState([])
  const [pending, setPending] = useState([])
  const [receivedRecent, setReceivedRecent] = useState([])
  const [pendingSearch, setPendingSearch] = useState('')
  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [reportFrom, setReportFrom] = useState(todayStr())
  const [reportTo, setReportTo] = useState(todayStr())
  const [reportError, setReportError] = useState(null)
  const [reportBusy, setReportBusy] = useState(false)

  const productOptions = useMemo(
    () => products.map((p) => ({
      value: p.product_id,
      label: `${p.product_id} — ${p.variety}${p.active ? '' : ' (archived)'}`,
    })),
    [products]
  )

  const poOptions = useMemo(
    () => [{ value: 'none', label: 'No PO' }, ...pos.map((po) => ({ value: po.po_id, label: `${po.so_number} (${po.po_number})` }))],
    [pos]
  )

  // both '' (nothing picked yet) and 'none' (explicitly "No PO") mean no PO linked
  const hasPo = form.po_id && form.po_id !== 'none'

  const poItemOptions = useMemo(
    () => poItems.map((i) => ({
      value: i.po_item_id,
      label: `${i.product_id} — ${i.variety} (balance ${i.balance_kg} kg)${i.closed ? ' (closed)' : ''}`,
    })),
    [poItems]
  )

  const filteredPending = useMemo(() => {
    const q = pendingSearch.trim().toLowerCase()
    if (!q) return pending
    return pending.filter((r) => {
      const haystacks = [r.products?.product_id, r.products?.variety].map((v) => v?.toLowerCase() ?? '')
      return haystacks.some((h) => h.includes(q))
    })
  }, [pending, pendingSearch])

  useEffect(() => {
    loadProducts()
    loadPos()
    loadPending()
    loadReceivedRecent()
  }, [])

  useEffect(() => {
    if (!hasPo) {
      setPoItems([])
      return
    }
    supabase
      .from('po_item_status')
      .select('po_item_id, product_id, variety, ordered_qty_kg, received_kg, balance_kg, closed')
      .eq('po_id', form.po_id)
      .then(({ data }) => setPoItems(data ?? []))
  }, [form.po_id])

  async function loadProducts() {
    const { data } = await supabase.from('products').select('product_id, variety, active').order('variety')
    setProducts(data ?? [])
  }

  async function loadPos() {
    // only POs whose SO number has arrived — consistent with Receipts
    const { data } = await supabase
      .from('purchase_orders')
      .select('po_id, po_number, so_number')
      .not('so_number', 'is', null)
      .order('so_number')
    setPos(data ?? [])
  }

  async function loadPending() {
    const { data, error } = await supabase
      .from('incoming_stock')
      .select('incoming_id, product_id, packets, expected_date, vehicle, remarks, po_item_id, products(product_id, variety, packet_weight), profiles(name), purchase_order_items(po_id, purchase_orders(so_number))')
      .eq('received', false)
      .order('expected_date', { ascending: true })
      .order('incoming_id', { ascending: true })
    if (error) setError(error.message)
    else setPending(data)
  }

  async function loadReceivedRecent() {
    const cutoffStr = daysAgoStr(1)
    const { data, error } = await supabase
      .from('incoming_stock')
      .select('incoming_id, product_id, packets, expected_date, received_date, products(product_id, variety), profiles(name)')
      .eq('received', true)
      .gte('received_date', cutoffStr)
      .order('received_date', { ascending: false })
      .order('incoming_id', { ascending: false })
    if (error) setError(error.message)
    else setReceivedRecent(data)
  }

  function updateField(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  function selectPo(poId) {
    setForm((f) => ({ ...f, po_id: poId, po_item_id: '' }))
  }

  function selectPoItem(poItemId) {
    const item = poItems.find((i) => String(i.po_item_id) === String(poItemId))
    setForm((f) => ({ ...f, po_item_id: poItemId, product_id: item ? item.product_id : f.product_id }))
  }

  function startEdit(r) {
    setEditingId(r.incoming_id)
    setForm({
      product_id: r.product_id,
      po_id: r.purchase_order_items?.po_id ? String(r.purchase_order_items.po_id) : '',
      po_item_id: r.po_item_id ? String(r.po_item_id) : '',
      expected_date: r.expected_date || '',
      packets: String(r.packets),
      vehicle: r.vehicle || '',
      remarks: r.remarks || '',
    })
  }

  function cancelEdit() {
    setEditingId(null)
    setForm(emptyForm)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    const payload = {
      product_id: form.product_id,
      packets: Number(form.packets),
      po_item_id: form.po_item_id || null,
      expected_date: form.expected_date || null,
      vehicle: form.vehicle || null,
      remarks: form.remarks || null,
      edited_by: user.id,
    }
    const { error } = editingId
      ? await supabase.from('incoming_stock').update(payload).eq('incoming_id', editingId)
      : await supabase.from('incoming_stock').insert(payload)
    setSubmitting(false)
    if (error) {
      setError(error.message)
      return
    }
    setEditingId(null)
    setForm(emptyForm)
    loadPending()
  }

  async function deleteIncoming(incomingId) {
    if (!window.confirm('Delete this incoming stock entry?')) return
    const { error } = await supabase.from('incoming_stock').delete().eq('incoming_id', incomingId)
    if (error) setError(error.message)
    else loadPending()
  }

  function handleReceive(r) {
    navigate('/receipts', {
      state: {
        fromIncomingId: r.incoming_id,
        product_id: r.product_id,
        packets: r.packets,
        vehicle: r.vehicle || '',
        po_id: r.purchase_order_items?.po_id ? String(r.purchase_order_items.po_id) : '',
        po_item_id: r.po_item_id ? String(r.po_item_id) : '',
      },
    })
  }

  async function handleDownloadReport(e) {
    e.preventDefault()
    setReportError(null)

    if (!reportFrom || !reportTo) {
      setReportError('Pick both a from and to date.')
      return
    }
    if (reportTo < reportFrom) {
      setReportError('To date must be on or after the from date.')
      return
    }
    if (reportTo > addMonths(reportFrom, 2)) {
      setReportError('Date range cannot exceed 2 months.')
      return
    }

    setReportBusy(true)
    const { data, error } = await supabase
      .from('incoming_stock')
      .select('incoming_id, packets, expected_date, vehicle, remarks, received, received_date, products(product_id, variety), profiles(name), purchase_order_items(po_id, purchase_orders(so_number))')
      .gte('expected_date', reportFrom)
      .lte('expected_date', reportTo)
      .order('expected_date', { ascending: true })
      .order('incoming_id', { ascending: true })
    setReportBusy(false)

    if (error) {
      setReportError(error.message)
      return
    }
    downloadCsv(`incoming-stock-${reportFrom}-to-${reportTo}.csv`, rowsToCsv(data, REPORT_COLUMNS))
  }

  return (
    <div className="page">
      <h1>Incoming Stock (dispatched by mill, not yet received)</h1>

      <form className="stack-form" onSubmit={handleSubmit}>
        <label>
          Purchase Order (optional)
          <SearchableSelect
            options={poOptions}
            value={form.po_id}
            onChange={selectPo}
            placeholder="Type to search…"
            className="narrow"
          />
        </label>
        {hasPo && (
          <label>
            PO Item
            <SearchableSelect
              options={poItemOptions}
              value={form.po_item_id}
              onChange={selectPoItem}
              placeholder="Type to search…"
            />
          </label>
        )}
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
        <label>
          Packets (expected)
          <input type="number" min="0.01" step="any" value={form.packets} onChange={(e) => updateField('packets', e.target.value)} required />
        </label>
        <label>
          Expected Date
          <input type="date" value={form.expected_date} onChange={(e) => updateField('expected_date', e.target.value)} />
        </label>
        <label>
          Vehicle
          <input value={form.vehicle} onChange={(e) => updateField('vehicle', e.target.value)} />
        </label>
        <label>
          Remarks
          <input value={form.remarks} onChange={(e) => updateField('remarks', e.target.value)} />
        </label>
        <button type="submit" disabled={submitting}>
          {submitting ? 'Saving…' : editingId ? 'Save changes' : 'Add incoming stock'}
        </button>
        {editingId && <button type="button" onClick={cancelEdit}>Cancel</button>}
      </form>

      {error && <p className="error">{error}</p>}

      <h2>Download report</h2>
      <form className="inline-form" onSubmit={handleDownloadReport}>
        <label>
          From
          <input type="date" value={reportFrom} max={reportTo} onChange={(e) => setReportFrom(e.target.value)} required />
        </label>
        <label>
          To
          <input type="date" value={reportTo} min={reportFrom} max={addMonths(reportFrom, 2)} onChange={(e) => setReportTo(e.target.value)} required />
        </label>
        <button type="submit" disabled={reportBusy}>{reportBusy ? 'Preparing…' : 'Download CSV'}</button>
      </form>
      {reportError && <p className="error">{reportError}</p>}
      <p className="hint">Date range is limited to 2 months. Filters by expected date.</p>

      <div className="page-header">
        <h2>Pending incoming stock</h2>
        <input
          className="search-box"
          placeholder="Search product…"
          value={pendingSearch}
          onChange={(e) => setPendingSearch(e.target.value)}
        />
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Product</th><th>Packets</th><th>Expected Date</th><th>Vehicle</th><th>SO Number</th><th>Remarks</th><th>Edited By</th><th></th><th></th><th></th>
            </tr>
          </thead>
          <tbody>
            {filteredPending.map((r) => (
              <tr key={r.incoming_id}>
                <td>{r.products?.product_id} — {r.products?.variety}</td>
                <td>{r.packets}</td>
                <td>{r.expected_date}</td>
                <td>{r.vehicle}</td>
                <td>{r.purchase_order_items?.purchase_orders?.so_number}</td>
                <td>{r.remarks}</td>
                <td>{r.profiles?.name}</td>
                <td><button type="button" onClick={() => startEdit(r)}>Edit</button></td>
                <td><button type="button" onClick={() => handleReceive(r)}>Receive</button></td>
                <td><button type="button" onClick={() => deleteIncoming(r.incoming_id)}>Delete</button></td>
              </tr>
            ))}
            {filteredPending.length === 0 && (
              <tr><td colSpan={10}>{pendingSearch ? 'No pending incoming stock matches that search.' : 'No incoming stock pending.'}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <h2>Recently received (last 24 hours)</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Product</th><th>Packets</th><th>Expected Date</th><th>Received Date</th><th>Edited By</th>
            </tr>
          </thead>
          <tbody>
            {receivedRecent.map((r) => (
              <tr key={r.incoming_id}>
                <td>{r.products?.product_id} — {r.products?.variety}</td>
                <td>{r.packets}</td>
                <td>{r.expected_date}</td>
                <td>{r.received_date}</td>
                <td>{r.profiles?.name}</td>
              </tr>
            ))}
            {receivedRecent.length === 0 && (
              <tr><td colSpan={5}>No incoming stock received in the last 24 hours.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
