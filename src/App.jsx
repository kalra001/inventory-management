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
import ReelStock from './pages/ReelStock'
import ReelReceipts from './pages/ReelReceipts'
import ReelDispatches from './pages/ReelDispatches'

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
        <Route path="/reel-stock" element={<ProtectedRoute><Layout><ReelStock /></Layout></ProtectedRoute>} />
        <Route path="/reel-receipts" element={<ProtectedRoute><Layout><ReelReceipts /></Layout></ProtectedRoute>} />
        <Route path="/reel-dispatches" element={<ProtectedRoute><Layout><ReelDispatches /></Layout></ProtectedRoute>} />
      </Routes>
    </BrowserRouter>
  )
}
