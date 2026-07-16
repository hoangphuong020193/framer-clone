import { useState, type FormEvent } from 'react'
import type { CaptureMode } from '../../types/capture'

interface CaptureFormProps {
  disabled: boolean
  onSubmit: (url: string, mode: CaptureMode) => void
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function CaptureForm({ disabled, onSubmit }: CaptureFormProps) {
  const [url, setUrl] = useState('')
  const [mode, setMode] = useState<CaptureMode>('whole-site')
  const [authorized, setAuthorized] = useState(false)
  const [touched, setTouched] = useState(false)

  const trimmed = url.trim()
  const urlValid = isValidHttpUrl(trimmed)
  const canSubmit = !disabled && urlValid && authorized
  const showUrlError = touched && trimmed !== '' && !urlValid

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault()
    setTouched(true)
    if (canSubmit) onSubmit(trimmed, mode)
  }

  return (
    <form className="capture-form" onSubmit={handleSubmit} noValidate>
      <label className="field">
        <span className="field-label">Published site URL</span>
        <input
          className="url-input"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://your-site.framer.website"
          value={url}
          disabled={disabled}
          onChange={(event) => setUrl(event.target.value)}
          onBlur={() => setTouched(true)}
          aria-invalid={showUrlError}
        />
        {showUrlError && <span className="field-error">Enter a full http(s) URL, e.g. https://example.com</span>}
      </label>

      <fieldset className="mode-toggle" disabled={disabled}>
        <legend className="field-label">Scope</legend>
        <div className="segmented" role="radiogroup" aria-label="Capture scope">
          <ModeOption current={mode} value="whole-site" label="Whole site" hint="Crawl every linked page" onSelect={setMode} />
          <ModeOption current={mode} value="single-page" label="Single page" hint="Just this URL — faster" onSelect={setMode} />
        </div>
      </fieldset>

      <label className="consent">
        <input type="checkbox" checked={authorized} disabled={disabled} onChange={(event) => setAuthorized(event.target.checked)} />
        <span>
          I'm authorized to capture this site. Only archive sites you own or have permission to copy — you're responsible for
          respecting the owner's rights and terms.
        </span>
      </label>

      <button className="submit" type="submit" disabled={!canSubmit}>
        {disabled ? 'Capturing…' : 'Capture site'}
      </button>
    </form>
  )
}

interface ModeOptionProps {
  current: CaptureMode
  value: CaptureMode
  label: string
  hint: string
  onSelect: (mode: CaptureMode) => void
}

function ModeOption({ current, value, label, hint, onSelect }: ModeOptionProps) {
  const active = current === value
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      className={active ? 'segment segment-active' : 'segment'}
      onClick={() => onSelect(value)}
    >
      <span className="segment-label">{label}</span>
      <span className="segment-hint">{hint}</span>
    </button>
  )
}
