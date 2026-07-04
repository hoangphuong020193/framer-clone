import { useEffect, useState } from 'react'

type HealthStatus = 'checking' | 'ok' | 'unreachable'

function App() {
  const [status, setStatus] = useState<HealthStatus>('checking')

  useEffect(() => {
    fetch('/api/health')
      .then((res) => setStatus(res.ok ? 'ok' : 'unreachable'))
      .catch(() => setStatus('unreachable'))
  }, [])

  return (
    <main>
      <h1>Framer Site Cloner</h1>
      <p>Scaffolding check — backend status: {status}</p>
    </main>
  )
}

export default App
