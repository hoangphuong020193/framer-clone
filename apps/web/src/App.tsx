import { CaptureForm } from './components/capture/CaptureForm'
import { ProgressFeed } from './components/capture/ProgressFeed'
import { ResultPanel } from './components/capture/ResultPanel'
import { useCaptureJob } from './hooks/useCaptureJob'
import './App.css'

function App() {
  const job = useCaptureJob()
  const showProgress = job.phase === 'starting' || job.phase === 'running'
  const showResult = job.phase === 'succeeded' || job.phase === 'partial' || job.phase === 'failed'

  return (
    <div className="app">
      <header className="masthead">
        <p className="eyebrow">Framer site cloner</p>
        <h1>Archive a published Framer site for offline browsing.</h1>
        <p className="lede">
          Capture the whole site — animations, hover states, and assets — into a self-contained archive you can download and
          open anywhere.
        </p>
      </header>

      <main className="panel">
        <CaptureForm disabled={job.isBusy} onSubmit={job.start} />
        {showProgress && <ProgressFeed snapshot={job.snapshot} starting={job.phase === 'starting'} />}
        {showResult && <ResultPanel phase={job.phase} snapshot={job.snapshot} error={job.error} onReset={job.reset} />}
      </main>

      <footer className="footer">
        Runs locally. The server fetches only the URL you provide, behind an SSRF guard — no other origins are contacted on
        your behalf.
      </footer>
    </div>
  )
}

export default App
