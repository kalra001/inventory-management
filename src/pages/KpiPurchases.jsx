import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { rowsToCsv, downloadCsv, addMonths, todayStr, daysAgoStr, GST_PRESETS, presetForRate } from '../lib/csv'

const UNITS = ['Ream', 'PKT', 'Gross']
const CHARGE_TYPES = ['Freight', 'Loading Charges', 'Other']

const emptyInvoiceForm = {
  trader_id: '',
  invoice_number: '',
  invoice_date: todayStr(),
  vehicle_number: '',
  gst_preset: '18',
  gst_custom: '',
  remarks: '',
}
const emptyItemRow = { item_description: '', hsn_number: '', unit: 'Ream', quantity_units: '', quantity_kg: '', price_per_kg: '' }
const emptyChargeForm = { invoice_id: '', charge_type: 'Freight', custom_description: '', amount: '' }

function itemPayload(row) {
  return {
    item_description: row.item_description,
    hsn_number: row.hsn_number || null,
    unit: row.unit,
    quantity_units: Number(row.quantity_units),
    quantity_kg: Number(row.quantity_kg),
    price_per_kg: Number(row.price_per_kg),
  }
}

function previewAmount(row) {
  const kg = Number(row.quantity_kg)
  const rate = Number(row.price_per_kg)
  return kg && rate ? (kg * rate).toFixed(2) : ''
}

function chargeTypeForDescription(desc) {
  return CHARGE_TYPES.includes(desc) ? desc : 'Other'
}

// same shape as the on-screen combined table: item rows fill everything,
// charge rows and summary lines only fill Description + Amount
const COMBINED_COLUMNS = [
  { label: 'Item No', value: (r) => r.item_no ?? '' },
  { label: 'Description', value: (r) => r.description ?? '' },
  { label: 'HSN', value: (r) => r.hsn_number ?? '' },
  { label: 'Unit', value: (r) => r.unit ?? '' },
  { label: 'Qty (unit)', value: (r) => r.quantity_units ?? '' },
  { label: 'Qty (kg)', value: (r) => r.quantity_kg ?? '' },
  { label: 'Price/kg', value: (r) => r.price_per_kg ?? '' },
  { label: 'Amount', value: (r) => r.amount ?? '' },
]

function buildInvoiceSection(summary, items, charges) {
  const header = `Invoice: ${summary.invoice_number} | Date: ${summary.invoice_date} | Purchased From: ${summary.purchased_from}${summary.vehicle_number ? ' | Vehicle: ' + summary.vehicle_number : ''}`

  const lineItems = items.map((r) => ({
    item_no: r.item_no,
    description: r.item_description,
    hsn_number: r.hsn_number,
    unit: r.unit,
    quantity_units: r.quantity_units,
    quantity_kg: r.quantity_kg,
    price_per_kg: r.price_per_kg,
    amount: r.amount,
  }))
  const chargeRows = charges.map((r) => ({ description: r.description, amount: r.amount }))
  const summaryRows = [
    { description: 'Items Subtotal', amount: summary.items_subtotal },
    { description: 'Charges Total', amount: summary.charges_total },
    { description: 'Taxable Amount', amount: summary.taxable_amount },
    { description: 'GST Rate', amount: summary.gst_rate },
    { description: 'GST Amount', amount: summary.gst_amount },
    { description: 'Total Amount', amount: summary.total_amount },
  ]

  const body = rowsToCsv([...lineItems, ...chargeRows, ...summaryRows], COMBINED_COLUMNS)
  return header + '\r\n' + body
}

export default function KpiPurchases() {
  const { user } = useAuth()
  const [traders, setTraders] = useState([])
  const [invoices, setInvoices] = useState([])
  const [itemsStatus, setItemsStatus] = useState([])
  const [chargesStatus, setChargesStatus] = useState([])
  const [summaryRows, setSummaryRows] = useState([])

  const [invoiceForm, setInvoiceForm] = useState(emptyInvoiceForm)
  const [itemRows, setItemRows] = useState([{ ...emptyItemRow }])
  const [submitting, setSubmitting] = useState(false)

  const [addItemInvoiceId, setAddItemInvoiceId] = useState('')
  const [newItem, setNewItem] = useState({ ...emptyItemRow })
  const [editingItemId, setEditingItemId] = useState(null)
  const [itemBusy, setItemBusy] = useState(false)

  const [newCharge, setNewCharge] = useState({ ...emptyChargeForm })
  const [editingChargeId, setEditingChargeId] = useState(null)
  const [chargeBusy, setChargeBusy] = useState(false)

  const [gstDrafts, setGstDrafts] = useState({})
  const [error, setError] = useState(null)

  const [reportFrom, setReportFrom] = useState(todayStr())
  const [reportTo, setReportTo] = useState(todayStr())
  const [reportError, setReportError] = useState(null)
  const [reportBusy, setReportBusy] = useState(false)

  useEffect(() => {
    loadTraders()
    loadInvoices()
    loadItemsStatus()
    loadChargesStatus()
    loadSummary()
  }, [])

  async function loadTraders() {
    const { data } = await supabase.from('traders').select('trader_id, name, active').order('name')
    setTraders(data ?? [])
  }

  async function loadInvoices() {
    const { data } = await supabase
      .from('kpi_invoices')
      .select('invoice_id, invoice_number, invoice_date')
      .order('invoice_date', { ascending: false })
    setInvoices(data ?? [])
  }

  async function loadItemsStatus() {
    const { data, error } = await supabase
      .from('kpi_invoice_items')
      .select('*')
      .order('invoice_id', { ascending: true })
      .order('item_id', { ascending: true })
    if (error) setError(error.message)
    else setItemsStatus(data)
  }

  async function loadChargesStatus() {
    const { data, error } = await supabase
      .from('kpi_invoice_charges')
      .select('*')
      .order('invoice_id', { ascending: true })
    if (error) setError(error.message)
    else setChargesStatus(data)
  }

  async function loadSummary() {
    const cutoffStr = daysAgoStr(2)

    const { data, error } = await supabase
      .from('kpi_invoice_summary')
      .select('*')
      .gte('invoice_date', cutoffStr)
      .order('invoice_date', { ascending: false })
    if (error) setError(error.message)
    else setSummaryRows(data)
  }

  const invoiceBlocks = useMemo(() => {
    return summaryRows.map((summary) => {
      const items = itemsStatus
        .filter((i) => i.invoice_id === summary.invoice_id)
        .map((i, idx) => ({ ...i, item_no: idx + 1 }))
      const charges = chargesStatus.filter((c) => c.invoice_id === summary.invoice_id)
      return { summary, items, charges }
    })
  }, [summaryRows, itemsStatus, chargesStatus])

  function updateInvoiceField(field, value) {
    setInvoiceForm((f) => ({ ...f, [field]: value }))
  }

  function updateItemRow(index, field, value) {
    setItemRows((rows) => rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)))
  }

  function addItemRow() {
    setItemRows((rows) => [...rows, { ...emptyItemRow }])
  }

  function removeItemRow(index) {
    setItemRows((rows) => rows.filter((_, i) => i !== index))
  }

  async function handleCreateInvoice(e) {
    e.preventDefault()
    setError(null)

    const validItems = itemRows.filter((r) => r.item_description && r.quantity_kg && r.price_per_kg)
    if (!invoiceForm.trader_id || !invoiceForm.invoice_number.trim() || validItems.length === 0) {
      setError('Select Purchased From, enter an Invoice Number, and at least one item with description, qty (kg), and price.')
      return
    }
    const gstRate = invoiceForm.gst_preset === 'other' ? Number(invoiceForm.gst_custom) : Number(invoiceForm.gst_preset)
    if (invoiceForm.gst_preset === 'other' && !invoiceForm.gst_custom) {
      setError('Enter a custom GST rate.')
      return
    }

    setSubmitting(true)
    const { data: invoice, error: invoiceError } = await supabase
      .from('kpi_invoices')
      .insert({
        trader_id: invoiceForm.trader_id,
        invoice_number: invoiceForm.invoice_number.trim(),
        invoice_date: invoiceForm.invoice_date,
        vehicle_number: invoiceForm.vehicle_number || null,
        gst_rate: gstRate,
        remarks: invoiceForm.remarks || null,
        edited_by: user.id,
      })
      .select()
      .single()

    if (invoiceError) {
      setSubmitting(false)
      setError(invoiceError.message)
      return
    }

    const { error: itemsError } = await supabase.from('kpi_invoice_items').insert(
      validItems.map((r) => ({
        invoice_id: invoice.invoice_id,
        ...itemPayload(r),
        edited_by: user.id,
      }))
    )
    setSubmitting(false)

    if (itemsError) {
      setError(itemsError.message)
      return
    }

    setInvoiceForm(emptyInvoiceForm)
    setItemRows([{ ...emptyItemRow }])
    loadInvoices()
    loadItemsStatus()
    loadSummary()
  }

  function startEditItem(r) {
    setEditingItemId(r.item_id)
    setAddItemInvoiceId(String(r.invoice_id))
    setNewItem({
      item_description: r.item_description,
      hsn_number: r.hsn_number || '',
      unit: r.unit,
      quantity_units: String(r.quantity_units),
      quantity_kg: String(r.quantity_kg),
      price_per_kg: String(r.price_per_kg),
    })
  }

  function cancelEditItem() {
    setEditingItemId(null)
    setAddItemInvoiceId('')
    setNewItem({ ...emptyItemRow })
  }

  async function handleSaveItem(e) {
    e.preventDefault()
    setError(null)

    if (!addItemInvoiceId || !newItem.item_description || !newItem.quantity_kg || !newItem.price_per_kg) {
      setError('Pick an invoice, and enter description, qty (kg), and price.')
      return
    }

    setItemBusy(true)
    const payload = { invoice_id: addItemInvoiceId, ...itemPayload(newItem), edited_by: user.id }
    const { error } = editingItemId
      ? await supabase.from('kpi_invoice_items').update(payload).eq('item_id', editingItemId)
      : await supabase.from('kpi_invoice_items').insert(payload)
    setItemBusy(false)

    if (error) {
      setError(error.message)
      return
    }
    const wasEditing = editingItemId !== null
    setEditingItemId(null)
    if (wasEditing) setAddItemInvoiceId('')
    setNewItem({ ...emptyItemRow })
    loadItemsStatus()
    loadSummary()
  }

  async function deleteItem(itemId) {
    if (!window.confirm('Delete this item?')) return
    const { error } = await supabase.from('kpi_invoice_items').delete().eq('item_id', itemId)
    if (error) setError(error.message)
    else {
      loadItemsStatus()
      loadSummary()
    }
  }

  function startEditCharge(r) {
    setEditingChargeId(r.charge_id)
    const chargeType = chargeTypeForDescription(r.description)
    setNewCharge({
      invoice_id: String(r.invoice_id),
      charge_type: chargeType,
      custom_description: chargeType === 'Other' ? r.description : '',
      amount: String(r.amount),
    })
  }

  function cancelEditCharge() {
    setEditingChargeId(null)
    setNewCharge({ ...emptyChargeForm })
  }

  async function handleSaveCharge(e) {
    e.preventDefault()
    setError(null)

    const description = newCharge.charge_type === 'Other' ? newCharge.custom_description.trim() : newCharge.charge_type

    if (!newCharge.invoice_id || !description || !newCharge.amount) {
      setError('Pick an invoice, a charge type (with description if Other), and an amount.')
      return
    }

    setChargeBusy(true)
    const payload = {
      invoice_id: newCharge.invoice_id,
      description,
      amount: Number(newCharge.amount),
      edited_by: user.id,
    }
    const { error } = editingChargeId
      ? await supabase.from('kpi_invoice_charges').update(payload).eq('charge_id', editingChargeId)
      : await supabase.from('kpi_invoice_charges').insert(payload)
    setChargeBusy(false)

    if (error) {
      setError(error.message)
      return
    }
    setEditingChargeId(null)
    setNewCharge({ ...emptyChargeForm })
    loadChargesStatus()
    loadSummary()
  }

  async function deleteCharge(chargeId) {
    if (!window.confirm('Delete this charge?')) return
    const { error } = await supabase.from('kpi_invoice_charges').delete().eq('charge_id', chargeId)
    if (error) setError(error.message)
    else {
      loadChargesStatus()
      loadSummary()
    }
  }

  function updateGstDraft(invoiceId, field, value) {
    setGstDrafts((d) => ({ ...d, [invoiceId]: { ...d[invoiceId], [field]: value } }))
  }

  async function saveGstRate(row) {
    const draft = gstDrafts[row.invoice_id] || {}
    const gstPreset = draft.gst_preset ?? presetForRate(row.gst_rate)
    const gstCustom = draft.gst_custom ?? row.gst_rate
    const gstRate = gstPreset === 'other' ? Number(gstCustom) : Number(gstPreset)

    const { error } = await supabase.from('kpi_invoices').update({ gst_rate: gstRate }).eq('invoice_id', row.invoice_id)
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
    const summaryRes = await supabase
      .from('kpi_invoice_summary')
      .select('*')
      .gte('invoice_date', reportFrom)
      .lte('invoice_date', reportTo)
      .order('invoice_date', { ascending: true })

    if (summaryRes.error) {
      setReportBusy(false)
      setReportError(summaryRes.error.message)
      return
    }

    const invoiceIds = summaryRes.data.map((s) => s.invoice_id)
    if (invoiceIds.length === 0) {
      setReportBusy(false)
      setReportError('No invoices in that date range.')
      return
    }

    const [itemsRes, chargesRes] = await Promise.all([
      supabase.from('kpi_invoice_items').select('*').in('invoice_id', invoiceIds).order('invoice_id').order('item_id'),
      supabase.from('kpi_invoice_charges').select('*').in('invoice_id', invoiceIds).order('invoice_id'),
    ])
    setReportBusy(false)

    if (itemsRes.error) { setReportError(itemsRes.error.message); return }
    if (chargesRes.error) { setReportError(chargesRes.error.message); return }

    const sections = summaryRes.data.map((summary) => {
      const items = itemsRes.data
        .filter((i) => i.invoice_id === summary.invoice_id)
        .map((i, idx) => ({ ...i, item_no: idx + 1 }))
      const charges = chargesRes.data.filter((c) => c.invoice_id === summary.invoice_id)
      return buildInvoiceSection(summary, items, charges)
    })

    downloadCsv(`kpi-purchases-${reportFrom}-to-${reportTo}.csv`, sections.join('\r\n\r\n'))
  }

  return (
    <div className="page">
      <h1>KPI Purchases</h1>
      <p className="hint">Goods purchased from traders — kept separate from the mill/SO purchase flow and stock tracking.</p>

      <h2>Create Invoice</h2>
      <form className="stack-form" onSubmit={handleCreateInvoice}>
        <label>
          Purchased From
          <select value={invoiceForm.trader_id} onChange={(e) => updateInvoiceField('trader_id', e.target.value)} required>
            <option value="" disabled>Select trader…</option>
            {traders.map((t) => (
              <option key={t.trader_id} value={t.trader_id}>{t.name}{t.active ? '' : ' (archived)'}</option>
            ))}
          </select>
        </label>
        <label>
          Invoice Number
          <input value={invoiceForm.invoice_number} onChange={(e) => updateInvoiceField('invoice_number', e.target.value)} required />
        </label>
        <label>
          Invoice Date
          <input type="date" value={invoiceForm.invoice_date} onChange={(e) => updateInvoiceField('invoice_date', e.target.value)} required />
        </label>
        <label>
          Vehicle Number
          <input value={invoiceForm.vehicle_number} onChange={(e) => updateInvoiceField('vehicle_number', e.target.value)} />
        </label>
        <label>
          GST Rate
          <select value={invoiceForm.gst_preset} onChange={(e) => updateInvoiceField('gst_preset', e.target.value)}>
            {GST_PRESETS.map((p) => (
              <option key={p} value={p}>{p}%</option>
            ))}
            <option value="other">Other…</option>
          </select>
        </label>
        {invoiceForm.gst_preset === 'other' && (
          <label>
            Custom GST %
            <input type="number" min="0" step="any" value={invoiceForm.gst_custom} onChange={(e) => updateInvoiceField('gst_custom', e.target.value)} required />
          </label>
        )}
        <label>
          Remarks
          <input value={invoiceForm.remarks} onChange={(e) => updateInvoiceField('remarks', e.target.value)} />
        </label>
      </form>

      <h2>Items on this invoice</h2>
      {itemRows.map((row, i) => (
        <div className="item-card" key={i}>
          <span className="hint">Item {i + 1}</span>
          <label>
            Description
            <input value={row.item_description} onChange={(e) => updateItemRow(i, 'item_description', e.target.value)} />
          </label>
          <label>
            HSN Number
            <input value={row.hsn_number} onChange={(e) => updateItemRow(i, 'hsn_number', e.target.value)} />
          </label>
          <label>
            Unit
            <select value={row.unit} onChange={(e) => updateItemRow(i, 'unit', e.target.value)}>
              {UNITS.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </label>
          <label>
            Qty ({row.unit})
            <input type="number" min="0.01" step="any" value={row.quantity_units} onChange={(e) => updateItemRow(i, 'quantity_units', e.target.value)} />
          </label>
          <label>
            Qty (kg)
            <input type="number" min="0.01" step="any" value={row.quantity_kg} onChange={(e) => updateItemRow(i, 'quantity_kg', e.target.value)} />
          </label>
          <label>
            Price/kg
            <input type="number" min="0" step="any" value={row.price_per_kg} onChange={(e) => updateItemRow(i, 'price_per_kg', e.target.value)} />
          </label>
          <span className="hint">Amount: {previewAmount(row)}</span>
          {itemRows.length > 1 && (
            <button type="button" className="item-card-remove" onClick={() => removeItemRow(i)}>Remove</button>
          )}
        </div>
      ))}
      <button type="button" onClick={addItemRow}>Add item</button>{' '}
      <button type="button" onClick={handleCreateInvoice} disabled={submitting}>{submitting ? 'Saving…' : 'Create Invoice'}</button>

      {error && <p className="error">{error}</p>}

      <h2>{editingItemId ? 'Edit item' : 'Add item to an existing invoice'}</h2>
      <form className="stack-form" onSubmit={handleSaveItem}>
        <label>
          Invoice
          <select value={addItemInvoiceId} onChange={(e) => setAddItemInvoiceId(e.target.value)} required disabled={!!editingItemId}>
            <option value="" disabled>Select invoice…</option>
            {invoices.map((inv) => (
              <option key={inv.invoice_id} value={inv.invoice_id}>{inv.invoice_number} ({inv.invoice_date})</option>
            ))}
          </select>
        </label>
        <label>
          Description
          <input value={newItem.item_description} onChange={(e) => setNewItem((r) => ({ ...r, item_description: e.target.value }))} required />
        </label>
        <label>
          HSN Number
          <input value={newItem.hsn_number} onChange={(e) => setNewItem((r) => ({ ...r, hsn_number: e.target.value }))} />
        </label>
        <label>
          Unit
          <select value={newItem.unit} onChange={(e) => setNewItem((r) => ({ ...r, unit: e.target.value }))}>
            {UNITS.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </label>
        <label>
          Qty ({newItem.unit})
          <input type="number" min="0.01" step="any" value={newItem.quantity_units} onChange={(e) => setNewItem((r) => ({ ...r, quantity_units: e.target.value }))} required />
        </label>
        <label>
          Qty (kg)
          <input type="number" min="0.01" step="any" value={newItem.quantity_kg} onChange={(e) => setNewItem((r) => ({ ...r, quantity_kg: e.target.value }))} required />
        </label>
        <label>
          Price/kg
          <input type="number" min="0" step="any" value={newItem.price_per_kg} onChange={(e) => setNewItem((r) => ({ ...r, price_per_kg: e.target.value }))} required />
        </label>
        <span className="hint">Amount: {previewAmount(newItem)}</span>
        <button type="submit" disabled={itemBusy}>{itemBusy ? 'Saving…' : editingItemId ? 'Save changes' : 'Add item'}</button>
        {editingItemId && <button type="button" onClick={cancelEditItem}>Cancel</button>}
      </form>

      <h2>{editingChargeId ? 'Edit charge' : 'Add charge to an invoice'}</h2>
      <form className="inline-form" onSubmit={handleSaveCharge}>
        <label>
          Invoice
          <select value={newCharge.invoice_id} onChange={(e) => setNewCharge((r) => ({ ...r, invoice_id: e.target.value }))} required disabled={!!editingChargeId}>
            <option value="" disabled>Select invoice…</option>
            {invoices.map((inv) => (
              <option key={inv.invoice_id} value={inv.invoice_id}>{inv.invoice_number} ({inv.invoice_date})</option>
            ))}
          </select>
        </label>
        <label>
          Charge Type
          <select value={newCharge.charge_type} onChange={(e) => setNewCharge((r) => ({ ...r, charge_type: e.target.value }))}>
            {CHARGE_TYPES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        {newCharge.charge_type === 'Other' && (
          <label>
            Description
            <input value={newCharge.custom_description} onChange={(e) => setNewCharge((r) => ({ ...r, custom_description: e.target.value }))} required />
          </label>
        )}
        <label>
          Amount
          <input type="number" step="any" value={newCharge.amount} onChange={(e) => setNewCharge((r) => ({ ...r, amount: e.target.value }))} required />
        </label>
        <button type="submit" disabled={chargeBusy}>{chargeBusy ? 'Saving…' : editingChargeId ? 'Save changes' : 'Add charge'}</button>
        {editingChargeId && <button type="button" onClick={cancelEditCharge}>Cancel</button>}
      </form>

      <div className="page-header">
        <h2>Download report</h2>
      </div>
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
      <p className="hint">Date range is limited to 2 months. Filters by invoice date.</p>

      <h2>Invoices (last 2 days)</h2>
      <p className="hint">Older invoices aren't shown here — use Download report above to get them.</p>
      {invoiceBlocks.map(({ summary, items, charges }) => {
        const draft = gstDrafts[summary.invoice_id] || {}
        const gstPreset = draft.gst_preset ?? presetForRate(summary.gst_rate)
        return (
          <div className="invoice-block" key={summary.invoice_id}>
            <h3>
              {summary.invoice_number} — {summary.invoice_date} — {summary.purchased_from}
              {summary.vehicle_number ? ` — Vehicle: ${summary.vehicle_number}` : ''}
            </h3>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Item No</th><th>Description</th><th>HSN</th><th>Unit</th>
                    <th>Qty (unit)</th><th>Qty (kg)</th><th>Price/kg</th><th>Amount</th><th></th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((r) => (
                    <tr key={`item-${r.item_id}`}>
                      <td>{r.item_no}</td>
                      <td>{r.item_description}</td>
                      <td>{r.hsn_number}</td>
                      <td>{r.unit}</td>
                      <td>{r.quantity_units}</td>
                      <td>{r.quantity_kg}</td>
                      <td>{r.price_per_kg}</td>
                      <td>{r.amount}</td>
                      <td><button type="button" onClick={() => startEditItem(r)}>Edit</button></td>
                      <td><button type="button" onClick={() => deleteItem(r.item_id)}>Delete</button></td>
                    </tr>
                  ))}
                  {charges.map((r) => (
                    <tr key={`charge-${r.charge_id}`}>
                      <td></td>
                      <td>{r.description}</td>
                      <td></td>
                      <td></td>
                      <td></td>
                      <td></td>
                      <td></td>
                      <td>{r.amount}</td>
                      <td><button type="button" onClick={() => startEditCharge(r)}>Edit</button></td>
                      <td><button type="button" onClick={() => deleteCharge(r.charge_id)}>Delete</button></td>
                    </tr>
                  ))}
                  {items.length === 0 && charges.length === 0 && (
                    <tr><td colSpan={10}>No items or charges on this invoice yet.</td></tr>
                  )}

                  <tr>
                    <td colSpan={7}>Items Subtotal</td>
                    <td colSpan={3}>{summary.items_subtotal}</td>
                  </tr>
                  <tr>
                    <td colSpan={7}>Charges Total</td>
                    <td colSpan={3}>{summary.charges_total}</td>
                  </tr>
                  <tr>
                    <td colSpan={7}>Taxable Amount</td>
                    <td colSpan={3}>{summary.taxable_amount}</td>
                  </tr>
                  <tr>
                    <td colSpan={7}>GST Rate</td>
                    <td colSpan={3}>
                      <select value={gstPreset} onChange={(e) => updateGstDraft(summary.invoice_id, 'gst_preset', e.target.value)}>
                        {GST_PRESETS.map((p) => (
                          <option key={p} value={p}>{p}%</option>
                        ))}
                        <option value="other">Other…</option>
                      </select>
                      {gstPreset === 'other' && (
                        <input
                          type="number" min="0" step="any"
                          value={draft.gst_custom ?? summary.gst_rate}
                          onChange={(e) => updateGstDraft(summary.invoice_id, 'gst_custom', e.target.value)}
                        />
                      )}{' '}
                      <button type="button" onClick={() => saveGstRate(summary)}>Save</button>
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={7}>GST Amount</td>
                    <td colSpan={3}>{summary.gst_amount}</td>
                  </tr>
                  <tr className="total-row">
                    <td colSpan={7}>Total Amount</td>
                    <td colSpan={3}>{summary.total_amount}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )
      })}
      {invoiceBlocks.length === 0 && <p>No invoices in the last 2 days.</p>}
    </div>
  )
}
