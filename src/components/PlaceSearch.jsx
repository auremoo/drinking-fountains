import Toast from './Toast.jsx'

/**
 * @typedef {import('../hooks/usePlaceSearch.js').PlaceSearchState} PlaceSearchState
 */

/**
 * The "search a city or address" panel: an input with debounced suggestions.
 *
 * Purely presentational — all state, cancellation and error handling live in
 * {@link import('../hooks/usePlaceSearch.js').usePlaceSearch}.
 *
 * @param {{ state: PlaceSearchState }} props
 */
export default function PlaceSearch({ state }) {
  const {
    query,
    setQuery,
    suggestions,
    loading,
    error,
    dismissError,
    choose,
    submit,
  } = state

  return (
    <>
      <div className="city-search-wrap">
        <form className="city-search" onSubmit={submit}>
          <input
            className="city-search__input"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a city or address…"
            autoComplete="off"
            enterKeyHint="search"
            autoFocus
          />
          <button
            className="btn btn--primary city-search__submit"
            type="submit"
            disabled={loading || !query.trim()}
          >
            {loading ? '…' : 'Go'}
          </button>
        </form>

        {suggestions.length > 0 && (
          <ul className="city-suggestions">
            {suggestions.map((place, i) => (
              <li key={`${place.lat},${place.lng}-${i}`}>
                <button
                  type="button"
                  className="city-suggestions__item"
                  onClick={() => choose(place)}
                >
                  {place.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && (
        <Toast variant="error" onDismiss={dismissError}>
          {error}
        </Toast>
      )}
    </>
  )
}
