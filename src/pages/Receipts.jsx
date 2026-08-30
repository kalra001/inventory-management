import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { rowsToCsv, downloadCsv, addMonths, todayStr } from '../lib/csv'
import SearchableSelect from '../components/SearchableSelect'

const emptyForm = { product_id: '', date: todayStr(), packets: '', vehicle: '', container_no: '', remarks: '', po_id: '', po_item_id: '' }

const REPORT_COLUMNS = [
  { label: 'SO Number', value: (r) => r.purchase_order_items?.purchase_orders?.so_number },
  { label: 'Date', value: (r) => r.date },
  { label: 'Product ID', value: (r) => r.products?.product_id },
  { label: 'Variety', value: (r) => r.products?.variety },
  { label: 'GSM', value: (r) => r.products?.gsm },
  { label: 'Size (cm)', value: (r) => r.products?.size_cm },
  { label: 'Size (in)', value: (r) => r.products?.size_in },
  { label: 'Packet Weight', value: (r) => r.products?.packet_weight },
  { label: 'Packets', value: (r) => r.packets },
  { label: 'Quantity (kg)', value: (r) => (r.products?.packet_weight != null ? r.packets * r.products.packet_weight : '') },
  { label: 'Vehicle', value: (r) => r.vehicle },
  { label: 'Container No', value: (r) => r.container_no },
  { label: 'Remarks', value: (r) => r.remarks },
  { label: 'Edited By', value: (r) => r.profiles?.name },
]

export default function Receipts() {
  const { user } = useAuth()
  const [products, setProducts] = useState([])
  const [pos, setPos] = useState([])
  const [poItems, setPoItems] = useState([])
  const [recent, setRecent] = useState([])
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
    () => [{ value: '', label: 'No PO' }, ...pos.map((po) => ({ value: po.po_id, label: po.so_number }))],
    [pos]
  )

  const poItemOptions = useMemo(
    () => poItems.map((i) => ({
      value: i.po_item_id,
      label: `${i.product_id} — ${i.variety} (balance ${i.balance_kg} kg)${i.closed ? ' (closed)' : ''}`,
    })),
    [poItems]
  )

  useEffect(() => {
    loadProducts()
    loadPos()
    loadRecent()
  }, [])

  useEffect(() => {
    if (!form.po_id) {
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
    const { data } = await supabase.from('purchase_orders').select('po_id, so_number').order('so_number')
    setPos(data ?? [])
  }

  async function loadRecent() {
    const { data, error } = await supabase
      .from('receipts')
      .select('receipt_id, date, packets, vehicle, container_no, remarks, product_id, po_item_id, products(product_id, variety, size_cm, size_in, packet_weight), profiles(name), purchase_order_items(po_id, purchase_orders(so_number))')
      .order('receipt_id', { ascending: false })
      .limit(25)
    if (error) setError(error.message)
    else setRecent(data)
  }

  function updateField(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  function selectPoItem(poItemId) {
    const item = poItems.find((i) => String(i.po_item_id) === String(poItemId))
    setForm((f) => ({ ...f, po_item_id: poItemId, product_id: item ? item.product_id : f.product_id }))
  }

  function startEdit(r) {
    setEditingId(r.receipt_id)
    setForm({
      product_id: r.product_id,
      date: r.date,
      packets: String(r.packets),
      vehicle: r.vehicle || '',
      container_no: r.container_no || '',
      remarks: r.remarks || '',
      po_id: r.purchase_order_items?.po_id ? String(r.purchase_order_items.po_id) : '',
      po_item_id: r.po_item_id ? String(r.po_item_id) : '',
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
      date: form.date,
      packets: Number(form.packets),
      vehicle: form.vehicle || null,
      container_no: form.container_no || null,
      remarks: form.remarks || null,
      po_item_id: form.po_item_id || null,
      edited_by: user.id,
    }
    const { error } = editingId
      ? await supabase.from('receipts').update(payload).eq('receipt_id', editingId)
      : await supabase.from('receipts').insert(payload)
    setSubmitting(false)
    if (error) {
      setError(error.message)
      return
    }
    setEditingId(null)
    setForm({ ...emptyForm, date: form.date })
    loadRecent()
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
      .from('receipts')
      .select('receipt_id, date, packets, vehicle, container_no, remarks, products(product_id, variety, gsm, size_cm, size_in, packet_weight), profiles(name), purchase_order_items(po_id, purchase_orders(so_number))')
      .gte('date', reportFrom)
      .lte('date', reportTo)
      .order('date', { ascending: true })
      .order('receipt_id', { ascending: true })
    setReportBusy(false)

    if (error) {
      setReportError(error.message)
      return
    }
    downloadCsv(`receipts-${reportFrom}-to-${reportTo}.csv`, rowsToCsv(data, REPORT_COLUMNS))
  }

  return (
    <div className="page">
      <h1>Receipts (incoming stock)</h1>

      <form className="stack-form" onSubmit={handleSubmit}>
        <label>
          Purchase Order (optional)
          <SearchableSelect
            options={poOptions}
            value={form.po_id}
            onChange={(v) => updateField('po_id', v)}
            placeholder="Type to search…"
            className="narrow"
          />
        </label>
        {form.po_id && (
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
          Date
          <input type="date" value={form.date} onChange={(e) => updateField('date', e.target.value)} required />
        </label>
        <label>
          Packets
          <input type="number" min="0.01" step="any" value={form.packets} onChange={(e) => updateField('packets', e.target.value)} required />
        </label>
        <label>
          Vehicle
          <input value={form.vehicle} onChange={(e) => updateField('vehicle', e.target.value)} />
        </label>
        <label>
          Container No
          <input value={form.container_no} onChange={(e) => updateField('container_no', e.target.value)} />
        </label>
        <label>
          Remarks
          <input value={form.remarks} onChange={(e) => updateField('remarks', e.target.value)} />
        </label>
        <button type="submit" disabled={submitting}>
          {submitting ? 'Saving…' : editingId ? 'Update receipt' : 'Record receipt'}
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
      <p className="hint">Date range is limited to 2 months.</p>

      <h2>Recent receipts</h2>
      <div className="table-scroll">
        <table className="card-table">
          <thead>
            <tr>
              <th>SO Number</th><th>Date</th><th>Product</th><th>Size (cm)</th><th>Size (in)</th><th>Packet Wt</th><th>Packets</th><th>Quantity (kg)</th><th>Vehicle</th><th>Container</th><th>Remarks</th><th>Edited By</th><th></th>
            </tr>
          </thead>
          <tbody>
            {recent.map((r) => (
              <tr key={r.receipt_id}>
                <td data-label="SO Number">{r.purchase_order_items?.purchase_orders?.so_number}</td>
                <td data-label="Date">{r.date}</td>
                <td data-label="Product">{r.products?.product_id} — {r.products?.variety}</td>
                <td data-label="Size (cm)">{r.products?.size_cm}</td>
                <td data-label="Size (in)">{r.products?.size_in}</td>
                <td data-label="Packet Wt">{r.products?.packet_weight}</td>
                <td data-label="Packets">{r.packets}</td>
                <td data-label="Quantity (kg)">{r.products?.packet_weight != null ? r.packets * r.products.packet_weight : ''}</td>
                <td data-label="Vehicle">{r.vehicle}</td>
                <td data-label="Container">{r.container_no}</td>
                <td data-label="Remarks">{r.remarks}</td>
                <td data-label="Edited By">{r.profiles?.name}</td>
                <td><button type="button" onClick={() => startEdit(r)}>Edit</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
