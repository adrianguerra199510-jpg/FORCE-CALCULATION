// Disposiciones propias del Reglamento de Diseño Estructural de Panamá REP-2021
// (Resolución JTIA-020-2022, Gaceta Oficial 29594-A).

export const REP = {
  name: 'REP-2021',
  baseStandard: 'ASCE/SEI 7-05',

  // §4.2 Tabla 4.1 – Velocidad básica de viento (ráfaga de 3 s, 10 m, exposición C), km/h
  WIND_SPEEDS: {
    10: { Pacifico: 104.0, Atlantico: 121.0 },
    20: { Pacifico: 113.0, Atlantico: 133.9 },
    50: { Pacifico: 124.9, Atlantico: 150.8 },
    100: { Pacifico: 133.9, Atlantico: 163.4 },
  },
  WIND_DESIGN_RETURN: 50, // diseño y deformaciones
  WIND_SERVICE_RETURN: 10, // aceleraciones en servicio
  WIND_SERVICE_DAMPING: 0.02, // T > 1 s, edificios de concreto o acero

  // §4.3 límites bajo viento (cargas sin mayorar)
  DRIFT_TOP: 1 / 400,
  DRIFT_STORY: 1 / 300,
  ACCEL_MAX: 0.2, // m/s²

  // §5.2.1 cortante basal mínimo: Cs ≥ 0.044·SDS·I y ≥ 0.01 (edificios) / ≥ 0.03 (no-edificios no similares)
  CS_MIN_FACTOR: 0.044,
  CS_MIN_BUILDING: 0.01,
  CS_MIN_NONBUILDING: 0.03,

  // §5.13 período de transición de período largo
  TL: 10,
};

export function basicWindSpeed(region, returnPeriod) {
  const row = REP.WIND_SPEEDS[returnPeriod];
  if (!row) throw new Error(`Período de retorno no tabulado: ${returnPeriod}`);
  const kmh = row[region];
  return { kmh, ms: kmh / 3.6 };
}

export const REFERENCES = {
  wind: [
    'REP-2021 Cap. 4 – Cargas de viento (§4.1 procedimiento, §4.2 Tabla 4.1, §4.3 límites).',
    'ASCE/SEI 7-05 Cap. 6 – Método 2 (procedimiento analítico), excepto Fig. 6-1.',
  ],
  seismic: [
    'REP-2021 Cap. 5 – Requisitos de diseño sísmico (§5.2.1 Cs mínimo, §5.12 mapas, §5.13 TL = 10 s).',
    'ASCE/SEI 7-05 Cap. 11 (criterios), Cap. 12 (edificios) y Cap. 15 (estructuras no-edificio).',
    'Mapas de aceleraciones espectrales Ss y S1 (Clase de sitio B, 5% amortiguamiento) – REP-2014 MAPAS, JTIA.',
  ],
};
