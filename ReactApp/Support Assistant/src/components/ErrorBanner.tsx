type ErrorBannerProps = {
  message: string | null
  onDismiss?: () => void
  className?: string
}

export default function ErrorBanner({ message, onDismiss, className }: ErrorBannerProps) {
  if (!message) return null
  return (
    <div className={`error-banner${className ? ` ${className}` : ''}`} role="alert">
      <span className="error-banner-icon" aria-hidden="true">⚠</span>
      <span className="error-banner-text">{message}</span>
      {onDismiss && (
        <button
          type="button"
          className="error-banner-dismiss"
          onClick={onDismiss}
          aria-label="Fermer"
        >
          ×
        </button>
      )}
    </div>
  )
}
