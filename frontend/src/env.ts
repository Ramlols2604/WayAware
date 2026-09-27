const rawBase = import.meta.env.VITE_API_BASE_URL ?? ''

export const apiBaseUrl = rawBase.replace(/\/$/, '')

/** Public browser token only. Never put a secret or backend Mapbox token here. */
export const mapboxPublicToken = import.meta.env.VITE_MAPBOX_PUBLIC_TOKEN ?? ''
