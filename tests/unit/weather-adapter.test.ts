/**
 * DefaultWeatherAdapter 直接测试。
 * 验证 Open-Meteo 集成、缓存、授权和错误处理。
 *
 * 测试场景：
 *   1. 未授权时返回 null
 *   2. 已禁用时返回 null
 *   3. Geocoding 成功 + Forecast 成功
 *   4. 城市不存在（geocoding 返回空 results）
 *   5. HTTP 错误（geocoding 返回 500）
 *   6. 缓存命中（第二次请求不调用 fetch）
 *   7. 过期缓存回退（fetch 失败后返回旧缓存）
 *
 * 运行：npx tsx tests/unit/weather-adapter.test.ts
 */
import { DefaultWeatherAdapter } from '../../src/adapters/weather/WeatherAdapter';
import type { WeatherFetchFn } from '../../src/adapters/weather/WeatherAdapter';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, condition: boolean): void {
  if (condition) {
    pass++;
    console.log(`PASS ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.error(`FAIL ${name}`);
  }
}

/** 创建 mock fetch：根据 URL 返回不同的 mock 响应 */
function createMockFetch(
  geoResponse: { ok: boolean; status: number; json: () => Promise<unknown> },
  forecastResponse: { ok: boolean; status: number; json: () => Promise<unknown> }
): { fetchFn: WeatherFetchFn; callCount: { geo: number; forecast: number } } {
  const callCount = { geo: 0, forecast: 0 };
  const fetchFn: WeatherFetchFn = async (url: string) => {
    if (url.includes('geocoding-api')) {
      callCount.geo++;
      return geoResponse as unknown as Response;
    }
    if (url.includes('api.open-meteo.com/v1/forecast')) {
      callCount.forecast++;
      return forecastResponse as unknown as Response;
    }
    return { ok: false, status: 404, json: async () => null } as unknown as Response;
  };
  return { fetchFn, callCount };
}

/** 创建成功响应 */
function successGeo(lat: number = 39.9, lon: number = 116.4, name: string = '北京') {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      results: [{ latitude: lat, longitude: lon, name, country: 'China' }]
    })
  };
}

function successForecast(temp: number = 25, code: number = 0) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      current: { temperature_2m: temp, weather_code: code }
    })
  };
}

// ===== 测试 1：未授权时返回 null =====
async function testNotAuthorized(): Promise<void> {
  const { fetchFn, callCount } = createMockFetch(successGeo(), successForecast());
  const adapter = new DefaultWeatherAdapter(fetchFn);
  adapter.updateSettings(true, false); // enabled=true, authorized=false

  const result = await adapter.getWeather('北京');
  check('NotAuth: returns null when not authorized', result === null);
  check('NotAuth: no API calls made', callCount.geo === 0);
}

// ===== 测试 2：已禁用时返回 null =====
async function testDisabled(): Promise<void> {
  const { fetchFn, callCount } = createMockFetch(successGeo(), successForecast());
  const adapter = new DefaultWeatherAdapter(fetchFn);
  adapter.updateSettings(false, true); // enabled=false, authorized=true

  const result = await adapter.getWeather('北京');
  check('Disabled: returns null when disabled', result === null);
  check('Disabled: no API calls made', callCount.geo === 0);
}

// ===== 测试 3：Geocoding + Forecast 成功 =====
async function testSuccess(): Promise<void> {
  const { fetchFn, callCount } = createMockFetch(successGeo(), successForecast(25, 0));
  const adapter = new DefaultWeatherAdapter(fetchFn);
  adapter.updateSettings(true, true);

  const result = await adapter.getWeather('北京');
  check('Success: returns snapshot', result !== null);
  check('Success: city name correct', result?.city === '北京');
  check('Success: temperature correct', result?.temperatureC === 25);
  check('Success: description correct', result?.description === '晴');
  check('Success: not from cache', result?.fromCache === false);
  check('Success: geocoding called once', callCount.geo === 1);
  check('Success: forecast called once', callCount.forecast === 1);
}

// ===== 测试 4：城市不存在 =====
async function testCityNotFound(): Promise<void> {
  const emptyGeo = {
    ok: true,
    status: 200,
    json: async () => ({ results: [] })
  };
  const { fetchFn, callCount } = createMockFetch(emptyGeo, successForecast());
  const adapter = new DefaultWeatherAdapter(fetchFn);
  adapter.updateSettings(true, true);

  const result = await adapter.getWeather('不存在的城市名');
  check('CityNotFound: returns null', result === null);
  check('CityNotFound: geocoding called', callCount.geo === 1);
  check('CityNotFound: forecast not called', callCount.forecast === 0);
}

// ===== 测试 5：HTTP 错误 =====
async function testHttpError(): Promise<void> {
  const errorGeo = {
    ok: false,
    status: 500,
    json: async () => null
  };
  const { fetchFn } = createMockFetch(errorGeo, successForecast());
  const adapter = new DefaultWeatherAdapter(fetchFn);
  adapter.updateSettings(true, true);

  const result = await adapter.getWeather('北京');
  check('HttpError: returns null on 500 error', result === null);
}

// ===== 测试 6：缓存命中 =====
async function testCacheHit(): Promise<void> {
  const { fetchFn, callCount } = createMockFetch(successGeo(), successForecast(25, 0));
  const adapter = new DefaultWeatherAdapter(fetchFn);
  adapter.updateSettings(true, true);

  // 第一次请求：实际调用 API
  const result1 = await adapter.getWeather('北京');
  check('CacheHit: first request succeeds', result1 !== null);
  check('CacheHit: first request not from cache', result1?.fromCache === false);
  check('CacheHit: geocoding called once after first', callCount.geo === 1);

  // 第二次请求：应从缓存返回
  const result2 = await adapter.getWeather('北京');
  check('CacheHit: second request returns cached data', result2 !== null);
  check('CacheHit: second request from cache', result2?.fromCache === true);
  check('CacheHit: temperature matches cache', result2?.temperatureC === 25);
  check('CacheHit: no additional API calls', callCount.geo === 1);
}

// ===== 测试 7：过期缓存回退 =====
async function testStaleCacheFallback(): Promise<void> {
  const successFetch = createMockFetch(successGeo(), successForecast(25, 0));
  const errorFetch = createMockFetch(
    { ok: false, status: 500, json: async () => null },
    successForecast()
  );

  // 用成功 fetch 初始化并获取一次
  const adapter = new DefaultWeatherAdapter(successFetch.fetchFn);
  adapter.updateSettings(true, true);
  const result1 = await adapter.getWeather('北京');
  check('StaleCache: initial fetch succeeds', result1 !== null);
  check('StaleCache: initial temperature is 25', result1?.temperatureC === 25);

  // 切换到失败的 fetch，清除缓存 TTL 使其过期
  // 直接操作内部缓存：用 (adapter as any) 模拟过期
  const internal = adapter as unknown as {
    cache: Map<string, { snapshot: unknown; cachedAt: number }>;
    cacheTtlMs: number;
  };
  // 将缓存时间设置为很久以前，模拟过期
  for (const entry of internal.cache.values()) {
    entry.cachedAt = Date.now() - internal.cacheTtlMs - 1000;
  }

  // 替换 fetchFn 为失败版本
  const adapterWithFailingFetch = adapter as unknown as { fetchFn: WeatherFetchFn };
  adapterWithFailingFetch.fetchFn = errorFetch.fetchFn;

  // 请求应失败但返回过期缓存
  const result2 = await adapter.getWeather('北京');
  check('StaleCache: returns stale cache on fetch failure', result2 !== null);
  check('StaleCache: stale result is from cache', result2?.fromCache === true);
  check('StaleCache: stale temperature matches original', result2?.temperatureC === 25);
}

// ===== 主函数 =====
async function main(): Promise<void> {
  console.log('=== WeatherAdapter Tests ===\n');

  await testNotAuthorized();
  console.log('');
  await testDisabled();
  console.log('');
  await testSuccess();
  console.log('');
  await testCityNotFound();
  console.log('');
  await testHttpError();
  console.log('');
  await testCacheHit();
  console.log('');
  await testStaleCacheFallback();

  console.log('\n=== Summary ===');
  console.log(`PASS: ${pass}`);
  console.log(`FAIL: ${fail}`);
  if (failures.length > 0) {
    console.log('Failures:');
    failures.forEach(f => console.log(`  - ${f}`));
    process.exit(1);
  }
  console.log('All weather adapter tests passed!');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
