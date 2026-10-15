import { useEffect, useState } from 'react'

type WeatherReading = {
  temperature: number
  observedAt: string
  weatherCode?: number
  isDay?: boolean
  humidity?: number
  windSpeed?: number
  windDirection?: number
}
type WeatherResponse = { current?: {
  temperature_2m?: number
  time?: string
  weather_code?: number
  is_day?: number
  relative_humidity_2m?: number
  wind_speed_10m?: number
  wind_direction_10m?: number
} }

const weatherUrl = 'https://api.open-meteo.com/v1/forecast?latitude=24.7136&longitude=46.6753&current=temperature_2m%2Crelative_humidity_2m%2Cwind_speed_10m%2Cwind_direction_10m%2Cweather_code%2Cis_day&temperature_unit=celsius&wind_speed_unit=kmh&timezone=Asia%2FRiyadh'
const refreshInterval = 10 * 60_000

type WeatherVisualState = 'clear' | 'partly-cloudy' | 'cloudy' | 'rain' | 'storm' | 'fog' | 'snow' | 'night' | 'night-cloudy' | 'unavailable'

function weatherCondition(code: number | undefined, isDay: boolean | undefined) {
  if (code === undefined) return { label: 'Weather condition unavailable', visual: 'unavailable' as WeatherVisualState, night: false }
  switch (code) {
    case 0: return isDay === false ? { label: 'Clear night', visual: 'night' as const, night: true } : { label: 'Clear', visual: 'clear' as const, night: false }
    case 1: return isDay === false ? { label: 'Mainly clear night', visual: 'night' as const, night: true } : { label: 'Mainly clear', visual: 'clear' as const, night: false }
    case 2: return { label: 'Partly cloudy', visual: (isDay === false ? 'night-cloudy' : 'partly-cloudy') as WeatherVisualState, night: isDay === false }
    case 3: return { label: 'Overcast', visual: 'cloudy' as const, night: isDay === false }
    case 45: case 48: return { label: 'Fog', visual: 'fog' as const, night: isDay === false }
    case 51: case 53: case 55: return { label: 'Drizzle', visual: 'rain' as const, night: isDay === false }
    case 56: case 57: return { label: 'Freezing drizzle', visual: 'rain' as const, night: isDay === false }
    case 61: case 63: case 65: return { label: 'Rain', visual: 'rain' as const, night: isDay === false }
    case 66: case 67: return { label: 'Freezing rain', visual: 'rain' as const, night: isDay === false }
    case 80: case 81: case 82: return { label: 'Rain showers', visual: 'rain' as const, night: isDay === false }
    case 71: case 73: case 75: case 77: case 85: case 86: return { label: 'Snow', visual: 'snow' as const, night: isDay === false }
    case 95: case 96: case 99: return { label: 'Thunderstorm', visual: 'storm' as const, night: isDay === false }
    default: return { label: 'Weather condition unavailable', visual: 'unavailable' as const, night: false }
  }
}

function compassDirection(degrees: number) {
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(degrees / 45) % 8]
}

function WeatherArtwork({ state, night }: { state: WeatherVisualState; night: boolean }) {
  return <svg viewBox="0 0 180 100" aria-hidden="true" focusable="false">
    {(state === 'clear' || state === 'partly-cloudy') && <g className="weather-sun-art"><circle className="weather-sun-halo" cx="120" cy="36" r="29" /><circle className="weather-sun-core" cx="120" cy="36" r="17" />{Array.from({ length: 8 }, (_, index) => <line key={index} x1="120" y1="7" x2="120" y2="13" transform={`rotate(${index * 45} 120 36)`} />)}</g>}
    {night && <g className="weather-moon-art"><path d="M128 14a22 22 0 1 0 20 34 19 19 0 0 1-20-34Z" /><circle cx="97" cy="24" r="1.5" /><circle cx="151" cy="52" r="1.2" /></g>}
    {['cloudy', 'partly-cloudy', 'rain', 'storm', 'snow', 'night-cloudy'].includes(state) && <path className="weather-cloud-back" d="M37 62c-8 0-14-6-14-14s6-14 14-14c3-13 15-22 28-22 15 0 27 11 29 25 12 0 21 9 21 21 0 2 0 3-1 4Z" />}
    {['cloudy', 'partly-cloudy', 'rain', 'storm', 'snow', 'night-cloudy'].includes(state) && <path className="weather-cloud-front" d="M23 72c-10 0-18-8-18-18s8-18 18-18c4-15 17-25 33-25 17 0 31 12 33 28 14 0 25 11 25 25 0 3 0 6-1 8Z" />}
    {state === 'rain' && <g className="weather-rain-art"><path d="m31 79-5 10m27-10-5 10m27-10-5 10m27-10-5 10" /></g>}
    {state === 'storm' && <><path className="weather-lightning" d="m61 70-11 17h10l-4 12 18-21H63l7-8Z" /><path className="weather-rain-art" d="m35 79-4 8m56-8-4 8" /></>}
    {state === 'snow' && <g className="weather-snow-art"><circle cx="31" cy="84" r="2.5" /><circle cx="58" cy="91" r="2" /><circle cx="85" cy="83" r="2.5" /><circle cx="105" cy="92" r="1.8" /></g>}
    {state === 'fog' && <g className="weather-fog-art"><path d="M22 38h125M10 53h145M25 68h120M39 83h98" /></g>}
    {state === 'unavailable' && <path className="weather-cloud-front" d="M23 72c-10 0-18-8-18-18s8-18 18-18c4-15 17-25 33-25 17 0 31 12 33 28 14 0 25 11 25 25 0 3 0 6-1 8Z" />}
  </svg>
}

export function RiyadhWeather() {
  const [weather, setWeather] = useState<WeatherReading | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [stale, setStale] = useState(false)

  useEffect(() => {
    let inFlight = false
    let active = true
    let controller: AbortController | undefined
    const refresh = async () => {
      if (inFlight) return
      inFlight = true
      controller = new AbortController()
      try {
        const response = await fetch(weatherUrl, { signal: controller.signal })
        if (!response.ok) throw new Error('Weather request failed')
        const payload = await response.json() as WeatherResponse
        const current = payload.current
        const temperature = current?.temperature_2m
        const observedAt = current?.time
        if (!Number.isFinite(temperature) || typeof observedAt !== 'string' || !Number.isFinite(Date.parse(`${observedAt}+03:00`))) throw new Error('Weather response was invalid')
        const weatherCode = Number.isInteger(current?.weather_code) ? current?.weather_code : undefined
        const humidity = Number.isFinite(current?.relative_humidity_2m) && current!.relative_humidity_2m! >= 0 && current!.relative_humidity_2m! <= 100 ? current!.relative_humidity_2m : undefined
        const windSpeed = Number.isFinite(current?.wind_speed_10m) && current!.wind_speed_10m! >= 0 ? current!.wind_speed_10m : undefined
        const windDirection = Number.isFinite(current?.wind_direction_10m) && current!.wind_direction_10m! >= 0 && current!.wind_direction_10m! <= 360 ? current!.wind_direction_10m : undefined
        if (active) {
          setWeather({ temperature: temperature as number, observedAt, weatherCode, isDay: current?.is_day === 0 ? false : current?.is_day === 1 ? true : undefined, humidity, windSpeed, windDirection })
          setError(false); setStale(false)
        }
      } catch {
        if (active && !controller.signal.aborted) { setError(true); setStale(true) }
      } finally {
        inFlight = false
        if (active) setLoading(false)
      }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), refreshInterval)
    return () => { active = false; window.clearInterval(timer); controller?.abort() }
  }, [])

  useEffect(() => {
    if (!weather) return
    const checkFreshness = () => {
      if (Date.now() - Date.parse(`${weather.observedAt}+03:00`) > 30 * 60_000) setStale(true)
    }
    checkFreshness()
    const timer = window.setInterval(checkFreshness, 60_000)
    return () => window.clearInterval(timer)
  }, [weather])
  const condition = weatherCondition(weather?.weatherCode, weather?.isDay)
  return <section className="riyadh-weather" aria-label="External Riyadh weather" aria-busy={loading}>
    <div className="weather-heading"><div><p className="eyebrow">EXTERNAL WEATHER</p><h2>Riyadh</h2></div><span className={`weather-state ${stale ? 'weather-stale' : ''}`}>{stale ? 'STALE' : weather ? 'OUTDOOR' : 'EXTERNAL'}</span></div>
    <div className="weather-current-reading">
      {weather ? <strong className="weather-temperature">{weather.temperature.toFixed(1)}<small>°C</small></strong> : <strong className="weather-temperature weather-placeholder">{loading ? 'Loading…' : '—'}</strong>}
      <span className="weather-label">Outdoor temperature</span>
    </div>
    <div className={`weather-condition-visual weather-visual-${condition.visual}${condition.night ? ' weather-night' : ''}`} role="img" aria-label={`Current Riyadh weather: ${condition.label}`}>
      <WeatherArtwork state={condition.visual} night={condition.night} />
      <strong>{condition.label}</strong>
    </div>
    {(weather?.humidity !== undefined || weather?.windSpeed !== undefined || weather?.windDirection !== undefined) && <div className="weather-observations">
      {weather?.humidity !== undefined && <div><span>Humidity</span><strong>{weather.humidity}%</strong></div>}
      {(weather?.windSpeed !== undefined || weather?.windDirection !== undefined) && <div><span>Wind</span><strong>{weather.windSpeed !== undefined ? `${weather.windSpeed.toFixed(0)} km/h` : ''}{weather.windSpeed !== undefined && weather.windDirection !== undefined ? ' · ' : ''}{weather.windDirection !== undefined ? compassDirection(weather.windDirection) : ''}</strong></div>}
    </div>}
    <p className="weather-meta">{weather ? `Observed ${new Date(`${weather.observedAt}+03:00`).toLocaleString([], { timeZone: 'Asia/Riyadh', dateStyle: 'medium', timeStyle: 'short' })} · Open-Meteo` : error ? 'Weather unavailable · Open-Meteo' : 'Source · Open-Meteo'}</p>
    {error && weather && <p className="weather-error" role="status">Latest refresh failed; showing the last observation.</p>}
    {error && !weather && !loading && <p className="weather-error" role="status">Weather unavailable</p>}
  </section>
}
