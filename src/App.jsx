import { BrowserRouter, Routes, Route } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import NavBar from './components/NavBar'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Receipts from './pages/Receipts'
import Dispatches from './pages/Dispatches'
import Holds from './pages/Holds'
import PurchaseOrders from './pages/PurchaseOrders'
import Bills from './pages/Bills'
import KpiPurchases from './pages/KpiPurchases'
import Traders from './pages/Traders'
import Products from './pages/Products'

function Layout({ children }) {
  return (
    <>
      <NavBar />
      <main>{children}</main>
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<ProtectedRoute><Layout><Dashboard /></Layout></ProtectedRoute>} />
        <Route path="/receipts" element={<ProtectedRoute><Layout><Receipts /></Layout></ProtectedRoute>} />
        <Route path="/dispatches" element={<ProtectedRoute><Layout><Dispatches /></Layout></ProtectedRoute>} />
        <Route path="/holds" element={<ProtectedRoute><Layout><Holds /></Layout></ProtectedRoute>} />
        <Route path="/purchase-orders" element={<ProtectedRoute><Layout><PurchaseOrders /></Layout></ProtectedRoute>} />
        <Route path="/bills" element={<ProtectedRoute><Layout><Bills /></Layout></ProtectedRoute>} />
        <Route path="/kpi-purchases" element={<ProtectedRoute><Layout><KpiPurchases /></Layout></ProtectedRoute>} />
        <Route path="/traders" element={<ProtectedRoute><Layout><Traders /></Layout></ProtectedRoute>} />
        <Route path="/products" element={<ProtectedRoute><Layout><Products /></Layout></ProtectedRoute>} />
      </Routes>
    </BrowserRouter>
  )
}
