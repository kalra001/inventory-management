import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { rowsToCsv, downloadCsv, addMonths, todayStr, GST_PRESETS, presetForRate } from '../lib/csv'

const emptyBillForm = { bill_number: '', bill_date: todayStr(), remarks: '', gst_preset: '18', gst_custom: '' }
const emptyBillItemForm = { bill_id: '', po_item_id: '', qty_kg: '', mill_billed_amount: '' }

const ITEM_REPORT_COLUMNS = [
  { label: 'Bill Number', value: (r) => r.bill_number },
  { label: 'Bill Date', value: (r) => r.bill_date },
  { label: 'SO Number', value: (r) => r.so_number },
  { label: 'Company', value: (r) => r.company },
  { label: 'Source', value: (r) => r.source },
  { label: 'Ship To', value: (r) => r.ship_to },
  { label: 'Product ID', value: (r) => r.product_id },
  { label: 'Variety', value: (r) => r.variety },
  { label: 'GSM', value: (r) => r.gsm },
  { label: 'Size (cm)', value: (r) => r.size_cm },
  { label: 'NSR Rate', value: (r) => r.nsr_rate },
  { label: 'Actual Price/kg', value: (r) => r.actual_price_per_kg },
  { label: 'Qty (kg)', value: (r) => r.qty_kg },
  { label: 'Mill Billed Amount', value: (r) => r.mill_billed_amount },
  { label: 'Expected Amount', value: (r) => r.expected_amount },
  { label: 'Variance', value: (r) => r.variance },
  { label: 'GST Rate', value: (r) => r.gst_rate },
  { label: 'GST Amount', value: (r) => r.item_gst_amount },
  { label: 'Variance incl. GST', value: (r) => r.variance_including_gst },
]

const BILL_TOTALS_COLUMNS = [
  { label: 'Bill Number', value: (r) => r.bill_number },
  { label: 'Bill Date', value: (r) => r.bill_date },
  { label: 'Total Variance', value: (r) => r.total_variance },
  { label: 'GST Rate', value: (r) => r.gst_rate },
  { label: 'GST Amount', value: (r) => r.gst_amount },
  { label: 'Net Claim', value: (r) => r.net_claim },
]

export default function Bills() {
  const { user } = useAuth()
  const [bills, setBills] = useState([])
  const [poItems, setPoItems] = useState([])
  const [itemStatusRows, setItemStatusRows] = useState([])
  const [summaryRows, setSummaryRows] = useState([])
  const [billForm, setBillForm] = useState(emptyBillForm)
  const [billItemForm, setBillItemForm] = useState(emptyBillItemForm)
  const [editingBillItemId, setEditingBillItemId] = useState(null)
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [reportFrom, setReportFrom] = useState(todayStr())
  const [reportTo, setReportTo] = useState(todayStr())
  const [reportError, setReportError] = useState(null)
  const [reportBusy, setReportBusy] = useState(false)
  const [creditDrafts, setCreditDrafts] = useState({})

  useEffect(() => {
    loadBills()
    loadPoItems()
    loadItemStatus()
    loadSummary()
  }, [])

  async function loadBills() {
    const { data } = await supabase.from('bills').select('bill_id, bill_number, bill_date').order('bill_date', { ascending: false })
    setBills(data ?? [])
  }

  async function loadPoItems() {
    const { data } = await supabase
      .from('po_item_status')
      .select('po_item_id, so_number, product_id, variety, nsr_rate, actual_price_per_kg, received_kg, closed')
      .order('so_number')
    setPoItems(data ?? [])
  }

  async function loadItemStatus() {
    const { data, error } = await supabase
      .from('bill_item_status')
      .select('*')
      .order('bill_number', { ascending: true })
    if (error) setError(error.message)
    else setItemStatusRows(data)
  }

  async function loadSummary() {
    const { data, error } = await supabase
      .from('bill_summary')
      .select('*')
      .order('bill_date', { ascending: false })
    if (error) setError(error.message)
    else setSummaryRows(data)
  }

  function updateBillField(field, value) {
    setBillForm((f) => ({ ...f, [field]: value }))
  }

  function updateBillItemField(field, value) {
    setBillItemForm((f) => ({ ...f, [field]: value }))
  }

  function selectPoItem(poItemId) {
    const item = poItems.find((i) => String(i.po_item_id) === String(poItemId))
    setBillItemForm((f) => ({
      ...f,
      po_item_id: poItemId,
      qty_kg: item ? String(item.received_kg) : f.qty_kg,
    }))
  }

  async function handleCreateBill(e) {
    e.preventDefault()
    setError(null)
    if (!billForm.bill_number.trim()) {
      setError('Enter a bill number.')
      return
    }
    const gstRate = billForm.gst_preset === 'other' ? Number(billForm.gst_custom) : Number(billForm.gst_preset)
    if (billForm.gst_preset === 'other' && !billForm.gst_custom) {
      setError('Enter a custom GST rate.')
      return
    }
    setSubmitting(true)
    const { error } = await supabase.from('bills').insert({
      bill_number: billForm.bill_number.trim(),
      bill_date: billForm.bill_date,
      gst_rate: gstRate,
      remarks: billForm.remarks || null,
      edited_by: user.id,
    })
    setSubmitting(false)
    if (error) {
      setError(error.message)
      return
    }
    setBillForm(emptyBillForm)
    loadBills()
    loadSummary()
  }

  function startEditItem(r) {
    setEditingBillItemId(r.bill_item_id)
    setBillItemForm({
      bill_id: String(r.bill_id),
      po_item_id: String(r.po_item_id),
      qty_kg: String(r.qty_kg),
      mill_billed_amount: String(r.mill_billed_amount),
    })
  }

  function cancelEditItem() {
    setEditingBillItemId(null)
    setBillItemForm(emptyBillItemForm)
  }

  async function handleSaveBillItem(e) {
    e.preventDefault()
    setError(null)
    if (!billItemForm.bill_id || !billItemForm.po_item_id || !billItemForm.qty_kg || !billItemForm.mill_billed_amount) {
      setError('Pick a bill, a PO item, and enter qty and the mill billed amount.')
      return
    }

    setSubmitting(true)
    const payload = {
      bill_id: billItemForm.bill_id,
      po_item_id: billItemForm.po_item_id,
      qty_kg: Number(billItemForm.qty_kg),
      mill_billed_amount: Number(billItemForm.mill_billed_amount),
      edited_by: user.id,
    }
    const { error } = editingBillItemId
      ? await supabase.from('bill_items').update(payload).eq('bill_item_id', editingBillItemId)
      : await supabase.from('bill_items').insert(payload)
    setSubmitting(false)

    if (error) {
      setError(error.message)
      return
    }
    setEditingBillItemId(null)
    setBillItemForm(emptyBillItemForm)
    loadItemStatus()
    loadSummary()
  }

  function updateCreditDraft(billId, field, value) {
    setCreditDrafts((d) => ({ ...d, [billId]: { ...d[billId], [field]: value } }))
  }

  async function saveCreditNote(row) {
    const draft = creditDrafts[row.bill_id] || {}
    const gstPreset = draft.gst_preset ?? presetForRate(row.gst_rate)
    const gstCustom = draft.gst_custom ?? row.gst_rate
    const gstRate = gstPreset === 'other' ? Number(gstCustom) : Number(gstPreset)

    const { error } = await supabase
      .from('bills')
      .update({
        credit_note_number: draft.credit_note_number ?? row.credit_note_number,
        credit_note_amount: draft.credit_note_amount !== undefined ? Number(draft.credit_note_amount) || null : row.credit_note_amount,
        credit_note_date: draft.credit_note_date ?? row.credit_note_date,
        gst_rate: gstRate,
      })
      .eq('bill_id', row.bill_id)
    if (error) setError(error.message)
    else loadSummary()
  }

  async function toggleSettled(row) {
    const { error } = await supabase
      .from('bills')
      .update({
        settled: !row.settled,
        settled_date: !row.settled ? todayStr() : null,
        settled_by: !row.settled ? user.id : null,
      })
      .eq('bill_id', row.bill_id)
    if (error) setError(error.message)
    else loadSummary()
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
    const [itemsRes, summaryRes] = await Promise.all([
      supabase.from('bill_item_status').select('*').gte('bill_date', reportFrom).lte('bill_date', reportTo).order('bill_number'),
      supabase.from('bill_summary').select('*').gte('bill_date', reportFrom).lte('bill_date', reportTo).order('bill_number'),
    ])
    setReportBusy(false)

    if (itemsRes.error) {
      setReportError(itemsRes.error.message)
      return
    }
    if (summaryRes.error) {
      setReportError(summaryRes.error.message)
      return
    }

    const csv =
      rowsToCsv(itemsRes.data, ITEM_REPORT_COLUMNS) +
      '\r\n\r\nBill Totals\r\n' +
      rowsToCsv(summaryRes.data, BILL_TOTALS_COLUMNS)
    downloadCsv(`bill-reconciliation-${reportFrom}-to-${reportTo}.csv`, csv)
  }

  return (
    <div className="page">
      <h1>Bill Reconciliation</h1>

      <h2>Create Bill</h2>
      <form className="inline-form" onSubmit={handleCreateBill}>
        <label>
          Bill Number
          <input value={billForm.bill_number} onChange={(e) => updateBillField('bill_number', e.target.value)} required />
        </label>
        <label>
          Bill Date
          <input type="date" value={billForm.bill_date} onChange={(e) => updateBillField('bill_date', e.target.value)} required />
        </label>
        <label>
          GST Rate
          <select value={billForm.gst_preset} onChange={(e) => updateBillField('gst_preset', e.target.value)}>
            {GST_PRESETS.map((p) => (
              <option key={p} value={p}>{p}%</option>
            ))}
            <option value="other">Other…</option>
          </select>
        </label>
        {billForm.gst_preset === 'other' && (
          <label>
            Custom GST %
            <input type="number" min="0" step="any" value={billForm.gst_custom} onChange={(e) => updateBillField('gst_custom', e.target.value)} required />
          </label>
        )}
        <label>
          Remarks
          <input value={billForm.remarks} onChange={(e) => updateBillField('remarks', e.target.value)} />
        </label>
        <button type="submit" disabled={submitting}>Create Bill</button>
      </form>

      {error && <p className="error">{error}</p>}

      <h2>{editingBillItemId ? 'Edit bill item' : 'Add item to a bill'}</h2>
      <form className="stack-form" onSubmit={handleSaveBillItem}>
        <label>
          Bill
          <select value={billItemForm.bill_id} onChange={(e) => updateBillItemField('bill_id', e.target.value)} required disabled={!!editingBillItemId}>
            <option value="" disabled>Select bill…</option>
            {bills.map((b) => (
              <option key={b.bill_id} value={b.bill_id}>{b.bill_number} ({b.bill_date})</option>
            ))}
          </select>
        </label>
        <label>
          PO Item
          <select value={billItemForm.po_item_id} onChange={(e) => selectPoItem(e.target.value)} required disabled={!!editingBillItemId}>
            <option value="" disabled>Select item…</option>
            {poItems.map((i) => (
              <option key={i.po_item_id} value={i.po_item_id}>
                {i.so_number} — {i.product_id} — {i.variety} (received {i.received_kg} kg, actual price {i.actual_price_per_kg}/kg){i.closed ? ' (closed)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          Qty (kg)
          <input type="number" min="0.01" step="any" value={billItemForm.qty_kg} onChange={(e) => updateBillItemField('qty_kg', e.target.value)} required />
        </label>
        <label>
          Mill Billed Amount
          <input type="number" min="0" step="any" value={billItemForm.mill_billed_amount} onChange={(e) => updateBillItemField('mill_billed_amount', e.target.value)} required />
        </label>
        <button type="submit" disabled={submitting}>
          {submitting ? 'Saving…' : editingBillItemId ? 'Save changes' : 'Add item'}
        </button>
        {editingBillItemId && <button type="button" onClick={cancelEditItem}>Cancel</button>}
      </form>

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
      <p className="hint">Date range is limited to 2 months. Filters by bill date.</p>

      <h2>Bill items</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Bill Number</th><th>Bill Date</th><th>SO Number</th><th>Company</th><th>Source</th><th>Ship To</th>
              <th>Product</th><th>NSR Rate</th><th>Actual Price/kg</th><th>Qty (kg)</th>
              <th>Mill Billed</th><th>Expected</th><th>Variance</th><th>GST Rate</th><th>GST Amount</th><th>Variance incl. GST</th><th></th>
            </tr>
          </thead>
          <tbody>
            {itemStatusRows.map((r) => (
              <tr key={r.bill_item_id}>
                <td>{r.bill_number}</td>
                <td>{r.bill_date}</td>
                <td>{r.so_number}</td>
                <td>{r.company}</td>
                <td>{r.source}</td>
                <td>{r.ship_to}</td>
                <td>{r.product_id} — {r.variety}</td>
                <td>{r.nsr_rate}</td>
                <td>{r.actual_price_per_kg}</td>
                <td>{r.qty_kg}</td>
                <td>{r.mill_billed_amount}</td>
                <td>{r.expected_amount}</td>
                <td className={r.variance !== 0 ? 'low-stock' : ''}>{r.variance}</td>
                <td>{r.gst_rate}</td>
                <td>{r.item_gst_amount}</td>
                <td className={r.variance_including_gst !== 0 ? 'low-stock' : ''}>{r.variance_including_gst}</td>
                <td><button type="button" onClick={() => startEditItem(r)}>Edit</button></td>
              </tr>
            ))}
            {itemStatusRows.length === 0 && (
              <tr><td colSpan={17}>No bill items yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <h2>Bill totals &amp; credit notes</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Bill Number</th><th>Bill Date</th><th>Total Variance</th><th>GST Rate</th><th>GST Amount</th><th>Net Claim</th>
              <th>Credit Note No.</th><th>Credit Note Amt</th><th>Credit Note Date</th><th></th><th>Settled</th>
            </tr>
          </thead>
          <tbody>
            {summaryRows.map((r) => {
              const draft = creditDrafts[r.bill_id] || {}
              const gstPreset = draft.gst_preset ?? presetForRate(r.gst_rate)
              return (
            <tr key={r.bill_id} className={r.settled ? 'archived-row' : ''}>
                <td>{r.bill_number}</td>
                <td>{r.bill_date}</td>
                <td>{r.total_variance}</td>
                <td>
                  <select value={gstPreset} onChange={(e) => updateCreditDraft(r.bill_id, 'gst_preset', e.target.value)}>
                    {GST_PRESETS.map((p) => (
                      <option key={p} value={p}>{p}%</option>
                    ))}
                    <option value="other">Other…</option>
                  </select>
                  {gstPreset === 'other' && (
                    <input
                      type="number" min="0" step="any"
                      value={draft.gst_custom ?? r.gst_rate}
                      onChange={(e) => updateCreditDraft(r.bill_id, 'gst_custom', e.target.value)}
                    />
                  )}
                </td>
                <td>{r.gst_amount}</td>
                <td>{r.net_claim}</td>
                <td><input value={creditDrafts[r.bill_id]?.credit_note_number ?? r.credit_note_number ?? ''} onChange={(e) => updateCreditDraft(r.bill_id, 'credit_note_number', e.target.value)} /></td>
                <td><input type="number" step="any" value={creditDrafts[r.bill_id]?.credit_note_amount ?? r.credit_note_amount ?? ''} onChange={(e) => updateCreditDraft(r.bill_id, 'credit_note_amount', e.target.value)} /></td>
                <td><input type="date" value={creditDrafts[r.bill_id]?.credit_note_date ?? r.credit_note_date ?? ''} onChange={(e) => updateCreditDraft(r.bill_id, 'credit_note_date', e.target.value)} /></td>
                <td><button type="button" onClick={() => saveCreditNote(r)}>Save</button></td>
                <td><button type="button" onClick={() => toggleSettled(r)}>{r.settled ? 'Reopen' : 'Settle'}</button></td>
              </tr>
              )
            })}
            {summaryRows.length === 0 && (
              <tr><td colSpan={11}>No bills yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
