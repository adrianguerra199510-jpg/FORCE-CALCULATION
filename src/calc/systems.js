// ASCE 7-05 Tabla 12.2-1 (edificios) y Tabla 15.4-2 (no-edificios no similares a edificios).
// np: categorías de diseño sísmico donde el sistema NO está permitido (NP) según la tabla.

export const BUILDING_SYSTEMS = [
  // A. Muros de carga
  { id: 'A1', group: 'A. Muros de carga', label: 'Muros de cortante especiales de concreto reforzado', R: 5, Omega0: 2.5, Cd: 5, periodType: 'other' },
  { id: 'A2', group: 'A. Muros de carga', label: 'Muros de cortante ordinarios de concreto reforzado', R: 4, Omega0: 2.5, Cd: 4, periodType: 'other', np: ['D', 'E', 'F'] },
  { id: 'A9', group: 'A. Muros de carga', label: 'Muros de mampostería reforzada especiales', R: 5, Omega0: 2.5, Cd: 3.5, periodType: 'other' },
  { id: 'A10', group: 'A. Muros de carga', label: 'Muros de mampostería reforzada intermedios', R: 3.5, Omega0: 2.5, Cd: 2.25, periodType: 'other', np: ['D', 'E', 'F'] },
  { id: 'A11', group: 'A. Muros de carga', label: 'Muros de mampostería reforzada ordinarios', R: 2, Omega0: 2.5, Cd: 1.75, periodType: 'other', np: ['D', 'E', 'F'] },
  // B. Sistemas de pórtico de edificación
  { id: 'B1', group: 'B. Pórtico de edificación', label: 'Pórticos de acero con arriostramiento excéntrico (conexiones a momento)', R: 8, Omega0: 2, Cd: 4, periodType: 'steelEBF' },
  { id: 'B2', group: 'B. Pórtico de edificación', label: 'Pórticos de acero con arriostramiento excéntrico (conexiones sin momento)', R: 7, Omega0: 2, Cd: 4, periodType: 'steelEBF' },
  { id: 'B3', group: 'B. Pórtico de edificación', label: 'Pórticos de acero especiales arriostrados concéntricamente', R: 6, Omega0: 2, Cd: 5, periodType: 'other' },
  { id: 'B4', group: 'B. Pórtico de edificación', label: 'Pórticos de acero ordinarios arriostrados concéntricamente', R: 3.25, Omega0: 2, Cd: 3.25, periodType: 'other' },
  { id: 'B5', group: 'B. Pórtico de edificación', label: 'Muros de cortante especiales de concreto reforzado', R: 6, Omega0: 2.5, Cd: 5, periodType: 'other' },
  { id: 'B6', group: 'B. Pórtico de edificación', label: 'Muros de cortante ordinarios de concreto reforzado', R: 5, Omega0: 2.5, Cd: 4.5, periodType: 'other', np: ['D', 'E', 'F'] },
  { id: 'B25', group: 'B. Pórtico de edificación', label: 'Pórticos con riostras de pandeo restringido (BRBF), sin momento', R: 7, Omega0: 2, Cd: 5.5, periodType: 'steelEBF' },
  { id: 'B26', group: 'B. Pórtico de edificación', label: 'Pórticos con riostras de pandeo restringido (BRBF), con momento', R: 8, Omega0: 2.5, Cd: 5, periodType: 'steelEBF' },
  { id: 'B27', group: 'B. Pórtico de edificación', label: 'Muros especiales de placa de acero', R: 7, Omega0: 2, Cd: 6, periodType: 'other' },
  // C. Pórticos resistentes a momento
  { id: 'C1', group: 'C. Pórticos resistentes a momento', label: 'Pórticos especiales de acero resistentes a momento (SMF)', R: 8, Omega0: 3, Cd: 5.5, periodType: 'steelMRF' },
  { id: 'C2', group: 'C. Pórticos resistentes a momento', label: 'Pórticos especiales de acero con armaduras (STMF)', R: 7, Omega0: 3, Cd: 5.5, periodType: 'steelMRF' },
  { id: 'C3', group: 'C. Pórticos resistentes a momento', label: 'Pórticos intermedios de acero resistentes a momento (IMF)', R: 4.5, Omega0: 3, Cd: 4, periodType: 'steelMRF' },
  { id: 'C4', group: 'C. Pórticos resistentes a momento', label: 'Pórticos ordinarios de acero resistentes a momento (OMF)', R: 3.5, Omega0: 3, Cd: 3, periodType: 'steelMRF' },
  { id: 'C5', group: 'C. Pórticos resistentes a momento', label: 'Pórticos especiales de concreto reforzado resistentes a momento', R: 8, Omega0: 3, Cd: 5.5, periodType: 'concreteMRF' },
  { id: 'C6', group: 'C. Pórticos resistentes a momento', label: 'Pórticos intermedios de concreto reforzado resistentes a momento', R: 5, Omega0: 3, Cd: 4.5, periodType: 'concreteMRF', np: ['D', 'E', 'F'] },
  { id: 'C7', group: 'C. Pórticos resistentes a momento', label: 'Pórticos ordinarios de concreto reforzado resistentes a momento', R: 3, Omega0: 3, Cd: 2.5, periodType: 'concreteMRF', np: ['C', 'D', 'E', 'F'] },
  // D. Duales con pórticos especiales
  { id: 'D1', group: 'D. Duales con pórticos especiales', label: 'Dual: arriostramiento excéntrico de acero + SMF', R: 8, Omega0: 2.5, Cd: 4, periodType: 'steelEBF' },
  { id: 'D2', group: 'D. Duales con pórticos especiales', label: 'Dual: arriostramiento concéntrico especial de acero + SMF', R: 7, Omega0: 2.5, Cd: 5.5, periodType: 'other' },
  { id: 'D3', group: 'D. Duales con pórticos especiales', label: 'Dual: muros especiales de concreto reforzado + pórticos especiales', R: 7, Omega0: 2.5, Cd: 5.5, periodType: 'other' },
  { id: 'D4', group: 'D. Duales con pórticos especiales', label: 'Dual: muros ordinarios de concreto reforzado + pórticos especiales', R: 6, Omega0: 2.5, Cd: 5, periodType: 'other', np: ['D', 'E', 'F'] },
  // E. Duales con pórticos intermedios
  { id: 'E1', group: 'E. Duales con pórticos intermedios', label: 'Dual: arriostramiento concéntrico especial de acero + IMF', R: 6, Omega0: 2.5, Cd: 5, periodType: 'other' },
  { id: 'E2', group: 'E. Duales con pórticos intermedios', label: 'Dual: muros especiales de concreto reforzado + pórticos intermedios', R: 6.5, Omega0: 2.5, Cd: 5, periodType: 'other' },
  { id: 'E8', group: 'E. Duales con pórticos intermedios', label: 'Dual: muros ordinarios de concreto reforzado + pórticos intermedios', R: 5.5, Omega0: 2.5, Cd: 4.5, periodType: 'other', np: ['D', 'E', 'F'] },
  // G. Columnas en voladizo
  { id: 'G1', group: 'G. Columnas en voladizo', label: 'Columnas en voladizo – pórticos especiales de acero', R: 2.5, Omega0: 1.25, Cd: 2.5, periodType: 'other' },
  { id: 'G3', group: 'G. Columnas en voladizo', label: 'Columnas en voladizo – pórticos ordinarios de acero', R: 1.25, Omega0: 1.25, Cd: 1.25, periodType: 'other' },
  { id: 'G4', group: 'G. Columnas en voladizo', label: 'Columnas en voladizo – pórticos especiales de concreto', R: 2.5, Omega0: 1.25, Cd: 2.5, periodType: 'other' },
  // H
  { id: 'H', group: 'H. Acero sin detallado sísmico', label: 'Sistemas de acero no detallados específicamente para resistencia sísmica', R: 3, Omega0: 3, Cd: 3, periodType: 'steelMRF', np: ['D', 'E', 'F'] },
];

export const NONBUILDING_SYSTEMS = [
  { id: 'T1', group: 'Tanques elevados', label: 'Tanque elevado sobre patas arriostradas simétricamente', R: 3, Omega0: 2, Cd: 2.5 },
  { id: 'T2', group: 'Tanques elevados', label: 'Tanque elevado sobre patas no arriostradas o arriostradas asimétricamente', R: 2, Omega0: 2, Cd: 2.5 },
  { id: 'T3', group: 'Tanques elevados', label: 'Tanque sobre pedestal único – acero soldado', R: 2, Omega0: 2, Cd: 2 },
  { id: 'T4', group: 'Tanques elevados', label: 'Tanque sobre pedestal único – acero soldado con detallado especial', R: 3, Omega0: 2, Cd: 2 },
  { id: 'T5', group: 'Tanques elevados', label: 'Tanque sobre pedestal único – concreto reforzado o presforzado', R: 2, Omega0: 2, Cd: 2 },
  { id: 'S1', group: 'Torres y chimeneas', label: 'Torres de celosía (autosoportadas o atirantadas), chimeneas atirantadas', R: 3, Omega0: 2, Cd: 2.5 },
  { id: 'S2', group: 'Torres y chimeneas', label: 'Chimeneas, silos y pilas de concreto colado en sitio (muros continuos a la cimentación)', R: 3, Omega0: 1.75, Cd: 3 },
  { id: 'S3', group: 'Torres y chimeneas', label: 'Voladizos de masa distribuida de acero o concreto (chimeneas, silos, recipientes)', R: 3, Omega0: 2, Cd: 2.5 },
  { id: 'S4', group: 'Torres y chimeneas', label: 'Torre de telecomunicaciones – celosía de acero', R: 3, Omega0: 1.5, Cd: 3 },
  { id: 'S5', group: 'Torres y chimeneas', label: 'Torre de telecomunicaciones – poste de acero', R: 1.5, Omega0: 1.5, Cd: 1.5 },
  { id: 'S6', group: 'Torres y chimeneas', label: 'Torre de telecomunicaciones – poste de concreto', R: 1.5, Omega0: 1.5, Cd: 1.5 },
  { id: 'P1', group: 'Otros', label: 'Estructuras tipo péndulo invertido (excepto tanques elevados)', R: 2, Omega0: 2, Cd: 2 },
  { id: 'P2', group: 'Otros', label: 'Anuncios y vallas', R: 3.5, Omega0: 1.75, Cd: 3 },
  { id: 'P3', group: 'Otros', label: 'Otras estructuras autosoportadas no cubiertas', R: 1.25, Omega0: 2, Cd: 2.5 },
];

export function findSystem(id) {
  return BUILDING_SYSTEMS.find((s) => s.id === id) || NONBUILDING_SYSTEMS.find((s) => s.id === id);
}

export function systemWarnings(sys, sdc) {
  const w = [];
  if (sys.np && sys.np.includes(sdc)) {
    w.push(`El sistema "${sys.label}" no está permitido (NP) en Categoría de Diseño Sísmico ${sdc} según ASCE 7-05 Tabla 12.2-1.`);
  }
  return w;
}
