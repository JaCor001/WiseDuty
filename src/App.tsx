import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import Landing from './Landing'
import Calendar from './Calendar'
import './App.css'

function App() {
  return (
    <Router basename="/WiseDuty2">
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/calendar" element={<Calendar />} />
      </Routes>
    </Router>
  )
}

export default App
