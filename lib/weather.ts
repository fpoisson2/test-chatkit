type WeatherToolParams = Record<string, unknown>;

type ResolvedCoordinates = {
  latitude: number;
  longitude: number;
  name: string;
  region?: string | null;
  country?: string | null;
  timezone?: string | null;
};

type WeatherApiResponse = {
  current?: {
    time?: string;
    temperature_2m?: number;
    apparent_temperature?: number;
    relative_humidity_2m?: number;
    weather_code?: number;
    wind_speed_10m?: number;
  } | null;
  timezone?: string;
};

type WeatherResult = {
  location: {
    name: string;
    region?: string | null;
    country?: string | null;
    latitude: number;
    longitude: number;
    timezone?: string | null;
  };
  current: {
    time?: string;
    temperatureCelsius: number | null;
    temperatureFahrenheit: number | null;
    apparentTemperatureCelsius: number | null;
    apparentTemperatureFahrenheit: number | null;
    relativeHumidity: number | null;
    windSpeedKph: number | null;
    weatherCode: number | null;
    description: string | null;
  };
};

const WEATHER_CODE_DESCRIPTIONS: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  56: "Light freezing drizzle",
  57: "Dense freezing drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  66: "Light freezing rain",
  67: "Heavy freezing rain",
  71: "Slight snow fall",
  73: "Moderate snow fall",
  75: "Heavy snow fall",
  77: "Snow grains",
  80: "Slight rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  85: "Slight snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with slight hail",
  99: "Thunderstorm with heavy hail",
};

export async function getWeather(
  params: WeatherToolParams
): Promise<WeatherResult> {
  const coordinates = await resolveCoordinates(params);

  const searchParams = new URLSearchParams({
    latitude: coordinates.latitude.toString(),
    longitude: coordinates.longitude.toString(),
    current:
      "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m",
    temperature_unit: "celsius",
    windspeed_unit: "kmh",
    timezone: "auto",
  });

  const weatherResponse = await fetch(
    `https://api.open-meteo.com/v1/forecast?${searchParams.toString()}`
  );

  if (!weatherResponse.ok) {
    throw new Error("Failed to retrieve weather data");
  }

  const data = (await weatherResponse.json()) as WeatherApiResponse;
  const current = data?.current ?? undefined;

  const temperatureC = normalizeNumber(current?.temperature_2m);
  const apparentC = normalizeNumber(current?.apparent_temperature);

  return {
    location: {
      name: coordinates.name,
      region: coordinates.region ?? null,
      country: coordinates.country ?? null,
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      timezone: coordinates.timezone ?? data?.timezone ?? null,
    },
    current: {
      time: typeof current?.time === "string" ? current?.time : undefined,
      temperatureCelsius: temperatureC,
      temperatureFahrenheit: convertToFahrenheit(temperatureC),
      apparentTemperatureCelsius: apparentC,
      apparentTemperatureFahrenheit: convertToFahrenheit(apparentC),
      relativeHumidity: normalizeNumber(current?.relative_humidity_2m),
      windSpeedKph: normalizeNumber(current?.wind_speed_10m),
      weatherCode: normalizeNumber(current?.weather_code),
      description:
        typeof current?.weather_code === "number"
          ? WEATHER_CODE_DESCRIPTIONS[current.weather_code] ?? null
          : null,
    },
  };
}

async function resolveCoordinates(
  params: WeatherToolParams
): Promise<ResolvedCoordinates> {
  const latitude = toNumber(params.latitude ?? params.lat);
  const longitude = toNumber(params.longitude ?? params.lon ?? params.lng);

  if (typeof latitude === "number" && typeof longitude === "number") {
    const name = inferNameFromParams(params) ?? "Provided coordinates";
    return { latitude, longitude, name };
  }

  const location = inferLocationName(params);
  if (!location) {
    throw new Error("A location name or coordinates are required.");
  }

  const geocodeParams = new URLSearchParams({
    name: location,
    count: "1",
    language: "en",
    format: "json",
  });

  const geocodeResponse = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?${geocodeParams.toString()}`
  );

  if (!geocodeResponse.ok) {
    throw new Error("Failed to look up the requested location.");
  }

  const payload = (await geocodeResponse.json()) as {
    results?: Array<{
      name?: string;
      latitude?: number;
      longitude?: number;
      country?: string;
      timezone?: string;
      admin1?: string;
    }>;
  };

  const [first] = payload.results ?? [];
  if (!first || typeof first.latitude !== "number" || typeof first.longitude !== "number") {
    throw new Error(`Unable to locate "${location}".`);
  }

  return {
    latitude: first.latitude,
    longitude: first.longitude,
    name: first.name ?? location,
    region: first.admin1 ?? null,
    country: first.country ?? null,
    timezone: first.timezone ?? null,
  };
}

function convertToFahrenheit(value: number | null): number | null {
  if (typeof value === "number") {
    return Math.round((value * 9) / 5 + 32);
  }
  return null;
}

function normalizeNumber(value: unknown): number | null {
  const numberValue = typeof value === "number" ? value : toNumber(value);
  return typeof numberValue === "number" && Number.isFinite(numberValue)
    ? Math.round(numberValue * 10) / 10
    : null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function inferLocationName(params: WeatherToolParams): string | null {
  const candidates = [
    params.location,
    params.city,
    params.query,
    params.place,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}

function inferNameFromParams(params: WeatherToolParams): string | null {
  const candidate = inferLocationName(params);
  if (candidate) {
    return candidate;
  }
  if (typeof params.label === "string" && params.label.trim()) {
    return params.label.trim();
  }
  return null;
}
