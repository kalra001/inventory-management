import { NavLink } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

export default function NavBar() {
  const { signOut } = useAuth()

  return (
    <nav className="navbar">
      <NavLink to="/" end>Stock</NavLink>
      <NavLink to="/receipts">Receipts</NavLink>
      <NavLink to="/dispatches">Dispatches</NavLink>
      <NavLink to="/holds">Holds</NavLink>
      <NavLink to="/purchase-orders">Purchase Orders</NavLink>
      <NavLink to="/bills">Bills</NavLink>
      <NavLink to="/kpi-purchases">KPI Purchases</NavLink>
      <NavLink to="/traders">Traders</NavLink>
      <NavLink to="/products">Products</NavLink>
      <button className="link-button" onClick={signOut}>Log out</button>
    </nav>
  )
}
