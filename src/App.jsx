import { Routes, Route, Navigate } from 'react-router-dom'
import Home from './screens/Home'
import Lab from './screens/Lab'
import Learn from './screens/Learn'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/lab/:labId" element={<Lab />} />
      <Route path="/learn" element={<Learn />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
