import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { rowsToCsv, downloadCsv, todayStr } from '../lib/csv'
import SearchableSelect from '../components/SearchableSelect'

const COMPANIES = ['Kalra Paper Impex', 'Reliable Papers']
const SOURCES = ['JK Paper CPM', 'JK Paper QSC']

const STATUS_COLUMNS = [
  { label: 'SO Number', value: (r) => r.so_number },
  { label: 'Company', value: (r) => r.company },
  { label: 'Source', value: (r) => r.source },
  { label: 'Ship To', value: (r) => r.ship_to },
  { label: 'Order Placed', value: (r) => r.order_placed_date },
  { label: 'SO Date', value: (r) => r.so_date },
  { label: 'Product ID', value: (r) => r.product_id },
  { label: 'Variety', value: (r) => r.variety },
  { label: 'GSM', value: (r) => r.gsm },
  { label: 'Size (cm)', value: (r) => r.size_cm },
  { label: 'Size (in)', value: (r) => r.size_in },
  { label: 'NSR Rate', value: (r) => r.nsr_rate },
  { label: 'Actual Price/kg', value: (r) => r.actual_price_per_kg },
  { label: 'Ordered (kg)', value: (r) => r.ordered_qty_kg },
  { label: 'Received (kg)', value: (r) => r.received_kg },
  { label: 'Balance (kg)', value: (r) => r.balance_kg },
  { label: 'Addl Disc Ack No.', value: (r) => r.additional_discount_ack_number },
  { label: 'Addl Disc Ack Date', value: (r) => r.additional_discount_ack_date },
  { label: 'Closed', value: (r) => (r.closed ? 'Yes' : 'No') },
]

const emptyPoForm = { so_number: '', order_placed_date: todayStr(), so_date: '', company: '', source: '', ship_to: '', remarks: '' }
const emptyItemRow = {
  product_id: '',
  ordered_qty_kg: '',
  nsr_rate: '',
  cash_discount_pct: '2',
  customer_discount_per_kg: '0',
  additional_discount_per_kg: '0',
  additional_discount_ack_number: '',
  additional_discount_ack_date: '',
  freight_per_kg: '0',
  insurance_per_kg: '0.070',
  qsc_incidental_per_kg: '0',
  qsc_freight_discount_per_kg: '0',
}

function itemPayload(row) {
  return {
    product_id: row.product_id,
    ordered_qty_kg: Number(row.ordered_qty_kg),
    nsr_rate: row.nsr_rate ? Number(row.nsr_rate) : null,
    cash_discount_pct: Number(row.cash_discount_pct || 0),
    customer_discount_per_kg: Number(row.customer_discount_per_kg || 0),
    additional_discount_per_kg: Number(row.additional_discount_per_kg || 0),
    additional_discount_ack_number: row.additional_discount_ack_number || null,
    additional_discount_ack_date: row.additional_discount_ack_date || null,
    freight_per_kg: Number(row.freight_per_kg || 0),
    insurance_per_kg: Number(row.insurance_per_kg || 0),
    qsc_incidental_per_kg: Number(row.qsc_incidental_per_kg || 0),
    qsc_freight_discount_per_kg: Number(row.qsc_freight_discount_per_kg || 0),
  }
}

export default function PurchaseOrders() {
  const { user } = useAuth()
  const [products, setProducts] = useState([])
  const [pos, setPos] = useState([])
  const [statusRows, setStatusRows] = useState([])
  const [showClosed, setShowClosed] = useState(false)
  const [poForm, setPoForm] = useState(emptyPoForm)
  const [itemRows, setItemRows] = useState([{ ...emptyItemRow }])
  const [addItemPoId, setAddItemPoId] = useState('')
  const [newItem, setNewItem] = useState({ ...emptyItemRow })
  const [addItemBusy, setAddItemBusy] = useState(false)
  const [editingPoItemId, setEditingPoItemId] = useState(null)
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const productOptions = useMemo(
    () => products.map((p) => ({
      value: p.product_id,
      label: `${p.product_id} — ${p.variety}${p.active ? '' : ' (archived)'}`,
    })),
    [products]
  )

  useEffect(() => {
    loadProducts()
    loadPos()
    loadStatus()
  }, [])

  async function loadProducts() {
    const { data } = await supabase.from('products').select('product_id, variety, active').order('variety')
    setProducts(data ?? [])
  }

  async function loadPos() {
    const { data } = await supabase.from('purchase_orders').select('po_id, so_number, source').order('so_number')
    setPos(data ?? [])
  }

  async function loadStatus() {
    const { data, error } = await supabase
      .from('po_item_status')
      .select('*')
      .order('so_number', { ascending: true })
      .order('product_id', { ascending: true })
    if (error) setError(error.message)
    else setStatusRows(data)
  }

  function updatePoField(field, value) {
    setPoForm((f) => ({ ...f, [field]: value }))
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

  async function handleCreatePO(e) {
    e.preventDefault()
    setError(null)

    const validItems = itemRows.filter((r) => r.product_id && r.ordered_qty_kg)
    if (!poForm.so_number.trim() || validItems.length === 0) {
      setError('Enter an SO number and at least one item with a product and ordered quantity.')
      return
    }

    setSubmitting(true)
    const { data: po, error: poError } = await supabase
      .from('purchase_orders')
      .insert({
        so_number: poForm.so_number.trim(),
        order_placed_date: poForm.order_placed_date,
        so_date: poForm.so_date || null,
        company: poForm.company || null,
        source: poForm.source || null,
        ship_to: poForm.ship_to || null,
        remarks: poForm.remarks || null,
        edited_by: user.id,
      })
      .select()
      .single()

    if (poError) {
      setSubmitting(false)
      setError(poError.message)
      return
    }

    const { error: itemsError } = await supabase.from('purchase_order_items').insert(
      validItems.map((r) => ({
        po_id: po.po_id,
        ...itemPayload(r),
        edited_by: user.id,
      }))
    )
    setSubmitting(false)

    if (itemsError) {
      setError(itemsError.message)
      return
    }

    setPoForm(emptyPoForm)
    setItemRows([{ ...emptyItemRow }])
    loadPos()
    loadStatus()
  }

  function startEditItem(r) {
    setEditingPoItemId(r.po_item_id)
    setAddItemPoId(String(r.po_id))
    setNewItem({
      product_id: r.product_id,
      ordered_qty_kg: String(r.ordered_qty_kg),
      nsr_rate: r.nsr_rate != null ? String(r.nsr_rate) : '',
      cash_discount_pct: String(r.cash_discount_pct),
      customer_discount_per_kg: String(r.customer_discount_per_kg),
      additional_discount_per_kg: String(r.additional_discount_per_kg),
      additional_discount_ack_number: r.additional_discount_ack_number || '',
      additional_discount_ack_date: r.additional_discount_ack_date || '',
      freight_per_kg: String(r.freight_per_kg),
      insurance_per_kg: String(r.insurance_per_kg),
      qsc_incidental_per_kg: String(r.qsc_incidental_per_kg),
      qsc_freight_discount_per_kg: String(r.qsc_freight_discount_per_kg),
    })
  }

  function cancelEditItem() {
    setEditingPoItemId(null)
    setAddItemPoId('')
    setNewItem({ ...emptyItemRow })
  }

  async function handleAddItem(e) {
    e.preventDefault()
    setError(null)

    if (!addItemPoId || !newItem.product_id || !newItem.ordered_qty_kg) {
      setError('Pick an SO number, product, and ordered quantity.')
      return
    }

    setAddItemBusy(true)
    const payload = {
      po_id: addItemPoId,
      ...itemPayload(newItem),
      edited_by: user.id,
    }
    const { error } = editingPoItemId
      ? await supabase.from('purchase_order_items').update(payload).eq('po_item_id', editingPoItemId)
      : await supabase.from('purchase_order_items').insert(payload)
    setAddItemBusy(false)

    if (error) {
      setError(error.message)
      return
    }
    const wasEditing = editingPoItemId !== null
    setEditingPoItemId(null)
    if (wasEditing) setAddItemPoId('')
    setNewItem({ ...emptyItemRow })
    loadStatus()
  }

  async function closeItem(poItemId) {
    if (!window.confirm('Close this item? It will stop showing as pending regardless of remaining balance.')) return
    const { error } = await supabase
      .from('purchase_order_items')
      .update({ closed: true, closed_date: todayStr(), closed_by: user.id })
      .eq('po_item_id', poItemId)
    if (error) setError(error.message)
    else loadStatus()
  }

  const visibleRows = statusRows.filter((r) => showClosed || !r.closed)
  const addItemSource = pos.find((p) => String(p.po_id) === String(addItemPoId))?.source
  const isQscCreate = poForm.source === 'JK Paper QSC'
  const isQscAddItem = addItemSource === 'JK Paper QSC'

  function handleDownloadStatus() {
    const csv = rowsToCsv(visibleRows, STATUS_COLUMNS)
    downloadCsv(`purchase-order-status-${todayStr()}.csv`, csv)
  }

  return (
    <div className="page">
      <h1>Purchase Orders</h1>

      <form className="stack-form" onSubmit={handleCreatePO}>
        <label>
          SO Number
          <input value={poForm.so_number} onChange={(e) => updatePoField('so_number', e.target.value)} required />
        </label>
        <label>
          Order Placed Date
          <input type="date" value={poForm.order_placed_date} onChange={(e) => updatePoField('order_placed_date', e.target.value)} required />
        </label>
        <label>
          SO Date
          <input type="date" value={poForm.so_date} onChange={(e) => updatePoField('so_date', e.target.value)} />
        </label>
        <label>
          Bill To (Company)
          <select value={poForm.company} onChange={(e) => updatePoField('company', e.target.value)} required>
            <option value="" disabled>Select company…</option>
            {COMPANIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          Source
          <select value={poForm.source} onChange={(e) => updatePoField('source', e.target.value)} required>
            <option value="" disabled>Select source…</option>
            {SOURCES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          Ship To
          <input value={poForm.ship_to} onChange={(e) => updatePoField('ship_to', e.target.value)} placeholder="Customer name" />
        </label>
        <label>
          Remarks
          <input value={poForm.remarks} onChange={(e) => updatePoField('remarks', e.target.value)} />
        </label>
      </form>

      <h2>Items on this SO</h2>
      {itemRows.map((row, i) => (
        <div className="item-card" key={i}>
          <label>
            Product
            <SearchableSelect
              options={productOptions}
              value={row.product_id}
              onChange={(v) => updateItemRow(i, 'product_id', v)}
              placeholder="Type to search…"
            />
          </label>
          <label>
            Ordered Qty (kg)
            <input type="number" min="0.01" step="any" value={row.ordered_qty_kg} onChange={(e) => updateItemRow(i, 'ordered_qty_kg', e.target.value)} />
          </label>
          <label>
            NSR Rate
            <input type="number" min="0" step="any" value={row.nsr_rate} onChange={(e) => updateItemRow(i, 'nsr_rate', e.target.value)} />
          </label>
          <label>
            Cash Disc %
            <input type="number" min="0" step="any" value={row.cash_discount_pct} onChange={(e) => updateItemRow(i, 'cash_discount_pct', e.target.value)} />
          </label>
          <label>
            Customer Disc/kg
            <input type="number" step="any" value={row.customer_discount_per_kg} onChange={(e) => updateItemRow(i, 'customer_discount_per_kg', e.target.value)} />
          </label>
          <label>
            Additional Disc/kg
            <input type="number" step="any" value={row.additional_discount_per_kg} onChange={(e) => updateItemRow(i, 'additional_discount_per_kg', e.target.value)} />
          </label>
          <label>
            Addl Disc Ack No.
            <input value={row.additional_discount_ack_number} onChange={(e) => updateItemRow(i, 'additional_discount_ack_number', e.target.value)} />
          </label>
          <label>
            Addl Disc Ack Date
            <input type="date" value={row.additional_discount_ack_date} onChange={(e) => updateItemRow(i, 'additional_discount_ack_date', e.target.value)} />
          </label>
          <label>
            Freight/kg
            <input type="number" step="any" value={row.freight_per_kg} onChange={(e) => updateItemRow(i, 'freight_per_kg', e.target.value)} />
          </label>
          <label>
            Insurance/kg
            <input type="number" step="any" value={row.insurance_per_kg} onChange={(e) => updateItemRow(i, 'insurance_per_kg', e.target.value)} />
          </label>
          {isQscCreate && (
            <>
              <label>
                QSC Incidental/kg
                <input type="number" step="any" value={row.qsc_incidental_per_kg} onChange={(e) => updateItemRow(i, 'qsc_incidental_per_kg', e.target.value)} />
              </label>
              <label>
                QSC Freight Disc/kg
                <input type="number" step="any" value={row.qsc_freight_discount_per_kg} onChange={(e) => updateItemRow(i, 'qsc_freight_discount_per_kg', e.target.value)} />
              </label>
            </>
          )}
          {itemRows.length > 1 && (
            <button type="button" className="item-card-remove" onClick={() => removeItemRow(i)}>Remove</button>
          )}
        </div>
      ))}
      <button type="button" onClick={addItemRow}>Add item</button>{' '}
      <button type="button" onClick={handleCreatePO} disabled={submitting}>{submitting ? 'Saving…' : 'Create Purchase Order'}</button>

      {error && <p className="error">{error}</p>}

      <h2>{editingPoItemId ? 'Edit item' : 'Add item to an existing SO'}</h2>
      <form className="stack-form" onSubmit={handleAddItem}>
        <label>
          SO Number
          <select value={addItemPoId} onChange={(e) => setAddItemPoId(e.target.value)} required disabled={!!editingPoItemId}>
            <option value="" disabled>Select SO…</option>
            {pos.map((po) => (
              <option key={po.po_id} value={po.po_id}>{po.so_number}</option>
            ))}
          </select>
        </label>
        <label>
          Product
          <SearchableSelect
            options={productOptions}
            value={newItem.product_id}
            onChange={(v) => setNewItem((r) => ({ ...r, product_id: v }))}
            placeholder="Type to search…"
            required
          />
        </label>
        <label>
          Ordered Qty (kg)
          <input type="number" min="0.01" step="any" value={newItem.ordered_qty_kg} onChange={(e) => setNewItem((r) => ({ ...r, ordered_qty_kg: e.target.value }))} required />
        </label>
        <label>
          NSR Rate
          <input type="number" min="0" step="any" value={newItem.nsr_rate} onChange={(e) => setNewItem((r) => ({ ...r, nsr_rate: e.target.value }))} />
        </label>
        <label>
          Cash Disc %
          <input type="number" min="0" step="any" value={newItem.cash_discount_pct} onChange={(e) => setNewItem((r) => ({ ...r, cash_discount_pct: e.target.value }))} />
        </label>
        <label>
          Customer Disc/kg
          <input type="number" step="any" value={newItem.customer_discount_per_kg} onChange={(e) => setNewItem((r) => ({ ...r, customer_discount_per_kg: e.target.value }))} />
        </label>
        <label>
          Additional Disc/kg
          <input type="number" step="any" value={newItem.additional_discount_per_kg} onChange={(e) => setNewItem((r) => ({ ...r, additional_discount_per_kg: e.target.value }))} />
        </label>
        <label>
          Addl Disc Ack No.
          <input value={newItem.additional_discount_ack_number} onChange={(e) => setNewItem((r) => ({ ...r, additional_discount_ack_number: e.target.value }))} />
        </label>
        <label>
          Addl Disc Ack Date
          <input type="date" value={newItem.additional_discount_ack_date} onChange={(e) => setNewItem((r) => ({ ...r, additional_discount_ack_date: e.target.value }))} />
        </label>
        <label>
          Freight/kg
          <input type="number" step="any" value={newItem.freight_per_kg} onChange={(e) => setNewItem((r) => ({ ...r, freight_per_kg: e.target.value }))} />
        </label>
        <label>
          Insurance/kg
          <input type="number" step="any" value={newItem.insurance_per_kg} onChange={(e) => setNewItem((r) => ({ ...r, insurance_per_kg: e.target.value }))} />
        </label>
        {isQscAddItem && (
          <>
            <label>
              QSC Incidental/kg
              <input type="number" step="any" value={newItem.qsc_incidental_per_kg} onChange={(e) => setNewItem((r) => ({ ...r, qsc_incidental_per_kg: e.target.value }))} />
            </label>
            <label>
              QSC Freight Disc/kg
              <input type="number" step="any" value={newItem.qsc_freight_discount_per_kg} onChange={(e) => setNewItem((r) => ({ ...r, qsc_freight_discount_per_kg: e.target.value }))} />
            </label>
          </>
        )}
        <button type="submit" disabled={addItemBusy}>
          {addItemBusy ? 'Saving…' : editingPoItemId ? 'Save changes' : 'Add item'}
        </button>
        {editingPoItemId && <button type="button" onClick={cancelEditItem}>Cancel</button>}
      </form>

      <div className="page-header">
        <h2>Purchase order status</h2>
        <button type="button" onClick={handleDownloadStatus} disabled={visibleRows.length === 0}>Download CSV</button>
      </div>
      <label className="hint">
        <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Show closed items
      </label>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>SO Number</th><th>Company</th><th>Source</th><th>Ship To</th><th>Order Placed</th><th>SO Date</th>
              <th>Product</th><th>GSM</th><th>Size (cm)</th>
              <th>NSR Rate</th><th>Actual Price/kg</th><th>Ordered (kg)</th><th>Received (kg)</th><th>Balance (kg)</th>
              <th>Addl Disc Ack No.</th><th>Addl Disc Ack Date</th>
              <th>Closed</th><th></th><th></th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((r) => (
              <tr key={r.po_item_id} className={r.closed ? 'archived-row' : ''}>
                <td>{r.so_number}</td>
                <td>{r.company}</td>
                <td>{r.source}</td>
                <td>{r.ship_to}</td>
                <td>{r.order_placed_date}</td>
                <td>{r.so_date}</td>
                <td>{r.product_id} — {r.variety}</td>
                <td>{r.gsm}</td>
                <td>{r.size_cm}</td>
                <td>{r.nsr_rate}</td>
                <td>{r.actual_price_per_kg}</td>
                <td>{r.ordered_qty_kg}</td>
                <td>{r.received_kg}</td>
                <td className={r.balance_kg !== 0 ? 'low-stock' : ''}>{r.balance_kg}</td>
                <td>{r.additional_discount_ack_number}</td>
                <td>{r.additional_discount_ack_date}</td>
                <td>{r.closed ? 'Yes' : 'No'}</td>
                <td><button type="button" onClick={() => startEditItem(r)}>Edit</button></td>
                <td>{!r.closed && <button type="button" onClick={() => closeItem(r.po_item_id)}>Close</button>}</td>
              </tr>
            ))}
            {visibleRows.length === 0 && (
              <tr><td colSpan={19}>No purchase order items to show.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
