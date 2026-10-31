import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { rowsToCsv, downloadCsv, todayStr } from '../lib/csv'
import SearchableSelect from '../components/SearchableSelect'

const REPORT_COLUMNS = [
  { label: 'SO Number', value: (r) => r.so_number },
  { label: 'PO Number', value: (r) => r.po_number },
  { label: 'Company', value: (r) => r.company },
  { label: 'Source', value: (r) => r.source },
  { label: 'Ship To', value: (r) => r.ship_to },
  { label: 'Order Placed', value: (r) => r.order_placed_date },
  { label: 'Ordered (kg)', value: (r) => r.ordered_qty_kg },
  { label: 'Received (kg)', value: (r) => r.received_kg },
  { label: 'Balance (kg)', value: (r) => r.balance_kg },
  { label: 'Status', value: (r) => (r.closed ? 'Closed' : 'Open') },
]

export default function PendingByProduct() {
  const [products, setProducts] = useState([])
  const [productId, setProductId] = useState('')
  const [rows, setRows] = useState([])
  const [showClosed, setShowClosed] = useState(false)
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
      setRows([])
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
    const { data, error } = await supabase
      .from('po_item_status')
      .select('po_item_id, so_number, po_number, company, source, ship_to, order_placed_date, ordered_qty_kg, received_kg, balance_kg, closed')
      .eq('product_id', pid)
      .order('order_placed_date', { ascending: true })
      .order('po_item_id', { ascending: true })
    setLoading(false)
    if (error) { setError(error.message); return }
    setRows(data)
  }

  // the headline total always reflects open items only — a closed item's
  // leftover balance isn't really "pending" even if shown for reference
  const openRows = useMemo(() => rows.filter((r) => !r.closed), [rows])
  const visibleRows = showClosed ? rows : openRows
  const totalPendingKg = useMemo(() => openRows.reduce((sum, r) => sum + r.balance_kg, 0), [openRows])

  function handleDownload() {
    downloadCsv(`pending-${productId}-${todayStr()}.csv`, rowsToCsv(visibleRows, REPORT_COLUMNS))
  }

  return (
    <div className="page">
      <h1>Pending by Product</h1>
      <p className="hint">Pick a product to see how much is still pending across every SO, and exactly which SOs it's coming from.</p>

      <div className="page-header">
        <SearchableSelect
          options={productOptions}
          value={productId}
          onChange={setProductId}
          placeholder="Select a product…"
        />
        <button type="button" onClick={handleDownload} disabled={visibleRows.length === 0}>Download CSV</button>
      </div>

      {loading && <p>Loading…</p>}
      {error && <p className="error">{error}</p>}

      {productId && !loading && (
        <div className="ledger-summary">
          <strong>Total Pending: {totalPendingKg} kg</strong>
          <span className="hint">across {openRows.length} open PO item{openRows.length === 1 ? '' : 's'}</span>
        </div>
      )}

      {productId && (
        <>
          <label className="hint">
            <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Show closed items
          </label>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>SO Number</th><th>PO Number</th><th>Company</th><th>Source</th><th>Ship To</th><th>Order Placed</th><th>Ordered (kg)</th><th>Received (kg)</th><th>Balance (kg)</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r) => (
                  <tr key={r.po_item_id} className={r.closed ? 'archived-row' : ''}>
                    <td>{r.so_number}</td>
                    <td>{r.po_number}</td>
                    <td>{r.company}</td>
                    <td>{r.source}</td>
                    <td>{r.ship_to}</td>
                    <td>{r.order_placed_date}</td>
                    <td>{r.ordered_qty_kg}</td>
                    <td>{r.received_kg}</td>
                    <td className={r.balance_kg !== 0 ? 'low-stock' : ''}>{r.balance_kg}</td>
                    <td>{r.closed ? 'Closed' : 'Open'}</td>
                  </tr>
                ))}
                {visibleRows.length === 0 && (
                  <tr><td colSpan={10}>Nothing pending for this product.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!productId && !loading && <p className="hint">No product selected yet.</p>}
    </div>
  )
}
