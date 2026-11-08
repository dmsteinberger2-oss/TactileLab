import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import Home from './screens/Home'
import Lab from './screens/Lab'
import View from './screens/View'

// QR codes printed before the rename point at /learn; keep them working, query string included.
function LearnRedirect() {
  const { search } = useLocation()
  return <Navigate to={{ pathname: '/view', search }} replace />
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/lab/:labId" element={<Lab />} />
      <Route path="/view" element={<View />} />
      <Route path="/learn" element={<LearnRedirect />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
