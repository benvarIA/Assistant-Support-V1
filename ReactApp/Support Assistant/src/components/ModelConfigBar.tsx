import { useState } from 'react'
import type { EffortLevel, ModelConfig } from '../types'

type Props = {
  config: ModelConfig
  onChange: (config: ModelConfig) => void
}

type EffortDef = { value: EffortLevel; label: string }

const EFFORTS: EffortDef[] = [
  { value: 'low',    label: 'Faible' },
  { value: 'medium', label: 'Moyen'  },
  { value: 'high',   label: 'Élevé'  },
]

type OpenDropdown = 'provider' | 'model' | 'effort' | null

export default function ModelConfigBar({ config, onChange }: Props) {
  const [open, setOpen] = useState<OpenDropdown>(null)

  const toggle = (key: OpenDropdown) => setOpen(prev => prev === key ? null : key)
  const close  = () => setOpen(null)

  const setEffort = (effort: EffortLevel) => {
    onChange({ ...config, effort })
    close()
  }

  const currentEffort = EFFORTS.find(e => e.value === config.effort)

  return (
    <div className="model-config-bar" onMouseLeave={close}>
      {/* Provider + model — label fixe, pas de dropdown */}
      <span className="model-config-label">
        <span className="model-config-pill-icon">⬡</span>
        Codex · GPT-5.4
      </span>

      <span className="model-config-sep">·</span>

      {/* Effort */}
      <div className="model-config-item">
        <button
          type="button"
          className={`model-config-pill${open === 'effort' ? ' model-config-pill--open' : ''}`}
          onClick={() => toggle('effort')}
        >
          {currentEffort?.label ?? config.effort}
          <span className="model-config-pill-caret">▾</span>
        </button>
        {open === 'effort' && (
          <div className="model-config-dropdown">
            {EFFORTS.map(e => (
              <button
                key={e.value}
                type="button"
                className={`model-config-option${config.effort === e.value ? ' model-config-option--active' : ''}`}
                onClick={() => setEffort(e.value)}
              >
                {e.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
