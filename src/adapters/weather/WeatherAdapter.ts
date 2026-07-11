/**
 * WeatherAdapter：天气适配器。
 * 对应架构计划第 5.3 节天气部分。
 *
 * 设计：
 * - 只读，不修改任何状态
 * - 用户可关闭
 * - 首次使用需明确联网授权
 * - 只发送城市或用户配置的位置
 * - 请求失败时显示"天气暂时不可用"
 * - 缓存最近成功结果并标注更新时间
 * - 不把天气实现成通用网络搜索技能
 *
 * 使用 Open-Meteo 免费 API（无需 API Key）：
 * - Geocoding: https://geocoding-api.open-meteo.com/v1/search?name={city}&count=1&language=zh
 * - Weather: https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current=temperature_2m,weather_code
 */
import { createLogger } from '../../infrastructure/logging/logger';

const log = createLogger('WeatherAdapter');

/** 天气快照 */
export interface WeatherSnapshot {
  city: string;
  temperatureC: number;
  description: string;
  updatedAt: string;
  /** 是否来自缓存 */
  fromCache: boolean;
}

/** 天气适配器接口 */
export interface WeatherAdapter {
  /** 获取天气。优先返回缓存。 */
  getWeather(city: string): Promise<WeatherSnapshot | null>;
  /** 是否已授权联网 */
  isAuthorized(): boolean;
  /** 授权 */
  authorize(): void;
  /** 是否已启用 */
  isEnabled(): boolean;
}

/** 可注入的 fetch 函数 */
export type WeatherFetchFn = (url: string, options?: { timeoutMs?: number }) => Promise<Response>;

/** Open-Meteo Geocoding API 响应 */
interface GeocodingResponse {
  results?: Array<{
    latitude: number;
    longitude: number;
    name: string;
    country?: string;
  }>;
}

/** Open-Meteo Forecast API 响应 */
interface ForecastResponse {
  current?: {
    temperature_2m: number;
    weather_code: number;
  };
}

/** WMO weather code → 中文描述 */
function describeWeatherCode(code: number): string {
  if (code === 0) return '晴';
  if (code <= 3) return '多云';
  if (code <= 48) return '雾';
  if (code <= 67) return '小雨';
  if (code <= 77) return '雪';
  if (code <= 82) return '阵雨';
  if (code <= 86) return '阵雪';
  if (code >= 95) return '雷阵雨';
  return '阴';
}

/** 默认天气适配器实现（带缓存 + Open-Meteo API） */
export class DefaultWeatherAdapter implements WeatherAdapter {
  private authorized = false;
  private enabled = true;
  private cache: Map<string, { snapshot: WeatherSnapshot; cachedAt: number }> = new Map();
  private fetchFn: WeatherFetchFn;
  /** 缓存有效期 30 分钟 */
  private readonly cacheTtlMs = 30 * 60 * 1000;
  /** 请求超时 10 秒 */
  private readonly timeoutMs = 10000;
  /** Geocoding API */
  private readonly geocodingUrl = 'https://geocoding-api.open-meteo.com/v1/search';
  /** Forecast API */
  private readonly forecastUrl = 'https://api.open-meteo.com/v1/forecast';

  constructor(fetchFn?: WeatherFetchFn) {
    this.fetchFn = fetchFn ?? ((url, options) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options?.timeoutMs ?? 10000);
      return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
    });
  }

  isAuthorized(): boolean {
    return this.authorized;
  }

  authorize(): void {
    this.authorized = true;
    log.info('weather adapter authorized');
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** 更新设置（从 settings 同步） */
  updateSettings(enabled: boolean, authorized: boolean): void {
    this.enabled = enabled;
    this.authorized = authorized;
    log.info('weather adapter settings updated', {
      fields: { enabled, authorized }
    });
  }

  async getWeather(city: string): Promise<WeatherSnapshot | null> {
    if (!this.enabled) {
      return null;
    }

    // 检查缓存
    const cached = this.cache.get(city);
    if (cached && Date.now() - cached.cachedAt < this.cacheTtlMs) {
      log.debug('returning cached weather', { fields: { city } });
      return { ...cached.snapshot, fromCache: true };
    }

    if (!this.authorized) {
      log.warn('weather not authorized, skipping fetch');
      return null;
    }

    try {
      const snapshot = await this.fetchWeather(city);
      if (snapshot) {
        this.cache.set(city, { snapshot, cachedAt: Date.now() });
        return snapshot;
      }
      return null;
    } catch (error) {
      log.warn('weather fetch failed, trying stale cache', {
        fields: { city, error: (error as Error)?.message }
      });
      // 请求失败时返回最近缓存并标注更新时间
      if (cached) {
        log.info('returning stale cache after fetch failure', {
          fields: { city, cachedAt: new Date(cached.cachedAt).toISOString() }
        });
        return { ...cached.snapshot, fromCache: true };
      }
      return null;
    }
  }

  /**
   * 实际请求天气 API（Open-Meteo）。
   * 1. 城市名 → geocoding → 经纬度
   * 2. 经纬度 → forecast → 天气数据
   */
  private async fetchWeather(city: string): Promise<WeatherSnapshot | null> {
    // Step 1: Geocoding
    const geoUrl = `${this.geocodingUrl}?name=${encodeURIComponent(city)}&count=1&language=zh&format=json`;
    log.info('geocoding city', { fields: { city } });

    const geoResp = await this.fetchFn(geoUrl, { timeoutMs: this.timeoutMs });
    if (!geoResp.ok) {
      throw new Error(`Geocoding API returned ${geoResp.status}`);
    }
    const geoData = (await geoResp.json()) as GeocodingResponse;
    if (!geoData.results || geoData.results.length === 0) {
      log.warn('city not found in geocoding', { fields: { city } });
      return null;
    }

    const { latitude, longitude, name } = geoData.results[0];

    // Step 2: Forecast
    const forecastUrl = `${this.forecastUrl}?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code`;
    log.info('fetching weather', { fields: { city, lat: latitude, lon: longitude } });

    const resp = await this.fetchFn(forecastUrl, { timeoutMs: this.timeoutMs });
    if (!resp.ok) {
      throw new Error(`Forecast API returned ${resp.status}`);
    }
    const data = (await resp.json()) as ForecastResponse;
    if (!data.current) {
      throw new Error('Forecast API returned no current weather data');
    }

    const temperatureC = Math.round(data.current.temperature_2m);
    const description = describeWeatherCode(data.current.weather_code);

    log.info('weather fetched', {
      fields: { city: name, temp: temperatureC, description }
    });

    return {
      city: name || city,
      temperatureC,
      description,
      updatedAt: new Date().toISOString(),
      fromCache: false
    };
  }

  /** 清除缓存 */
  clearCache(): void {
    this.cache.clear();
  }
}
