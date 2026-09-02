import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { rowsToCsv, downloadCsv, todayStr } from '../lib/csv'
import SearchableSelect from '../components/SearchableSelect'

function round2(n) {
  return n == null ? null : Math.round(n * 100) / 100
}

const LEDGER_COLUMNS = [
  { label: 'Date', value: (r) => r.date },
  { label: 'Type', value: (r) => r.type },
  { label: 'Packets', value: (r) => r.packets },
  { label: 'Quantity (kg)', value: (r) => r.kg },
  { label: 'Vehicle', value: (r) => r.vehicle },
  { label: 'Reference', value: (r) => r.reference },
  { label: 'Balance (packets)', value: (r) => r.balancePackets },
  { label: 'Balance (kg)', value: (r) => r.balanceKg },
  { label: 'Remarks', value: (r) => r.remarks },
  { label: 'Edited By', value: (r) => r.editedBy },
]

export default function ProductLedger() {
  const [products, setProducts] = useState([])
  const [productId, setProductId] = useState('')
  const [summary, setSummary] = useState(null)
  const [rawReceipts, setRawReceipts] = useState([])
  const [rawDispatches, setRawDispatches] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const productOptions = useMemo(
    () => products.map((p) => ({
      value: p.product_id,
      label: `${p.product_id} — ${p.variety}${p.active ? '' : ' (archived)'}`,
    })),
    [products]
  )

  useEffect(() => {
    loadProducts()
  }, [])

  useEffect(() => {
    if (!productId) {
      setSummary(null)
      setRawReceipts([])
      setRawDispatches([])
      return
    }
    loadForProduct(productId)
  }, [productId])

  async function loadProducts() {
    const { data } = await supabase.from('products').select('product_id, variety, active').order('variety')
    setProducts(data ?? [])
  }

  async function loadForProduct(pid) {
    setLoading(true)
    setError(null)
    const [summaryRes, receiptsRes, dispatchesRes] = await Promise.all([
      supabase.from('stock_summary').select('*').eq('product_id', pid).single(),
      supabase
        .from('receipts')
        .select('receipt_id, date, packets, vehicle, container_no, remarks, created_at, profiles(name)')
        .eq('product_id', pid)
        .order('date', { ascending: true })
        .order('created_at', { ascending: true }),
      supabase
        .from('dispatches')
        .select('dispatch_id, date, packets, vehicle, challan_no, remarks, created_at, profiles(name)')
        .eq('product_id', pid)
        .order('date', { ascending: true })
        .order('created_at', { ascending: true }),
    ])
    setLoading(false)

    if (summaryRes.error) { setError(summaryRes.error.message); return }
    if (receiptsRes.error) { setError(receiptsRes.error.message); return }
    if (dispatchesRes.error) { setError(dispatchesRes.error.message); return }

    setSummary(summaryRes.data)
    setRawReceipts(receiptsRes.data ?? [])
    setRawDispatches(dispatchesRes.data ?? [])
  }

  // receipts and dispatches each have their own id sequence, so there's no
  // single shared "entry order" across both — date first, then actual
  // timestamp of entry as the tiebreak for same-day transactions
  const ledgerRows = useMemo(() => {
    if (!summary) return []
    const packetWeight = summary.packet_weight

    const combined = [
      ...rawReceipts.map((r) => ({
        key: `receipt-${r.receipt_id}`,
        date: r.date,
        created_at: r.created_at,
        type: 'Receipt',
        packets: r.packets,
        vehicle: r.vehicle,
        reference: r.container_no,
        remarks: r.remarks,
        editedBy: r.profiles?.name,
      })),
      ...rawDispatches.map((d) => ({
        key: `dispatch-${d.dispatch_id}`,
        date: d.date,
        created_at: d.created_at,
        type: 'Dispatch',
        packets: -d.packets,
        vehicle: d.vehicle,
        reference: d.challan_no,
        remarks: d.remarks,
        editedBy: d.profiles?.name,
      })),
    ].sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1
      return new Date(a.created_at) - new Date(b.created_at)
    })

    let balance = 0
    return combined.map((row) => {
      balance += row.packets
      return {
        ...row,
        kg: packetWeight != null ? round2(row.packets * packetWeight) : null,
        balancePackets: balance,
        balanceKg: packetWeight != null ? round2(balance * packetWeight) : null,
      }
    })
  }, [summary, rawReceipts, rawDispatches])

  function handleDownload() {
    downloadCsv(`product-ledger-${productId}-${todayStr()}.csv`, rowsToCsv(ledgerRows, LEDGER_COLUMNS))
  }

  return (
    <div className="page">
      <h1>Product Ledger</h1>
      <p className="hint">Pick a product to see every receipt and dispatch against it, in order, with a running balance.</p>

      <div className="page-header">
        <SearchableSelect
          options={productOptions}
          value={productId}
          onChange={setProductId}
          placeholder="Select a product…"
        />
        <button type="button" onClick={handleDownload} disabled={ledgerRows.length === 0}>Download CSV</button>
      </div>

      {loading && <p>Loading…</p>}
      {error && <p className="error">{error}</p>}

      {summary && (
        <div className="ledger-summary">
          <strong>{summary.product_id} — {summary.variety}</strong>
          <span className="hint">{summary.size_cm} cm / {summary.size_in} in, {summary.packet_weight} kg/pkt</span>
          <span className="hint">In Stock: {summary.packets_in_stock} pkts ({summary.quantity_kg} kg)</span>
          <span className="hint">On Hold: {summary.packets_on_hold} pkts</span>
          <span className={summary.packets_available <= 0 ? 'low-stock' : 'hint'}>
            Available: {summary.packets_available} pkts ({summary.quantity_after_hold_kg} kg)
          </span>
        </div>
      )}

      {summary && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Date</th><th>Type</th><th>Packets</th><th>Quantity (kg)</th><th>Vehicle</th><th>Reference</th><th>Balance (pkts)</th><th>Balance (kg)</th><th>Remarks</th><th>Edited By</th>
              </tr>
            </thead>
            <tbody>
              {ledgerRows.map((r) => (
                <tr key={r.key}>
                  <td>{r.date}</td>
                  <td>{r.type}</td>
                  <td className={r.type === 'Dispatch' ? 'low-stock' : ''}>{r.packets}</td>
                  <td>{r.kg}</td>
                  <td>{r.vehicle}</td>
                  <td>{r.reference}</td>
                  <td>{r.balancePackets}</td>
                  <td>{r.balanceKg}</td>
                  <td>{r.remarks}</td>
                  <td>{r.editedBy}</td>
                </tr>
              ))}
              {ledgerRows.length === 0 && (
                <tr><td colSpan={10}>No receipts or dispatches yet for this product.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {!productId && !loading && <p className="hint">No product selected yet.</p>}
    </div>
  )
}
