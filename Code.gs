// ═══════════════════════════════════════════════════════════════════
// CEART — Google Apps Script Backend
// Conecta el panel admin con Google Sheets
//
// INSTRUCCIONES DE DESPLIEGUE:
//  1. Abre script.google.com → Nuevo proyecto
//  2. Pega todo este código en Code.gs
//  3. Cambia SS_ID con el ID de tu Google Sheet
//     (la URL de Sheets: .../spreadsheets/d/ESTE_ES_EL_ID/edit)
//  4. Implementar → Nueva implementación → Aplicación web
//     - Ejecutar como: Yo
//     - Quién tiene acceso: Cualquier persona
//  5. Copia la URL generada → pégala en admin.html como SCRIPT_URL
// ═══════════════════════════════════════════════════════════════════

const SS_ID = '1cq_OQcosjsmNmJqlvHdUwu_p2pBF5urS-uWQb1vLd-0';
const TOKEN  = 'ceart2026secret'; // Cámbialo y ponlo igual en admin.html

// Nombres de hojas — deben coincidir EXACTAMENTE con las pestañas del Sheet
const HOJA_ALUMNOS       = 'Reg. Pag';
const HOJA_BAJAS         = 'B';
const HOJA_RECUPERACION  = 'Recuperacion';
const MAESTROS           = ['Alex', 'Dorian', 'Emiliano', 'Oswaldo', 'Irving', 'Yugena'];

// Columnas de pagos en Reg. Pag (índice 0-based, empiezan en col 11)
const MESES_COLS = [
  'SEPT','OCT4','NOV4','DIC4',
  'ENE5','FEB5','MAR5','ABRIL5','MAYO5','JUNIO5','JUL5','AGO5',
  'SEPT5','OCT5','NOV5','DIC5',
  'ENE6','FEB6','MAR6','ABRIL'
];

// ── Helpers ──────────────────────────────────────────────────────────
function resp(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function ss() {
  return SpreadsheetApp.openById(SS_ID);
}

function hoja(nombre) {
  return ss().getSheetByName(nombre);
}

function checkToken(token) {
  return token === TOKEN;
}

// Convierte una fila de Reg. Pag en objeto alumno
function filaAAlumno(fila, rowIndex) {
  const pagos = {};
  // Columnas de pagos: índice 11 en adelante (base-0)
  // La fila viene del sheet: fila[0]=# fila[1]=Nombre ... fila[11]=SEPT ...
  const headerOffset = 11;
  MESES_COLS.forEach((mes, i) => {
    const val = fila[headerOffset + i];
    pagos[mes] = (val && val.toString().includes('✅')) ? 'pagado' : 'pendiente';
  });

  return {
    rowIndex:     rowIndex,         // fila real en el sheet (1-based)
    id:           fila[0] || '',
    nombre:       fila[1] || '',
    ingreso:      fila[2] ? fila[2].toString() : '',
    edad:         fila[3] || '',
    telefono:     fila[4] || '',
    cumpleanos:   fila[5] ? fila[5].toString() : '',
    diaClase:     fila[6] || '',
    hora:         fila[7] || '',
    instrumento:  fila[8] || '',
    monto:        fila[9] || '',
    fechasPago:   fila[10] || '',
    pagos:        pagos
  };
}

// Obtiene la fila del encabezado de Reg. Pag para saber el índice exacto de cada mes
function getMesesHeaderIndices() {
  const h = hoja(HOJA_ALUMNOS);
  const headers = h.getRange(1, 1, 1, h.getLastColumn()).getValues()[0];
  const indices = {};
  MESES_COLS.forEach(mes => {
    const idx = headers.indexOf(mes);
    if (idx !== -1) indices[mes] = idx + 1; // 1-based para el sheet
  });
  return indices;
}

// ── doGet ──────────────────────────────────────────────────────────
function doGet(e) {
  const p = e.parameter;

  // Soporte para payload en GET (fallback de POST redirigido)
  if (p.payload) {
    try {
      const body = JSON.parse(decodeURIComponent(p.payload));
      if (!checkToken(body.token)) return resp({ ok: false, error: 'Token inválido' });
      return handleAction(body);
    } catch(err) {
      return resp({ ok: false, error: 'Payload inválido: ' + err.message });
    }
  }

  if (!checkToken(p.token)) return resp({ ok: false, error: 'Token inválido' });

  const accion = p.accion || '';

  if (accion === 'listar_alumnos')      return resp(listarAlumnos());
  if (accion === 'listar_bajas')        return resp(listarBajas());
  if (accion === 'listar_recuperacion') return resp(listarRecuperacion());
  if (accion === 'horario_maestro')     return resp(horarioMaestro(p.maestro));
  if (accion === 'dashboard_stats')     return resp(dashboardStats());

  return resp({ ok: false, error: 'Acción GET no reconocida: ' + accion });
}

// ── doPost ──────────────────────────────────────────────────────────
function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch(err) {
    return resp({ ok: false, error: 'JSON inválido: ' + err.message });
  }
  if (!checkToken(body.token)) return resp({ ok: false, error: 'Token inválido' });
  return handleAction(body);
}

function handleAction(body) {
  const a = body.accion;
  try {
    if (a === 'registrar_pago')       return resp(registrarPago(body));
    if (a === 'quitar_pago')          return resp(quitarPago(body));
    if (a === 'agregar_alumno')       return resp(agregarAlumno(body));
    if (a === 'editar_alumno')        return resp(editarAlumno(body));
    if (a === 'mover_a_bajas')        return resp(moverABajas(body));
    if (a === 'agregar_recuperacion') return resp(agregarRecuperacion(body));
    if (a === 'eliminar_recuperacion') return resp(eliminarRecuperacion(body));
    return resp({ ok: false, error: 'Acción no reconocida: ' + a });
  } catch(err) {
    return resp({ ok: false, error: err.message });
  }
}

// ── LISTAR ALUMNOS ──────────────────────────────────────────────────
function listarAlumnos() {
  try {
    const h = hoja(HOJA_ALUMNOS);
    const data = h.getDataRange().getValues();
    if (data.length < 2) return { ok: true, alumnos: [] };

    const alumnos = [];
    for (let i = 1; i < data.length; i++) {
      const fila = data[i];
      // Saltar filas vacías (sin nombre)
      if (!fila[1] || fila[1].toString().trim() === '') continue;
      alumnos.push(filaAAlumno(fila, i + 1)); // +1 porque sheet es 1-based
    }
    return { ok: true, alumnos };
  } catch(err) {
    return { ok: false, error: err.message };
  }
}

// ── LISTAR BAJAS ────────────────────────────────────────────────────
function listarBajas() {
  try {
    const h = hoja(HOJA_BAJAS);
    const data = h.getDataRange().getValues();
    if (data.length < 2) return { ok: true, bajas: [] };

    const bajas = [];
    for (let i = 1; i < data.length; i++) {
      const fila = data[i];
      // La hoja B tiene columna 0 como categoría/mes y col 1 como nombre
      if (!fila[1] || fila[1].toString().trim() === '') continue;
      bajas.push({
        rowIndex:    i + 1,
        categoria:   fila[0] || '',
        nombre:      fila[1] || '',
        telefono:    fila[2] || '',
        instrumento: fila[3] || '',
        fechasPago:  fila[4] || '',
        monto:       fila[5] || ''
      });
    }
    return { ok: true, bajas };
  } catch(err) {
    return { ok: false, error: err.message };
  }
}

// ── LISTAR RECUPERACIONES ────────────────────────────────────────────
function listarRecuperacion() {
  try {
    const h = hoja(HOJA_RECUPERACION);
    const data = h.getDataRange().getValues();
    if (data.length < 4) return { ok: true, recuperaciones: [] }; // primeras 3 filas son encabezado

    const recuperaciones = [];
    for (let i = 3; i < data.length; i++) { // datos empiezan en fila 4 (índice 3)
      const fila = data[i];
      if (!fila[1] || fila[1].toString().trim() === '') continue;
      recuperaciones.push({
        rowIndex: i + 1,
        alumno:   fila[1] || '',
        dia:      fila[2] || '',
        hora:     fila[3] ? fila[3].toString() : '',
        maestro:  fila[4] || ''
      });
    }
    return { ok: true, recuperaciones };
  } catch(err) {
    return { ok: false, error: err.message };
  }
}

// ── HORARIO MAESTRO ──────────────────────────────────────────────────
function horarioMaestro(nombre) {
  if (!nombre || !MAESTROS.includes(nombre)) {
    return { ok: false, error: 'Maestro no válido: ' + nombre };
  }
  try {
    const h = hoja(nombre);
    if (!h) return { ok: false, error: 'Hoja no encontrada: ' + nombre };
    const data = h.getDataRange().getValues();
    // Devolver los datos crudos; el frontend los formatea
    const rows = data.map(fila => fila.map(c => c ? c.toString() : ''));
    return { ok: true, maestro: nombre, horario: rows };
  } catch(err) {
    return { ok: false, error: err.message };
  }
}

// ── DASHBOARD STATS ──────────────────────────────────────────────────
function dashboardStats() {
  try {
    const h = hoja(HOJA_ALUMNOS);
    const data = h.getDataRange().getValues();
    const headers = data[0];

    // Encontrar índice del mes más reciente con datos
    const headerOffset = 11;
    let totalActivos = 0;
    let pagadosMes = 0;
    let pendientesMes = 0;

    // El mes actual es el último con datos no vacíos (ABRIL = col 30 base-0 = índice 30)
    // Usamos el mes más reciente activo (último MESES_COLS)
    const ultimoMesIdx = MESES_COLS.length - 1; // ABRIL
    const colMesActual = headerOffset + ultimoMesIdx;

    for (let i = 1; i < data.length; i++) {
      const fila = data[i];
      if (!fila[1] || fila[1].toString().trim() === '') continue;
      totalActivos++;
      const valPago = fila[colMesActual];
      if (valPago && valPago.toString().includes('✅')) {
        pagadosMes++;
      } else {
        pendientesMes++;
      }
    }

    const hBajas = hoja(HOJA_BAJAS);
    const dataBajas = hBajas.getDataRange().getValues();
    let totalBajas = 0;
    for (let i = 1; i < dataBajas.length; i++) {
      if (dataBajas[i][1] && dataBajas[i][1].toString().trim() !== '') totalBajas++;
    }

    // Contar maestros activos
    const totalMaestros = MAESTROS.length;

    // Distribución por instrumento
    const porInstrumento = {};
    for (let i = 1; i < data.length; i++) {
      const fila = data[i];
      if (!fila[1] || fila[1].toString().trim() === '') continue;
      const inst = (fila[8] || 'Sin instrumento').toString().toUpperCase().trim();
      porInstrumento[inst] = (porInstrumento[inst] || 0) + 1;
    }

    return {
      ok: true,
      stats: {
        totalActivos,
        pagadosMes,
        pendientesMes,
        totalBajas,
        totalMaestros,
        porInstrumento,
        mesActual: MESES_COLS[ultimoMesIdx]
      }
    };
  } catch(err) {
    return { ok: false, error: err.message };
  }
}

// ── REGISTRAR PAGO ──────────────────────────────────────────────────
// body: { rowIndex, mes }
function registrarPago(body) {
  const { rowIndex, mes } = body;
  if (!rowIndex || !mes) return { ok: false, error: 'Faltan rowIndex o mes' };

  const indices = getMesesHeaderIndices();
  const colIdx = indices[mes];
  if (!colIdx) return { ok: false, error: 'Mes no encontrado: ' + mes };

  const h = hoja(HOJA_ALUMNOS);
  h.getRange(rowIndex, colIdx).setValue('✅');
  SpreadsheetApp.flush();
  return { ok: true, msg: 'Pago registrado: ' + mes };
}

// ── QUITAR PAGO ──────────────────────────────────────────────────────
// body: { rowIndex, mes }
function quitarPago(body) {
  const { rowIndex, mes } = body;
  if (!rowIndex || !mes) return { ok: false, error: 'Faltan rowIndex o mes' };

  const indices = getMesesHeaderIndices();
  const colIdx = indices[mes];
  if (!colIdx) return { ok: false, error: 'Mes no encontrado: ' + mes };

  const h = hoja(HOJA_ALUMNOS);
  h.getRange(rowIndex, colIdx).setValue('');
  SpreadsheetApp.flush();
  return { ok: true, msg: 'Pago removido: ' + mes };
}

// ── AGREGAR ALUMNO ──────────────────────────────────────────────────
// body: { nombre, edad, telefono, cumpleanos, diaClase, hora, instrumento, monto, fechasPago }
function agregarAlumno(body) {
  const h = hoja(HOJA_ALUMNOS);
  const lastRow = h.getLastRow();
  const newNum = lastRow; // # correlativo

  h.appendRow([
    newNum,
    body.nombre      || '',
    body.ingreso     || new Date().toLocaleDateString('es-MX'),
    body.edad        || '',
    body.telefono    || '',
    body.cumpleanos  || '',
    body.diaClase    || '',
    body.hora        || '',
    body.instrumento || '',
    body.monto       || '',
    body.fechasPago  || ''
    // Las columnas de pago quedan vacías automáticamente
  ]);
  SpreadsheetApp.flush();
  return { ok: true, msg: 'Alumno agregado: ' + body.nombre };
}

// ── EDITAR ALUMNO ────────────────────────────────────────────────────
// body: { rowIndex, nombre, edad, telefono, cumpleanos, diaClase, hora, instrumento, monto, fechasPago }
function editarAlumno(body) {
  const { rowIndex } = body;
  if (!rowIndex) return { ok: false, error: 'Falta rowIndex' };

  const h = hoja(HOJA_ALUMNOS);
  const rangeCols = [
    [2, body.nombre],
    [3, body.ingreso],
    [4, body.edad],
    [5, body.telefono],
    [6, body.cumpleanos],
    [7, body.diaClase],
    [8, body.hora],
    [9, body.instrumento],
    [10, body.monto],
    [11, body.fechasPago]
  ];
  rangeCols.forEach(([col, val]) => {
    if (val !== undefined) h.getRange(rowIndex, col).setValue(val);
  });
  SpreadsheetApp.flush();
  return { ok: true, msg: 'Alumno actualizado' };
}

// ── MOVER A BAJAS ────────────────────────────────────────────────────
// body: { rowIndex }
function moverABajas(body) {
  const { rowIndex } = body;
  if (!rowIndex) return { ok: false, error: 'Falta rowIndex' };

  const hA = hoja(HOJA_ALUMNOS);
  const hB = hoja(HOJA_BAJAS);

  const filaData = hA.getRange(rowIndex, 1, 1, hA.getLastColumn()).getValues()[0];
  const nombre      = filaData[1] || '';
  const telefono    = filaData[4] || '';
  const instrumento = filaData[8] || '';
  const fechasPago  = filaData[10] || '';
  const monto       = filaData[9] || '';

  // Agregar a Bajas
  hB.appendRow([
    'BAJA ' + new Date().toLocaleDateString('es-MX'),
    nombre, telefono, instrumento, fechasPago, monto
  ]);

  // Eliminar de Reg. Pag
  hA.deleteRow(rowIndex);
  SpreadsheetApp.flush();
  return { ok: true, msg: nombre + ' movido a Bajas' };
}

// ── AGREGAR RECUPERACION ─────────────────────────────────────────────
// body: { alumno, dia, hora, maestro }
function agregarRecuperacion(body) {
  const h = hoja(HOJA_RECUPERACION);
  h.appendRow(['', body.alumno || '', body.dia || '', body.hora || '', body.maestro || '']);
  SpreadsheetApp.flush();
  return { ok: true, msg: 'Recuperación agregada: ' + body.alumno };
}

// ── ELIMINAR RECUPERACION ────────────────────────────────────────────
// body: { rowIndex }
function eliminarRecuperacion(body) {
  const { rowIndex } = body;
  if (!rowIndex) return { ok: false, error: 'Falta rowIndex' };
  hoja(HOJA_RECUPERACION).deleteRow(rowIndex);
  SpreadsheetApp.flush();
  return { ok: true, msg: 'Recuperación eliminada' };
}
