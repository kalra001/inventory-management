import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { rowsToCsv, downloadCsv, addMonths, todayStr } from '../lib/csv'
import SearchableSelect from '../components/SearchableSelect'

const emptyForm = { product_id: '', date: todayStr(), packets: '', vehicle: '', challan_no: '', remarks: '' }

const REPORT_COLUMNS = [
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
  { label: 'Challan No', value: (r) => r.challan_no },
  { label: 'Remarks', value: (r) => r.remarks },
  { label: 'Edited By', value: (r) => r.profiles?.name },
]

export default function Dispatches() {
  const { user } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [products, setProducts] = useState([])
  const [recent, setRecent] = useState([])
  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [available, setAvailable] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editingOriginalPackets, setEditingOriginalPackets] = useState(0)
  const [releaseHoldId, setReleaseHoldId] = useState(null)
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

  useEffect(() => {
    loadProducts()
    loadRecent()
  }, [])

  useEffect(() => {
    if (location.state?.fromHoldId) {
      setForm((f) => ({
        ...f,
        product_id: location.state.product_id,
        packets: String(location.state.packets),
      }))
      setReleaseHoldId(location.state.fromHoldId)
      navigate(location.pathname, { replace: true, state: null })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state])

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

  async function loadRecent() {
    const { data, error } = await supabase
      .from('dispatches')
      .select('dispatch_id, date, packets, vehicle, challan_no, remarks, product_id, products(product_id, variety, size_cm, size_in, packet_weight), profiles(name)')
      .order('dispatch_id', { ascending: false })
      .limit(25)
    if (error) setError(error.message)
    else setRecent(data)
  }

  function updateField(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  function startEdit(r) {
    setEditingId(r.dispatch_id)
    setEditingOriginalPackets(r.packets)
    setReleaseHoldId(null)
    setForm({
      product_id: r.product_id,
      date: r.date,
      packets: String(r.packets),
      vehicle: r.vehicle || '',
      challan_no: r.challan_no || '',
      remarks: r.remarks || '',
    })
  }

  function cancelEdit() {
    setEditingId(null)
    setEditingOriginalPackets(0)
    setReleaseHoldId(null)
    setForm(emptyForm)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const packets = Number(form.packets)
    // when editing, the dispatch being edited is already counted in `available`,
    // so add its original amount back before comparing
    const effectiveAvailable = available !== null ? available + (editingId ? editingOriginalPackets : 0) : null

    if (effectiveAvailable !== null && packets > effectiveAvailable) {
      const proceed = window.confirm(
        `Only ${effectiveAvailable} packets available for this product. Dispatch ${packets} anyway?`
      )
      if (!proceed) return
    }

    setSubmitting(true)
    setError(null)
    const payload = {
      product_id: form.product_id,
      date: form.date,
      packets,
      vehicle: form.vehicle || null,
      challan_no: form.challan_no || null,
      remarks: form.remarks || null,
      edited_by: user.id,
    }
    const { error } = editingId
      ? await supabase.from('dispatches').update(payload).eq('dispatch_id', editingId)
      : await supabase.from('dispatches').insert(payload)

    if (error) {
      setSubmitting(false)
      setError(error.message)
      return
    }

    if (!editingId && releaseHoldId) {
      const { error: releaseError } = await supabase
        .from('holds')
        .update({
          released: true,
          released_date: todayStr(),
          released_by: user.id,
          edited_by: user.id,
        })
        .eq('hold_id', releaseHoldId)
      if (releaseError) {
        setSubmitting(false)
        setError(`Dispatch recorded, but failed to release the hold: ${releaseError.message}`)
        return
      }
    }

    setSubmitting(false)
    setEditingId(null)
    setEditingOriginalPackets(0)
    setReleaseHoldId(null)
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
      .from('dispatches')
      .select('dispatch_id, date, packets, vehicle, challan_no, remarks, products(product_id, variety, gsm, size_cm, size_in, packet_weight), profiles(name)')
      .gte('date', reportFrom)
      .lte('date', reportTo)
      .order('date', { ascending: true })
      .order('dispatch_id', { ascending: true })
    setReportBusy(false)

    if (error) {
      setReportError(error.message)
      return
    }
    downloadCsv(`dispatches-${reportFrom}-to-${reportTo}.csv`, rowsToCsv(data, REPORT_COLUMNS))
  }

  return (
    <div className="page">
      <h1>Dispatches (outgoing stock)</h1>

      {releaseHoldId && (
        <p className="hint">
          Dispatching against a held item — submitting this will also release that hold.{' '}
          <button type="button" onClick={() => { setReleaseHoldId(null); setForm(emptyForm) }}>Cancel</button>
        </p>
      )}

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
        {available !== null && <p className="hint">Available: {available + (editingId ? editingOriginalPackets : 0)} packets</p>}
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
          Dispatch Challan No.
          <input value={form.challan_no} onChange={(e) => updateField('challan_no', e.target.value)} />
        </label>
        <label>
          Remarks
          <input value={form.remarks} onChange={(e) => updateField('remarks', e.target.value)} />
        </label>
        <button type="submit" disabled={submitting}>
          {submitting ? 'Saving…' : editingId ? 'Update dispatch' : 'Record dispatch'}
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

      <h2>Recent dispatches</h2>
      <div className="table-scroll">
        <table className="card-table">
          <thead>
            <tr>
              <th>Date</th><th>Product</th><th>Size (cm)</th><th>Size (in)</th><th>Packet Wt</th><th>Packets</th><th>Quantity (kg)</th><th>Vehicle</th><th>Challan No</th><th>Remarks</th><th>Edited By</th><th></th>
            </tr>
          </thead>
          <tbody>
            {recent.map((r) => (
              <tr key={r.dispatch_id}>
                <td data-label="Date">{r.date}</td>
                <td data-label="Product">{r.products?.product_id} — {r.products?.variety}</td>
                <td data-label="Size (cm)">{r.products?.size_cm}</td>
                <td data-label="Size (in)">{r.products?.size_in}</td>
                <td data-label="Packet Wt">{r.products?.packet_weight}</td>
                <td data-label="Packets">{r.packets}</td>
                <td data-label="Quantity (kg)">{r.products?.packet_weight != null ? r.packets * r.products.packet_weight : ''}</td>
                <td data-label="Vehicle">{r.vehicle}</td>
                <td data-label="Challan No">{r.challan_no}</td>
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
