# Diseño: Force Calculation REP-2021

## Intención
Herramienta de escritorio para ingenieros estructurales en Panamá. Calcula las cargas de
viento y sismo del REP-2021 para varias tipologías, las muestra sobre un modelo 3D y
exporta la memoria de cálculo a Word y PDF.

## Decisiones del usuario
- Norma: **REP-2021** (Panamá), que remite a ASCE/SEI 7-05.
- Ss/S1: **opción B**. Valor automático por ubicación, obtenido de los mapas digitalizados,
  con la hoja REP a la vista para verificarlo.
- Plataforma: Electron. Reportes: .docx y .pdf.

## Enfoques considerados (Ss/S1)
- A. Visor de los mapas PDF y lectura manual: simple, pero exige buscar el valor a mano cada vez.
- **B. Digitalizar las etiquetas de contorno a una grilla interpolada (elegido):** más trabajo y
  valores interpolados, pero el valor sale automático y se puede verificar contra la hoja.

## Decisiones del constructor
- Digitalización: georreferencia por OCR de la gratícula. Ss-n y S1-n comparten georreferencia
  (diferencia menor a 0.0002°). Lectura OCR con votación de 4 variantes × 2 orientaciones,
  corrección de confusiones típicas de dígitos (1↔4, 3↔8…) y filtro de atípicos por plano local.
  Interpolación lineal de Delaunay a 0.01°.
- Cobertura: los mapas REP-2014 no tienen curvas en el oeste de Chiriquí. Más de 30 km desde
  la etiqueta más cercana se marca "sin cobertura" y se piden valores manuales; entre 15 y 30 km
  se advierte confianza baja.
- Tipologías iniciales: edificio, nave a dos aguas, torre/chimenea y tanque elevado.
- Viento por Método 2 (Fig. 6-6, 6-21, 6-23). G calculado o 0.85; Gf cuando n1 < 1 Hz.
- Sismo por FLE. Las estructuras no-edificio usan la Tabla 15.4-2 y el mínimo REP de 0.03.
- Reporte: un mismo modelo de bloques genera el .docx (librería `docx`) y el HTML que Electron
  convierte a PDF con `printToPDF`.
- Colores: azul (viento) y rojo (sismo) de la bandera de Panamá; amarillo de las etiquetas de
  los mapas REP para Ss/S1.

## Fuera de alcance (v1)
Análisis modal espectral, irregularidades, cálculo de ρ, componentes y revestimientos,
oleaje en tanques.
