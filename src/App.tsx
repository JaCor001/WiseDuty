import { BrowserRouter, HashRouter, Routes, Route } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import Landing from './Landing'
import Calendar from './Calendar'
import Signup from './Signup'
import './App.css'

function App() {
  const isNative = Capacitor.isNativePlatform()
  const RouterComponent = isNative ? HashRouter : BrowserRouter
  const basename = isNative ? undefined : '/WiseDuty'

  return (
    <RouterComponent basename={basename}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/calendar" element={<Calendar />} />
        <Route path="/Signup" element={<Signup />} />
      </Routes>
    </RouterComponent>
  )
}

export default App
