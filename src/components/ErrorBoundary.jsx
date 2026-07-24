import { Component } from 'react'
import { formatErrorLog, logError } from '../utils/errorLog.js'
import { resetApp } from '../utils/appReset.js'

/**
 * Catches render-time exceptions so a single bad component can never leave the
 * user staring at a blank white screen — the worst possible failure mode for an
 * app you open when you are thirsty.
 *
 * The fallback screen offers, in order of escalation:
 *  - **Reload** — fixes transient state corruption;
 *  - **Reset app data** — unregisters the service worker and drops every cache,
 *    which fixes a wedged PWA install;
 *  - **Copy details** — puts the recorded errors on the clipboard so they can
 *    actually be reported instead of described from memory.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, copied: false, showDetails: false }
  }

  /** @param {Error} error */
  static getDerivedStateFromError(error) {
    return { error, copied: false }
  }

  /**
   * @param {Error} error
   * @param {{ componentStack?: string }} info
   */
  componentDidCatch(error, info) {
    logError('render', error)
    if (info?.componentStack) logError('render:stack', new Error(info.componentStack))
  }

  handleCopy = async () => {
    const text = formatErrorLog()
    try {
      await navigator.clipboard.writeText(text)
      this.setState({ copied: true })
    } catch {
      // Clipboard access can be denied; showing the text lets the user select it.
      this.setState({ copied: false, showDetails: true })
    }
  }

  render() {
    const { error, copied } = this.state
    if (!error) return this.props.children

    return (
      <div className="crash" role="alert">
        <div className="crash__card">
          <h1 className="crash__title">
            <span aria-hidden="true">💧</span> Something went wrong
          </h1>
          <p className="crash__text">
            The app hit an unexpected error and stopped. Reloading usually fixes
            it. If it keeps happening, reset the app data.
          </p>
          <p className="crash__message">{error.message || String(error)}</p>

          <div className="crash__actions">
            <button
              className="btn btn--primary"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
            <button className="btn btn--ghost" onClick={resetApp}>
              Reset app data
            </button>
            <button className="btn btn--ghost" onClick={this.handleCopy}>
              {copied ? 'Copied ✓' : 'Copy details'}
            </button>
          </div>

          {this.state.showDetails && (
            <pre className="crash__details">{formatErrorLog()}</pre>
          )}
        </div>
      </div>
    )
  }
}
