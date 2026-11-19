import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { rowsToCsv, downloadCsv, addMonths, todayStr, GST_PRESETS, presetForRate } from '../lib/csv'
import SearchableSelect from '../components/SearchableSelect'

const emptyBillForm = { bill_number: '', bill_date: todayStr(), remarks: '', gst_preset: '18', gst_custom: '' }
const emptyBillItemForm = { bill_id: '', po_item_id: '', qty_kg: '', mill_billed_amount: '' }

const ITEM_REPORT_COLUMNS = [
  { label: 'Bill Number', value: (r) => r.bill_number },
  { label: 'Bill Date', value: (r) => r.bill_date },
  { label: 'PO Number', value: (r) => r.po_number },
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
  { label: 'Credit Note Amt', value: (r) => r.credit_note_amount },
  { label: 'Credit Note Balance', value: (r) => creditBalance(r) },
  { label: 'Credit Note No.', value: (r) => r.credit_note_number },
  { label: 'Credit Note Date', value: (r) => r.credit_note_date },
]

// Net Claim minus the credit note amount received so far (0 received if blank).
function creditBalance(r) {
  return Math.round(((Number(r.net_claim) || 0) - (Number(r.credit_note_amount) || 0)) * 100) / 100
}

// Same, but uses the amount currently typed in the box (before Save), so it updates as you type.
function liveBalance(r, draft) {
  const amt = draft && draft.credit_note_amount !== undefined ? draft.credit_note_amount : r.credit_note_amount
  return creditBalance({ net_claim: r.net_claim, credit_note_amount: amt })
}

const BILL_TOTALS_EXPORT_COLUMNS = [
  { label: 'Bill Number', value: (r) => r.bill_number },
  { label: 'Bill Date', value: (r) => r.bill_date },
  { label: 'Total Variance', value: (r) => r.total_variance },
  { label: 'GST Rate', value: (r) => r.gst_rate },
  { label: 'GST Amount', value: (r) => r.gst_amount },
  { label: 'Net Claim', value: (r) => r.net_claim },
  { label: 'Credit Note Amt', value: (r) => r.credit_note_amount },
  { label: 'Credit Note Balance', value: (r) => creditBalance(r) },
  { label: 'Credit Note No.', value: (r) => r.credit_note_number },
  { label: 'Credit Note Date', value: (r) => r.credit_note_date },
  { label: 'Status', value: (r) => (r.settled ? 'Settled' : 'Unsettled') },
]

export default function Bills() {
  const { user, isAdmin } = useAuth()
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
  const [viewFrom, setViewFrom] = useState('')
  const [viewTo, setViewTo] = useState('')
  const [totalsFrom, setTotalsFrom] = useState('')
  const [totalsTo, setTotalsTo] = useState('')
  const [totalsBusy, setTotalsBusy] = useState(false)
  const [totalsError, setTotalsError] = useState(null)

  const billOptions = useMemo(
    () => bills.map((b) => ({ value: b.bill_id, label: `${b.bill_number} (${b.bill_date})` })),
    [bills]
  )

  const filteredItemRows = useMemo(() => {
    if (!viewFrom && !viewTo) return itemStatusRows
    return itemStatusRows.filter((r) => (!viewFrom || r.bill_date >= viewFrom) && (!viewTo || r.bill_date <= viewTo))
  }, [itemStatusRows, viewFrom, viewTo])

  const filteredSummaryRows = useMemo(() => {
    if (!viewFrom && !viewTo) return summaryRows
    return summaryRows.filter((r) => (!viewFrom || r.bill_date >= viewFrom) && (!viewTo || r.bill_date <= viewTo))
  }, [summaryRows, viewFrom, viewTo])

  const poItemOptions = useMemo(
    () => poItems.map((i) => ({
      value: i.po_item_id,
      label: `${i.so_number} (${i.po_number}) — ${i.product_id} — ${i.variety} (received ${i.received_kg} kg, actual price ${i.actual_price_per_kg}/kg)${i.closed ? ' (closed)' : ''}`,
    })),
    [poItems]
  )

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
    // only items on POs whose SO number has arrived — this page works by SO number only
    const { data } = await supabase
      .from('po_item_status')
      .select('po_item_id, po_number, so_number, product_id, variety, nsr_rate, actual_price_per_kg, received_kg, closed')
      .not('so_number', 'is', null)
      .order('so_number')
    setPoItems(data ?? [])
  }

  async function loadItemStatus() {
    const { data, error } = await supabase
      .from('bill_item_status')
      .select('*')
      .order('bill_date', { ascending: false })
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

  async function deleteBillItem(billItemId) {
    if (!window.confirm('Permanently delete this bill item? This cannot be undone.')) return
    setError(null)
    const { error } = await supabase.from('bill_items').delete().eq('bill_item_id', billItemId)
    if (error) {
      setError(error.message)
      return
    }
    loadItemStatus()
    loadSummary()
  }

  async function deleteBill(billId, billNumber) {
    if (!window.confirm(`Permanently delete bill ${billNumber}? This cannot be undone.`)) return
    setError(null)
    const { error } = await supabase.from('bills').delete().eq('bill_id', billId)
    if (error) {
      setError(
        error.code === '23503'
          ? `Cannot delete bill ${billNumber} — it still has items. Delete its items from the Bill items table first, then delete the bill.`
          : error.message
      )
      return
    }
    loadBills()
    loadSummary()
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

  async function downloadBillTotals(e) {
    e.preventDefault()
    setTotalsError(null)
    if (totalsFrom && totalsTo && totalsFrom > totalsTo) {
      setTotalsError('"From" date must be on or before "To" date.')
      return
    }
    setTotalsBusy(true)
    let q = supabase.from('bill_summary').select('*')
    if (totalsFrom) q = q.gte('bill_date', totalsFrom)
    if (totalsTo) q = q.lte('bill_date', totalsTo)
    const { data, error } = await q.order('bill_date', { ascending: true }).order('bill_number', { ascending: true })
    setTotalsBusy(false)
    if (error) { setTotalsError(error.message); return }
    if (!data || data.length === 0) { setTotalsError('No bills in that date range.'); return }
    const name = `bill-totals-${totalsFrom || 'start'}-to-${totalsTo || 'latest'}.csv`
    downloadCsv(name, rowsToCsv(data, BILL_TOTALS_EXPORT_COLUMNS))
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
          <SearchableSelect
            options={billOptions}
            value={billItemForm.bill_id}
            onChange={(v) => updateBillItemField('bill_id', v)}
            placeholder="Type to search…"
            required
            disabled={!!editingBillItemId}
          />
        </label>
        <label>
          PO Item
          <SearchableSelect
            options={poItemOptions}
            value={billItemForm.po_item_id}
            onChange={selectPoItem}
            placeholder="Type to search…"
            required
            disabled={!!editingBillItemId}
          />
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

      <div className="page-header">
        <h2>Bill items</h2>
      </div>
      <form className="inline-form" onSubmit={(e) => e.preventDefault()}>
        <label>
          From
          <input type="date" value={viewFrom} max={viewTo || undefined} onChange={(e) => setViewFrom(e.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={viewTo} min={viewFrom || undefined} onChange={(e) => setViewTo(e.target.value)} />
        </label>
        {(viewFrom || viewTo) && (
          <button type="button" onClick={() => { setViewFrom(''); setViewTo('') }}>Clear</button>
        )}
      </form>
      <p className="hint">Filters Bill items and Bill totals below by bill date — e.g. set both to cover a full month. Leave blank to show everything.</p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Bill Number</th><th>Bill Date</th><th>PO Number</th><th>SO Number</th><th>Company</th><th>Source</th><th>Ship To</th>
              <th>Product</th><th>NSR Rate</th><th>Actual Price/kg</th><th>Qty (kg)</th>
              <th>Mill Billed</th><th>Expected</th><th>Variance</th><th>GST Rate</th><th>GST Amount</th><th>Variance incl. GST</th><th></th><th></th>
            </tr>
          </thead>
          <tbody>
            {filteredItemRows.map((r) => (
              <tr key={r.bill_item_id}>
                <td>{r.bill_number}</td>
                <td>{r.bill_date}</td>
                <td>{r.po_number}</td>
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
                <td>{isAdmin && <button type="button" onClick={() => deleteBillItem(r.bill_item_id)}>Delete</button>}</td>
              </tr>
            ))}
            {filteredItemRows.length === 0 && (
              <tr><td colSpan={19}>{viewFrom || viewTo ? 'No bill items in that date range.' : 'No bill items yet.'}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <h2>Bill totals &amp; credit notes</h2>
      <form className="inline-form" onSubmit={downloadBillTotals}>
        <label>
          Download from
          <input type="date" value={totalsFrom} onChange={(e) => setTotalsFrom(e.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={totalsTo} onChange={(e) => setTotalsTo(e.target.value)} />
        </label>
        <button type="submit" disabled={totalsBusy}>{totalsBusy ? 'Preparing…' : 'Download Excel'}</button>
      </form>
      <p className="hint">Downloads these bill totals (settled and unsettled), sorted by bill date. Leave dates blank to download everything.</p>
      {totalsError && <p className="error">{totalsError}</p>}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Bill Number</th><th>Bill Date</th><th>Total Variance</th><th>GST Rate</th><th>GST Amount</th><th>Net Claim</th>
              <th>Credit Note Amt</th><th>Credit Note Balance</th><th>Credit Note No.</th><th>Credit Note Date</th><th></th><th>Settled</th><th></th>
            </tr>
          </thead>
          <tbody>
            {filteredSummaryRows.map((r) => {
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
                <td><input type="number" step="any" value={creditDrafts[r.bill_id]?.credit_note_amount ?? r.credit_note_amount ?? ''} onChange={(e) => updateCreditDraft(r.bill_id, 'credit_note_amount', e.target.value)} /></td>
                <td className={liveBalance(r, draft) !== 0 ? 'low-stock' : ''}>{liveBalance(r, draft)}</td>
                <td><input value={creditDrafts[r.bill_id]?.credit_note_number ?? r.credit_note_number ?? ''} onChange={(e) => updateCreditDraft(r.bill_id, 'credit_note_number', e.target.value)} /></td>
                <td><input type="date" value={creditDrafts[r.bill_id]?.credit_note_date ?? r.credit_note_date ?? ''} onChange={(e) => updateCreditDraft(r.bill_id, 'credit_note_date', e.target.value)} /></td>
                <td><button type="button" onClick={() => saveCreditNote(r)}>Save</button></td>
                <td><button type="button" onClick={() => toggleSettled(r)}>{r.settled ? 'Reopen' : 'Settle'}</button></td>
                <td>{isAdmin && <button type="button" onClick={() => deleteBill(r.bill_id, r.bill_number)}>Delete</button>}</td>
              </tr>
              )
            })}
            {filteredSummaryRows.length === 0 && (
              <tr><td colSpan={13}>{viewFrom || viewTo ? 'No bills in that date range.' : 'No bills yet.'}</td></tr>
            )}
          </tbody>
        </table>
      </div>    </div>
  )
}
