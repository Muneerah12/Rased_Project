import { riyadhWeatherVisual } from '../src/services/weather';

function equal(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
}

equal(riyadhWeatherVisual(0, true), 'sunny', 'Clear daytime weather');
equal(riyadhWeatherVisual(2, true), 'partly-cloudy', 'Partly cloudy daytime weather');
equal(riyadhWeatherVisual(3, true), 'cloudy', 'Cloudy daytime weather');
equal(riyadhWeatherVisual(61, false), 'rainy', 'Rainy weather');
equal(riyadhWeatherVisual(0, false), 'clear-night', 'Clear nighttime weather');
equal(riyadhWeatherVisual(2, false), 'cloudy-night', 'Cloudy nighttime weather');
equal(riyadhWeatherVisual(0, undefined), 'unavailable', 'Missing provider day flag');
equal(riyadhWeatherVisual(undefined, true), 'unavailable', 'Missing provider weather code');

console.log('weather tests passed');
