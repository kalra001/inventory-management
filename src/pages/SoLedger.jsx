import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { rowsToCsv, downloadCsv, todayStr } from '../lib/csv'
import SearchableSelect from '../components/SearchableSelect'

const ITEM_COLUMNS = [
  { label: 'Product ID', value: (r) => r.product_id },
  { label: 'Variety', value: (r) => r.variety },
  { label: 'GSM', value: (r) => r.gsm },
  { label: 'Size (cm)', value: (r) => r.size_cm },
  { label: 'Size (in)', value: (r) => r.size_in },
  { label: 'Ordered Qty (kg)', value: (r) => r.ordered_qty_kg },
  { label: 'Received (kg)', value: (r) => r.received_kg },
  { label: 'Balance (kg)', value: (r) => r.balance_kg },
  { label: 'Status', value: (r) => (r.closed ? 'Closed' : 'Open') },
]

const RECEIPT_COLUMNS = [
  { label: 'Date', value: (r) => r.date },
  { label: 'Product ID', value: (r) => r.product_id },
  { label: 'Variety', value: (r) => r.variety },
  { label: 'Packets', value: (r) => r.packets },
  { label: 'Quantity (kg)', value: (r) => r.quantity_kg },
  { label: 'Vehicle', value: (r) => r.vehicle },
  { label: 'Challan No', value: (r) => r.challan_no },
  { label: 'Remarks', value: (r) => r.remarks },
  { label: 'Edited By', value: (r) => r.editedBy },
]

function buildCsv(po, items, receipts) {
  const header = `SO Number: ${po.so_number} | PO Number: ${po.po_number} | Order Placed: ${po.order_placed_date}${po.so_date ? ' | SO Date: ' + po.so_date : ''}${po.company ? ' | Company: ' + po.company : ''}${po.source ? ' | Source: ' + po.source : ''}${po.ship_to ? ' | Ship To: ' + po.ship_to : ''}`
  const itemsBlock = 'Items on this SO\r\n' + rowsToCsv(items, ITEM_COLUMNS)
  const receiptsBlock = 'Receipts against this SO\r\n' + rowsToCsv(receipts, RECEIPT_COLUMNS)
  return [header, itemsBlock, receiptsBlock].join('\r\n\r\n')
}

export default function SoLedger() {
  const [pos, setPos] = useState([])
  const [poId, setPoId] = useState('')
  const [po, setPo] = useState(null)
  const [items, setItems] = useState([])
  const [rawReceipts, setRawReceipts] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const poOptions = useMemo(
    () => pos.map((p) => ({ value: p.po_id, label: `${p.so_number} (${p.po_number})` })),
    [pos]
  )

  useEffect(() => {
    loadPos()
  }, [])

  useEffect(() => {
    if (!poId) {
      setPo(null)
      setItems([])
      setRawReceipts([])
      return
    }
    loadForPo(poId)
  }, [poId])

  async function loadPos() {
    // only POs whose SO number has arrived — this page works by SO number only
    const { data } = await supabase
      .from('purchase_orders')
      .select('po_id, po_number, so_number')
      .not('so_number', 'is', null)
      .order('so_number')
    setPos(data ?? [])
  }

  async function loadForPo(id) {
    setLoading(true)
    setError(null)

    const [poRes, itemsRes] = await Promise.all([
      supabase.from('purchase_orders').select('*').eq('po_id', id).single(),
      supabase.from('po_item_status').select('*').eq('po_id', id).order('product_id'),
    ])

    if (poRes.error) { setLoading(false); setError(poRes.error.message); return }
    if (itemsRes.error) { setLoading(false); setError(itemsRes.error.message); return }

    const poItemIds = itemsRes.data.map((i) => i.po_item_id)
    const receiptsRes = poItemIds.length
      ? await supabase
          .from('receipts')
          .select('receipt_id, date, packets, vehicle, challan_no, remarks, po_item_id, products(product_id, variety, packet_weight), profiles(name)')
          .in('po_item_id', poItemIds)
          .order('date', { ascending: true })
          .order('receipt_id', { ascending: true })
      : { data: [], error: null }

    setLoading(false)
    if (receiptsRes.error) { setError(receiptsRes.error.message); return }

    setPo(poRes.data)
    setItems(itemsRes.data)
    setRawReceipts(receiptsRes.data ?? [])
  }

  const receiptRows = useMemo(
    () => rawReceipts.map((r) => ({
      key: r.receipt_id,
      date: r.date,
      product_id: r.products?.product_id,
      variety: r.products?.variety,
      packets: r.packets,
      quantity_kg: r.products?.packet_weight != null ? r.packets * r.products.packet_weight : '',
      vehicle: r.vehicle,
      challan_no: r.challan_no,
      remarks: r.remarks,
      editedBy: r.profiles?.name,
    })),
    [rawReceipts]
  )

  function handleDownload() {
    downloadCsv(`so-ledger-${po.so_number}-${todayStr()}.csv`, buildCsv(po, items, receiptRows))
  }

  return (
    <div className="page">
      <h1>SO Ledger</h1>
      <p className="hint">Pick an SO number to see what was ordered, in what sizes/quantities, and every receipt against it.</p>

      <div className="page-header">
        <SearchableSelect
          options={poOptions}
          value={poId}
          onChange={setPoId}
          placeholder="Select SO number…"
        />
        <button type="button" onClick={handleDownload} disabled={!po}>Download CSV</button>
      </div>

      {loading && <p>Loading…</p>}
      {error && <p className="error">{error}</p>}

      {po && (
        <div className="ledger-summary">
          <strong>{po.so_number}</strong>
          <span className="hint">PO Number: {po.po_number}</span>
          <span className="hint">Order Placed: {po.order_placed_date}</span>
          {po.so_date && <span className="hint">SO Date: {po.so_date}</span>}
          {po.company && <span className="hint">Company: {po.company}</span>}
          {po.source && <span className="hint">Source: {po.source}</span>}
          {po.ship_to && <span className="hint">Ship To: {po.ship_to}</span>}
        </div>
      )}
      {po?.remarks && <p className="hint">Remarks: {po.remarks}</p>}

      {po && (
        <>
          <h2>Items on this SO</h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Product</th><th>GSM</th><th>Size (cm)</th><th>Size (in)</th><th>Ordered Qty (kg)</th><th>Received (kg)</th><th>Balance (kg)</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.po_item_id}>
                    <td>{i.product_id} — {i.variety}</td>
                    <td>{i.gsm}</td>
                    <td>{i.size_cm}</td>
                    <td>{i.size_in}</td>
                    <td>{i.ordered_qty_kg}</td>
                    <td>{i.received_kg}</td>
                    <td className={i.balance_kg <= 0 ? 'low-stock' : ''}>{i.balance_kg}</td>
                    <td>{i.closed ? 'Closed' : 'Open'}</td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr><td colSpan={8}>No items on this SO.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <h2>Receipts against this SO</h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Date</th><th>Product</th><th>Packets</th><th>Quantity (kg)</th><th>Vehicle</th><th>Challan No</th><th>Remarks</th><th>Edited By</th>
                </tr>
              </thead>
              <tbody>
                {receiptRows.map((r) => (
                  <tr key={r.key}>
                    <td>{r.date}</td>
                    <td>{r.product_id} — {r.variety}</td>
                    <td>{r.packets}</td>
                    <td>{r.quantity_kg}</td>
                    <td>{r.vehicle}</td>
                    <td>{r.challan_no}</td>
                    <td>{r.remarks}</td>
                    <td>{r.editedBy}</td>
                  </tr>
                ))}
                {receiptRows.length === 0 && (
                  <tr><td colSpan={8}>No receipts yet against this SO.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!poId && !loading && <p className="hint">No SO selected yet.</p>}
    </div>
  )
}
