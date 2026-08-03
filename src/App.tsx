import { BrowserRouter, HashRouter, Navigate, Routes, Route } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import Landing from './Landing'
import Calendar from './Calendar'
import Signup from './Signup'
import Login from './Login'
import { SettingsProvider } from './features/settings/SettingsContext'
import VersionBadge from './shared/ui/VersionBadge'
import ErrorBoundary from './shared/ui/ErrorBoundary'
import './App.css'

function App() {
  const isNative = Capacitor.isNativePlatform()
  const RouterComponent = isNative ? HashRouter : BrowserRouter
  const basename = isNative ? undefined : '/WiseDuty'

  return (
    <ErrorBoundary>
      <SettingsProvider>
        <RouterComponent basename={basename}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/calendar" element={<Calendar />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/Signup" element={<Navigate to="/signup" replace />} />
            <Route path="/login" element={<Login />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <VersionBadge />
        </RouterComponent>
      </SettingsProvider>
    </ErrorBoundary>
  )
}

export default App
