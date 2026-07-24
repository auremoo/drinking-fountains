/**
 * A small floating message above the map.
 *
 * One component for every transient message in the app, so an error, a hint and
 * a notice can never drift apart in styling or behaviour — and so an error is
 * always dismissible and, where it makes sense, retryable.
 *
 * @param {Object} props
 * @param {'error'|'info'} [props.variant]
 * @param {import('react').ReactNode} props.children - Message body.
 * @param {() => void} [props.onDismiss] - Renders a × button when provided.
 * @param {{ label: string, onClick: () => void }} [props.action] - Optional
 *   inline action, e.g. "Retry".
 */
export default function Toast({ variant = 'info', children, onDismiss, action }) {
  return (
    <div
      className={`toast toast--${variant} toast--compact`}
      role={variant === 'error' ? 'alert' : 'status'}
    >
      <span>{children}</span>
      {action && (
        <button className="toast__action" onClick={action.onClick}>
          {action.label}
        </button>
      )}
      {onDismiss && (
        <button
          className="toast__dismiss"
          onClick={onDismiss}
          aria-label="Dismiss"
        >
          ×
        </button>
      )}
    </div>
  )
}
