import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import Landing from './Landing'
import Calendar from './Calendar'
import Signup from './Signup'
import './App.css'

function App() {
  return (
    <Router basename="/WiseDuty">
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/calendar" element={<Calendar />} />
        <Route path="/Signup" element={<Signup />} />
      </Routes>
    </Router>
  )
}

export default App
