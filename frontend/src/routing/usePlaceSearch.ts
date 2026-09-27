import { useEffect, useRef, useState } from 'react'
import { retrievePlace, searchPlaces } from '../api/wayawareApi'
import type { PlaceSuggestion, ResolvedPlace } from '../types/api'

export type SearchStatus = 'idle' | 'loading' | 'results' | 'empty' | 'error'

type FieldState = {
  text: string
  place: ResolvedPlace | null
  status: SearchStatus
  suggestions: PlaceSuggestion[]
  attempt: number
}

export type PlaceField = {
  text: string
  place: ResolvedPlace | null
  status: SearchStatus
  suggestions: PlaceSuggestion[]
  setText: (value: string) => void
  select: (suggestion: PlaceSuggestion) => void
  retry: () => void
}

const idleField = (text: string): FieldState => ({
  text,
  place: null,
  status: 'idle',
  suggestions: [],
  attempt: 0,
})

function createToken() {
  return crypto.randomUUID()
}

export function useRoutePlaces() {
  const [origin, setOrigin] = useState<FieldState>(() => idleField('Your location'))
  const [destination, setDestination] = useState<FieldState>(() => idleField(''))
  const originToken = useRef(createToken())
  const destinationToken = useRef(createToken())
  const originTouched = useRef(false)
  const destinationTouched = useRef(false)
  const originSuppress = useRef(false)
  const destinationSuppress = useRef(false)
  const originRequest = useRef(0)
  const destinationRequest = useRef(0)

  usePlaceQuery(origin, setOrigin, originToken, originTouched, originSuppress, originRequest)
  usePlaceQuery(destination, setDestination, destinationToken, destinationTouched, destinationSuppress, destinationRequest)

  const originField = bindField(origin, setOrigin, originToken, originTouched, originSuppress, originRequest)
  const destinationField = bindField(destination, setDestination, destinationToken, destinationTouched, destinationSuppress, destinationRequest)

  function swap() {
    originSuppress.current = true
    destinationSuppress.current = true
    setOrigin(destination)
    setDestination(origin)
    const nextOriginToken = destinationToken.current
    destinationToken.current = originToken.current
    originToken.current = nextOriginToken
    const nextOriginTouched = destinationTouched.current
    destinationTouched.current = originTouched.current
    originTouched.current = nextOriginTouched
  }

  return { origin: originField, destination: destinationField, swap }
}

function usePlaceQuery(
  field: FieldState,
  setField: (value: FieldState | ((current: FieldState) => FieldState)) => void,
  tokenRef: { current: string },
  touchedRef: { current: boolean },
  suppressRef: { current: boolean },
  requestRef: { current: number },
) {
  useEffect(() => {
    if (suppressRef.current) {
      suppressRef.current = false
      return
    }
    if (!touchedRef.current || field.text.trim().length < 2) {
      setField((current) => {
        if (current.suggestions.length === 0 && current.status !== 'loading' && current.status !== 'results' && current.status !== 'empty') {
          return current
        }
        return { ...current, suggestions: [], status: 'idle' }
      })
      return
    }
    const token = tokenRef.current
    setField((current) => ({ ...current, status: 'loading' }))
    const timeout = setTimeout(() => {
      const requestId = ++requestRef.current
      searchPlaces(field.text.trim(), token)
        .then((list) => {
          if (requestId !== requestRef.current || token !== tokenRef.current) return
          setField((current) => ({ ...current, suggestions: list, status: list.length ? 'results' : 'empty' }))
        })
        .catch(() => {
          if (requestId !== requestRef.current || token !== tokenRef.current) return
          setField((current) => ({ ...current, suggestions: [], status: 'error' }))
        })
    }, 300)
    return () => clearTimeout(timeout)
  }, [field.text, field.attempt, setField, tokenRef, touchedRef, suppressRef, requestRef])
}

function bindField(
  field: FieldState,
  setField: (value: FieldState | ((current: FieldState) => FieldState)) => void,
  tokenRef: { current: string },
  touchedRef: { current: boolean },
  suppressRef: { current: boolean },
  requestRef: { current: number },
): PlaceField {
  return {
    text: field.text,
    place: field.place,
    status: field.status,
    suggestions: field.suggestions,
    setText(value: string) {
      touchedRef.current = true
      setField((current) => ({ ...current, text: value, place: null }))
    },
    select(suggestion: PlaceSuggestion) {
      const token = tokenRef.current
      suppressRef.current = true
      touchedRef.current = true
      setField((current) => ({ ...current, text: suggestion.label, suggestions: [], status: 'loading' }))
      const requestId = ++requestRef.current
      retrievePlace(suggestion.mapboxId, token)
        .then((resolved) => {
          if (requestId !== requestRef.current) return
          tokenRef.current = createToken()
          setField((current) => ({ ...current, place: resolved, status: 'idle', suggestions: [] }))
        })
        .catch(() => {
          if (requestId !== requestRef.current) return
          setField((current) => ({ ...current, status: 'error', suggestions: [] }))
        })
    },
    retry() {
      setField((current) => ({ ...current, attempt: current.attempt + 1 }))
    },
  }
}
