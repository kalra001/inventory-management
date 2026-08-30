import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { rowsToCsv, downloadCsv, todayStr, byVarietyThenGsmSize } from '../lib/csv'

const STOCK_COLUMNS = [
  { label: 'Product ID', value: (r) => r.product_id },
  { label: 'Variety', value: (r) => r.variety },
  { label: 'GSM', value: (r) => r.gsm },
  { label: 'Size (cm)', value: (r) => r.size_cm },
  { label: 'Size (in)', value: (r) => r.size_in },
  { label: 'Packet Weight', value: (r) => r.packet_weight },
  { label: 'In Stock', value: (r) => r.packets_in_stock },
  { label: 'Quantity (kg)', value: (r) => r.quantity_kg },
  { label: 'On Hold', value: (r) => r.packets_on_hold },
  { label: 'Available after Hold', value: (r) => r.packets_available },
  { label: 'Quantity after Hold', value: (r) => r.quantity_after_hold_kg },
]

// if the query looks like "28*40", also try "40*28" so a search for one
// orientation of a size still finds it stored the other way round
function queryVariants(q) {
  const parts = q.split('*')
  if (parts.length === 2 && parts[0].trim() && parts[1].trim()) {
    return [q, `${parts[1].trim()}*${parts[0].trim()}`]
  }
  return [q]
}

function matchesSearch(row, q) {
  const haystacks = [row.product_id, row.variety, row.size_cm, row.size_in]
    .map((v) => v?.toLowerCase() ?? '')
  return queryVariants(q).some((variant) => haystacks.some((h) => h.includes(variant)))
}

function StockTable({ rows, emptyMessage }) {
  return (
    <div className="table-scroll">
      <table className="card-table">
        <thead>
          <tr>
            <th>Product ID</th>
            <th>Variety</th>
            <th>GSM</th>
            <th>Size (cm)</th>
            <th>Size (in)</th>
            <th>Packet Wt</th>
            <th>In Stock</th>
            <th>Quantity (kg)</th>
            <th>On Hold</th>
            <th>Available after Hold</th>
            <th>Quantity after Hold</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.product_id}>
              <td data-label="Product ID">{r.product_id}</td>
              <td data-label="Variety">{r.variety}</td>
              <td data-label="GSM">{r.gsm}</td>
              <td data-label="Size (cm)">{r.size_cm}</td>
              <td data-label="Size (in)">{r.size_in}</td>
              <td data-label="Packet Wt">{r.packet_weight}</td>
              <td data-label="In Stock">{r.packets_in_stock}</td>
              <td data-label="Quantity (kg)">{r.quantity_kg}</td>
              <td data-label="On Hold">{r.packets_on_hold}</td>
              <td data-label="Available after Hold" className={r.packets_available <= 0 ? 'low-stock' : ''}>{r.packets_available}</td>
              <td data-label="Quantity after Hold" className={r.quantity_after_hold_kg <= 0 ? 'low-stock' : ''}>{r.quantity_after_hold_kg}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={11}>{emptyMessage}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

export default function Dashboard() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [showOutOfStock, setShowOutOfStock] = useState(false)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('stock_summary')
      .select('*')
      .eq('active', true)
      .order('variety', { ascending: true })
    if (error) setError(error.message)
    else setRows(data)
    setLoading(false)
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const base = q
      ? rows.filter((r) => matchesSearch(r, q))
      : rows
    return [...base].sort(byVarietyThenGsmSize((r) => r.variety, (r) => r.gsm, (r) => r.size_cm))
  }, [rows, search])

  const inStockRows = useMemo(() => filtered.filter((r) => r.packets_in_stock > 0), [filtered])
  const outOfStockRows = useMemo(() => filtered.filter((r) => r.packets_in_stock <= 0), [filtered])

  function handleDownload() {
    const csv = rowsToCsv(inStockRows, STOCK_COLUMNS)
    downloadCsv(`current-stock-${todayStr()}.csv`, csv)
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Current Stock</h1>
        <input
          className="search-box"
          placeholder="Search product ID or variety…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button type="button" onClick={handleDownload} disabled={inStockRows.length === 0}>Download CSV</button>
      </div>

      {loading && <p>Loading…</p>}
      {error && <p className="error">{error}</p>}

      {!loading && !error && (
        <>
          <StockTable rows={inStockRows} emptyMessage="No products in stock." />

          <label className="hint">
            <input type="checkbox" checked={showOutOfStock} onChange={(e) => setShowOutOfStock(e.target.checked)} />
            {' '}Show out of stock ({outOfStockRows.length})
          </label>

          {showOutOfStock && (
            <>
              <h2>Out of Stock</h2>
              <StockTable rows={outOfStockRows} emptyMessage="No out-of-stock products." />
            </>
          )}
        </>
      )}
    </div>
  )
}
