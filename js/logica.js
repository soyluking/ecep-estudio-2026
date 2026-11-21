// Reglas del diagnóstico, la repetición de errores y el armado de sesiones.
// Todo es puro: recibe el banco, el estado, la fecha y un generador de azar.

export const INTERVALOS = [1, 3, 7];   // días hasta repasar un error: tras fallar, tras 1 acierto, tras 2
export const TAMANO_SESION = 10;
export const MAX_REPASOS = 4;          // errores vencidos por sesión
export const MAX_PARECIDAS = 3;        // preguntas parecidas a errores recientes por sesión
export const ERRORES_RECIENTES = 5;    // cuántos errores recientes se miran para buscar parecidas

// ---------- utilidades ----------

export function azar(semilla) {        // mulberry32
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function mezclar(lista, rng) {
  const r = [...lista];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

export function fechaLocal(d) {        // 'YYYY-MM-DD' en hora local
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function sumarDias(fecha, n) {
  const [y, m, d] = fecha.split('-').map(Number);
  return fechaLocal(new Date(y, m - 1, d + n));
}

// ---------- banco ----------

// Agrupa las preguntas repetidas entre años. Para practicar se usa una sola por grupo
// (la más reciente que no esté reservada para la simulación final).
export function indexarBanco(raw) {
  const porId = new Map(raw.preguntas.map((p) => [p.id, p]));
  const grupos = new Map();
  for (const p of raw.preguntas) {
    if (!grupos.has(p.grupo)) grupos.set(p.grupo, []);
    grupos.get(p.grupo).push(p);
  }
  const practicables = new Map();      // grupo -> pregunta que se muestra
  for (const [g, miembros] of grupos) {
    const libres = miembros.filter((p) => !p.reservada).sort((a, b) => b.anio - a.anio);
    if (libres.length) practicables.set(g, libres[0]);
  }
  return { raw, porId, grupos, practicables, subdominios: Object.keys(raw.subdominios) };
}

// ---------- estado ----------

export function estadoInicial(ahora = new Date()) {
  return {
    version: 1,
    creado: ahora.toISOString(),
    semilla: Math.floor(Math.random() * 2 ** 31),
    diagnostico: null,   // { ids, resp: {id: letra}, fecha } al terminarlo
    actual: null,        // sesión en curso: { modo, ids, origen: {id: motivo}, i, resp }
    intentos: [],        // { id, grupo, ok, modo, t }
    errores: {},         // grupo -> { id, paso, vence, abierto, ultimo }
    ultima: null,        // última sesión de práctica terminada, para mostrar su resultado
    sesiones: 0,
    exportado: null,
  };
}

// Registra una respuesta y actualiza la repetición del error.
// Falla: vuelve mañana. Acierta: sigue la escala 1 → 3 → 7 días y, tras el tercer acierto, se cierra.
export function registrarRespuesta(estado, pregunta, letra, modo, ahora = new Date()) {
  const ok = letra === pregunta.clave;
  const hoy = fechaLocal(ahora);
  estado.intentos.push({ id: pregunta.id, grupo: pregunta.grupo, ok, modo, t: ahora.getTime() });
  const e = estado.errores[pregunta.grupo];
  if (!ok) {
    estado.errores[pregunta.grupo] = {
      id: pregunta.id, paso: 0, vence: sumarDias(hoy, INTERVALOS[0]), abierto: true, ultimo: ahora.getTime(),
    };
  } else if (e && e.abierto) {
    e.paso += 1;
    if (e.paso >= INTERVALOS.length) e.abierto = false;
    else e.vence = sumarDias(hoy, INTERVALOS[e.paso]);
  }
  return ok;
}

export const erroresAbiertos = (estado) => Object.entries(estado.errores).filter(([, e]) => e.abierto);
export const erroresVencidos = (estado, hoy) =>
  erroresAbiertos(estado).filter(([, e]) => e.vence <= hoy).sort((a, b) => a[1].vence.localeCompare(b[1].vence));

// ---------- diagnóstico ----------

// 2 preguntas por subdominio, de las pruebas que se practican (no la reservada), sin claves dudosas,
// de grupos distintos entre sí y, si se puede, de distinto contenido.
export function armarDiagnostico(banco, semilla) {
  const rng = azar(semilla);
  const usados = new Set();
  const ids = [];
  for (const sub of banco.subdominios) {
    let pool = [...banco.practicables.values()].filter((p) => p.subdominio === sub && p.verificacion !== 'dudosa');
    pool = mezclar(pool, rng);
    const elegidas = [];
    for (const p of pool) {
      if (usados.has(p.grupo)) continue;
      if (elegidas.length === 1 && p.contenido === elegidas[0].contenido) continue;
      elegidas.push(p);
      usados.add(p.grupo);
      if (elegidas.length === 2) break;
    }
    if (elegidas.length < 2) {   // casi imposible con este banco; se completa sin exigir otro contenido
      for (const p of pool) {
        if (elegidas.length === 2) break;
        if (!usados.has(p.grupo)) { elegidas.push(p); usados.add(p.grupo); }
      }
    }
    ids.push(...elegidas.map((p) => p.id));
  }
  return ids;
}

// ---------- sesión de práctica ----------

export function similitud(a, b) {
  return (a.contenido === b.contenido ? 2 : 0) + (a.subdominio === b.subdominio ? 1 : 0) + (a.tarea === b.tarea ? 1 : 0);
}

// Acierto suavizado por subdominio, con los intentos de diagnóstico y práctica.
export function precisionPorSubdominio(banco, estado) {
  const r = Object.fromEntries(banco.subdominios.map((s) => [s, { intentos: 0, aciertos: 0 }]));
  for (const it of estado.intentos) {
    const p = banco.porId.get(it.id);
    if (!p || !r[p.subdominio]) continue;
    r[p.subdominio].intentos++;
    if (it.ok) r[p.subdominio].aciertos++;
  }
  for (const v of Object.values(r)) v.precision = (v.aciertos + 1) / (v.intentos + 2);
  return r;
}

// Arma 10 preguntas: errores que toca repasar, parecidas a los errores recientes y subdominios débiles.
// Una pregunta por grupo de repetidas, nunca la de 2024, y las que tienen un error abierto solo entran como repaso.
export function armarSesion(banco, estado, ahora = new Date(), tamano = TAMANO_SESION) {
  const hoy = fechaLocal(ahora);
  const rng = azar(estado.semilla + estado.sesiones * 7919 + 1);
  const origen = {};
  const elegidos = [];                         // preguntas
  const enSesion = new Set();                  // grupos
  const abiertos = new Set(erroresAbiertos(estado).map(([g]) => g));
  const vistos = new Map();                    // grupo -> última vez que se respondió
  for (const it of estado.intentos) vistos.set(it.grupo, Math.max(vistos.get(it.grupo) || 0, it.t));

  const agregar = (p, motivo) => {
    elegidos.push(p);
    enSesion.add(p.grupo);
    origen[p.id] = motivo;
  };

  // 1. Errores que toca repetir (los más atrasados primero)
  for (const [g, e] of erroresVencidos(estado, hoy)) {
    if (elegidos.length >= MAX_REPASOS) break;
    const p = banco.porId.get(e.id);
    if (p) agregar(p, 'repaso');
  }

  // 2. Parecidas a los errores recientes: mismo contenido, o subdominio y tarea. Nunca del mismo grupo.
  const libres = () => [...banco.practicables.values()].filter((p) => !enSesion.has(p.grupo) && !abiertos.has(p.grupo));
  const recientes = erroresAbiertos(estado)
    .sort((a, b) => b[1].ultimo - a[1].ultimo)
    .slice(0, ERRORES_RECIENTES)
    .map(([, e]) => banco.porId.get(e.id))
    .filter(Boolean);
  let parecidas = 0;
  let sinResultado = 0;
  for (let k = 0; recientes.length && parecidas < MAX_PARECIDAS && sinResultado < recientes.length; k++) {
    const base = recientes[k % recientes.length];
    const candidatas = libres()
      .map((p) => ({ p, s: similitud(base, p), nueva: !vistos.has(p.grupo) }))
      .filter((c) => c.s >= 2);
    if (!candidatas.length) { sinResultado++; continue; }
    const puntaje = (c) => c.s + (c.nueva ? 5 : 0) + rng() * 0.9;
    candidatas.sort((a, b) => puntaje(b) - puntaje(a));
    agregar(candidatas[0].p, 'parecida');
    parecidas++;
    sinResultado = 0;
  }

  // 3. Los subdominios más débiles. Se reparten entre los 4 más débiles; primero las preguntas que no ha visto.
  const prec = precisionPorSubdominio(banco, estado);
  const debiles = banco.subdominios
    .map((s) => ({ s, v: prec[s].precision + rng() * 0.02 }))
    .sort((a, b) => a.v - b.v)
    .map((x) => x.s);
  let ronda = 0;
  while (elegidos.length < tamano && debiles.length) {
    const sub = debiles[ronda % Math.min(4, debiles.length)];
    ronda++;
    const pool = libres().filter((p) => p.subdominio === sub);
    if (!pool.length) {                         // este subdominio ya no tiene: se pasa al siguiente más débil
      debiles.splice(debiles.indexOf(sub), 1);
      continue;
    }
    const nuevas = pool.filter((p) => !vistos.has(p.grupo));
    const base = nuevas.length ? nuevas : [...pool].sort((a, b) => vistos.get(a.grupo) - vistos.get(b.grupo)).slice(0, 5);
    agregar(base[Math.floor(rng() * base.length)], 'debil');
  }

  const ordenados = mezclar(elegidos, rng);
  return { ids: ordenados.map((p) => p.id), origen };
}
