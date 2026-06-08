import { useMemo } from 'react'
import { parseReportSections } from '../derive'

type AnalysisReportProps = {
  report: string
  /** Render compact (smaller type, tighter spacing) — used inside the timeline. */
  compact?: boolean
}

/**
 * Renders a Codex analysis report. When the report follows the numbered-section
 * convention it is shown as a clean, scannable list of sections; otherwise the
 * raw text is preserved verbatim.
 */
export default function AnalysisReport({ report, compact = false }: AnalysisReportProps) {
  const sections = useMemo(() => parseReportSections(report), [report])

  if (!sections) {
    return <pre className={`analysis-raw${compact ? ' analysis-raw--compact' : ''}`}>{report}</pre>
  }

  return (
    <div className={`analysis-report${compact ? ' analysis-report--compact' : ''}`}>
      {sections.map((section) => (
        <article key={section.num} className="analysis-section">
          <header className="analysis-section-head">
            <span className="analysis-section-num">{section.num.padStart(2, '0')}</span>
            <h5 className="analysis-section-title">{section.title}</h5>
          </header>
          {section.body && <p className="analysis-section-body">{section.body}</p>}
        </article>
      ))}
    </div>
  )
}
