/** Public, read-only Open-Meteo weather client for the Riyadh overview card. */

export interface RiyadhWeather {
  temperature: number;
  humidity: number;
  /** Open-Meteo local time in Asia/Riyadh, without an offset. */
  observedAt: string;
  /** Open-Meteo WMO weather interpretation code. */
  weatherCode?: number;
  /** Open-Meteo day flag. This is the only day/night source used by the UI. */
  isDay?: boolean;
}

export type RiyadhWeatherVisual = 'sunny' | 'partly-cloudy' | 'cloudy' | 'rainy' | 'clear-night' | 'cloudy-night' | 'unavailable';

/**
 * Converts the provider's WMO code into the small set of visuals used by RASID.
 * A visual is deliberately unavailable unless Open-Meteo also supplied its
 * explicit day flag; the client never infers day/night from its own clock.
 */
export function riyadhWeatherVisual(weatherCode: number | undefined, isDay: boolean | undefined): RiyadhWeatherVisual {
  if (!Number.isInteger(weatherCode) || isDay === undefined) return 'unavailable';
  const code = weatherCode as number;
  if (code === 0 || code === 1) return isDay ? 'sunny' : 'clear-night';
  if (code === 2) return isDay ? 'partly-cloudy' : 'cloudy-night';
  if (code === 3 || code === 45 || code === 48) return isDay ? 'cloudy' : 'cloudy-night';
  if (
    (code >= 51 && code <= 57)
    || (code >= 61 && code <= 67)
    || (code >= 80 && code <= 82)
    || (code >= 95 && code <= 99)
  ) return 'rainy';
  return 'unavailable';
}

type OpenMeteoResponse = {
  current?: {
    temperature_2m?: unknown;
    relative_humidity_2m?: unknown;
    weather_code?: unknown;
    is_day?: unknown;
    time?: unknown;
  };
};

const RIYADH_OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast?latitude=24.7136&longitude=46.6753&current=temperature_2m%2Crelative_humidity_2m%2Cweather_code%2Cis_day&temperature_unit=celsius&timezone=Asia%2FRiyadh';

export async function fetchRiyadhWeather(signal?: AbortSignal): Promise<RiyadhWeather> {
  const response = await fetch(RIYADH_OPEN_METEO_URL, { signal });
  if (!response.ok) throw new Error('Weather request failed');
  const payload = await response.json() as OpenMeteoResponse;
  const current = payload.current;
  const temperature = current?.temperature_2m;
  const humidity = current?.relative_humidity_2m;
  const observedAt = current?.time;
  if (
    typeof temperature !== 'number'
    || !Number.isFinite(temperature)
    || typeof humidity !== 'number'
    || !Number.isFinite(humidity)
    || humidity < 0
    || humidity > 100
    || typeof observedAt !== 'string'
    || Number.isNaN(Date.parse(`${observedAt}+03:00`))
  ) {
    throw new Error('Weather response was invalid');
  }
  const weatherCode = typeof current?.weather_code === 'number' && Number.isInteger(current.weather_code)
    ? current.weather_code
    : undefined;
  const isDay = current?.is_day === 1 ? true : current?.is_day === 0 ? false : undefined;
  return { temperature, humidity, observedAt, weatherCode, isDay };
}
