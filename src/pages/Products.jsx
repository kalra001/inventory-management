import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { byVarietyThenGsmSize } from '../lib/csv'

const emptyForm = { variety: '', gsm: '', size_cm: '', size_in: '', packet_weight: '' }

function buildProductId({ variety, gsm, size_cm, size_in }) {
  const clean = (v) => (v || '').toString().trim().replace(/\s+/g, '')
  return [clean(variety), clean(gsm), clean(size_cm), clean(size_in)].filter(Boolean).join('-')
}

export default function Products() {
  const [products, setProducts] = useState([])
  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [editingProductId, setEditingProductId] = useState(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    const { data, error } = await supabase.from('products').select('*')
    if (error) setError(error.message)
    else setProducts([...data].sort(byVarietyThenGsmSize((p) => p.variety, (p) => p.gsm, (p) => p.size_cm)))
  }

  function updateField(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  const previewId = buildProductId(form)

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    const payload = {
      product_id: previewId,
      variety: form.variety.trim(),
      gsm: form.gsm ? Number(form.gsm) : null,
      size_cm: form.size_cm.trim() || null,
      size_in: form.size_in.trim() || null,
      packet_weight: form.packet_weight ? Number(form.packet_weight) : null,
    }
    const { error } = editingProductId
      ? await supabase.from('products').update(payload).eq('product_id', editingProductId)
      : await supabase.from('products').insert(payload)
    setSubmitting(false)
    if (error) {
      setError(
        error.code === '23503'
          ? `Cannot change the ID for ${editingProductId} — it already has receipts, dispatches, holds, or purchase orders recorded against it.`
          : error.message
      )
      return
    }
    setEditingProductId(null)
    setForm(emptyForm)
    load()
  }

  function startEdit(p) {
    setEditingProductId(p.product_id)
    setForm({
      variety: p.variety,
      gsm: p.gsm != null ? String(p.gsm) : '',
      size_cm: p.size_cm || '',
      size_in: p.size_in || '',
      packet_weight: p.packet_weight != null ? String(p.packet_weight) : '',
    })
  }

  function cancelEdit() {
    setEditingProductId(null)
    setForm(emptyForm)
  }

  async function handleDelete(productId) {
    if (!window.confirm(`Permanently delete product ${productId}? This cannot be undone.`)) return
    setError(null)
    const { error } = await supabase.from('products').delete().eq('product_id', productId)
    if (error) {
      setError(
        error.code === '23503'
          ? `Cannot delete ${productId} — it already has receipts, dispatches, or holds recorded against it. Use Archive instead to hide it without losing that history.`
          : error.message
      )
      return
    }
    load()
  }

  async function toggleActive(product) {
    setError(null)
    const { error } = await supabase
      .from('products')
      .update({ active: !product.active })
      .eq('product_id', product.product_id)
    if (error) setError(error.message)
    else load()
  }

  return (
    <div className="page">
      <h1>Products</h1>

      <form className="inline-form" onSubmit={handleSubmit}>
        <input placeholder="Variety" value={form.variety} onChange={(e) => updateField('variety', e.target.value)} required />
        <input placeholder="GSM" type="number" value={form.gsm} onChange={(e) => updateField('gsm', e.target.value)} />
        <input placeholder="Size (cm) e.g. 56*71" value={form.size_cm} onChange={(e) => updateField('size_cm', e.target.value)} />
        <input placeholder="Size (in) e.g. 22*28" value={form.size_in} onChange={(e) => updateField('size_in', e.target.value)} />
        <input placeholder="Packet Weight" type="number" value={form.packet_weight} onChange={(e) => updateField('packet_weight', e.target.value)} />
        <button type="submit" disabled={submitting || !previewId}>
          {submitting ? 'Saving…' : editingProductId ? 'Save changes' : 'Add product'}
        </button>
        {editingProductId && <button type="button" onClick={cancelEdit}>Cancel</button>}
      </form>
      {previewId && <p className="hint">Product ID will be: {previewId}</p>}

      {error && <p className="error">{error}</p>}

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Product ID</th><th>Variety</th><th>GSM</th><th>Size (cm)</th><th>Size (in)</th><th>Packet Wt</th><th>Active</th><th></th><th></th><th></th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.product_id} className={p.active ? '' : 'archived-row'}>
                <td>{p.product_id}</td>
                <td>{p.variety}</td>
                <td>{p.gsm}</td>
                <td>{p.size_cm}</td>
                <td>{p.size_in}</td>
                <td>{p.packet_weight}</td>
                <td>{p.active ? 'Yes' : 'No'}</td>
                <td><button type="button" onClick={() => startEdit(p)}>Edit</button></td>
                <td><button type="button" onClick={() => toggleActive(p)}>{p.active ? 'Archive' : 'Unarchive'}</button></td>
                <td><button type="button" onClick={() => handleDelete(p.product_id)}>Delete</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
