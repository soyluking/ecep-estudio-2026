import {
  indexarBanco, armarDiagnostico, armarSesion, registrarRespuesta, erroresAbiertos, erroresVencidos,
  fechaLocal, TAMANO_SESION,
} from './logica.js';
import { cargar, guardar, borrar, exportar, leerImportacion, guardadoDisponible } from './almacen.js';

const FECHA_PRUEBA = new Date(2026, 11, 19);
const MOTIVOS = {
  repaso: 'Repaso de un error',
  parecida: 'Parecida a un error reciente',
  debil: 'Subdominio por reforzar',
};
const VERIFICACION = {
  verificada: 'La clave se verificó resolviendo la pregunta.',
  coherente: 'La clave es la opción mejor fundamentada según las Bases Curriculares.',
  dudosa: 'La clave está en discusión (ver nota).',
};

const app = document.getElementById('app');
const aviso = document.getElementById('aviso');
let banco;
let estado;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nombreSub = (id) => `${id} ${banco.raw.subdominios[id]}`;
const fuente = (p) => `Prueba ${p.anio}, pregunta ${p.numero}`;
const guardarEstado = () => { guardar(estado); avisarSiNoGuarda(); };

function avisarSiNoGuarda() {
  aviso.innerHTML = guardadoDisponible() ? '' :
    '<div class="alerta">Este navegador no deja guardar el progreso. Exporta un respaldo antes de cerrar la pestaña.</div>';
}

// ---------- enunciado y opciones ----------

const RE_FIGURA = /\[Figura:[\s\S]*?\]/g;

function htmlFigura(f) {
  return `<figure class="figura"><img src="${esc(f.img)}" alt="${esc(f.alt)}" loading="lazy"></figure>`;
}

function htmlTabla(lineas) {
  const filas = lineas.map((l) => l.split('|').map((c) => c.trim()));
  const [cab, ...resto] = filas;
  return `<div class="tabla-scroll"><table><thead><tr>${cab.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>` +
    `<tbody>${resto.map((f) => `<tr>${f.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function htmlTexto(texto) {
  const salida = [];
  let parrafo = [];
  let tabla = [];
  const cerrarParrafo = () => { if (parrafo.length) salida.push(`<p>${parrafo.join('<br>')}</p>`); parrafo = []; };
  const cerrarTabla = () => { if (tabla.length) salida.push(htmlTabla(tabla)); tabla = []; };
  for (const linea of texto.split('\n')) {
    if (linea.includes(' | ') || /^\S.*\|\s*$/.test(linea)) { cerrarParrafo(); tabla.push(linea); continue; }
    cerrarTabla();
    if (!linea.trim()) cerrarParrafo(); else parrafo.push(esc(linea));
  }
  cerrarParrafo();
  cerrarTabla();
  return salida.join('');
}

// Las figuras reemplazan a las marcas «[Figura: …]» del enunciado, en orden. Las que sobran van después.
function htmlEnunciado(p) {
  let n = 0;
  const piezas = [];
  let resto = p.enunciado;
  let m;
  const re = new RegExp(RE_FIGURA);
  let ultimo = 0;
  while ((m = re.exec(resto))) {
    piezas.push(htmlTexto(resto.slice(ultimo, m.index)));
    piezas.push(p.figuras[n] ? htmlFigura(p.figuras[n]) : `<p class="desc">${esc(m[0])}</p>`);
    n++;
    ultimo = m.index + m[0].length;
  }
  piezas.push(htmlTexto(resto.slice(ultimo)));
  for (; n < p.figuras.length; n++) piezas.push(htmlFigura(p.figuras[n]));
  return piezas.join('');
}

function htmlOpcion(letra, texto) {
  const soloFigura = /^\[Figura:[\s\S]*\]$/.test(texto.trim());
  return soloFigura ? `<span class="desc">${esc(texto.trim().slice(1, -1))}</span>` : esc(texto);
}

function otrosAnios(p) {
  return banco.grupos.get(p.grupo).filter((q) => q.id !== p.id && !q.reservada)
    .sort((a, b) => a.anio - b.anio).map((q) => `${q.anio} (n.º ${q.numero})`);
}

function htmlRetroalimentacion(p, letra) {
  const ok = letra === p.clave;
  const otros = otrosAnios(p);
  return `<section class="retro ${ok ? 'ok' : 'mal'}">
    <h3>${ok ? 'Correcto' : `Incorrecto: marcaste ${esc(letra)}`}</h3>
    <p><strong>Clave oficial: ${esc(p.clave)}</strong></p>
    ${p.verificacion === 'dudosa' ? `<div class="dudosa"><strong>Clave en discusión.</strong> La clave oficial se mantiene. ${esc(p.nota)}</div>` : ''}
    <h4>Explicación propuesta <span class="etiqueta">no es oficial</span></h4>
    <p>${esc(p.explicacion)}</p>
    <p class="meta">${esc(VERIFICACION[p.verificacion])}</p>
    <p class="meta">Fuente: ${esc(fuente(p))}${otros.length ? `. También apareció en ${esc(otros.join(', '))}` : ''}.
      ${esc(nombreSub(p.subdominio))}. Dificultad estimada: ${esc(p.dificultad)} (estimación propia).</p>
  </section>`;
}

function htmlPreguntaCompleta(p, letra) {   // para revisar: enunciado, opciones marcadas y explicación
  return `<div class="enunciado">${htmlEnunciado(p)}</div>
    <ul class="opciones">${Object.entries(p.opciones).map(([l, t]) =>
      `<li class="opcion fija ${l === p.clave ? 'ok' : l === letra ? 'mal' : ''}"><span class="letra">${l}</span><span>${htmlOpcion(l, t)}</span></li>`).join('')}</ul>
    ${htmlRetroalimentacion(p, letra)}`;
}

// ---------- vistas ----------

function diasParaPrueba() {
  const hoy = new Date();
  return Math.ceil((FECHA_PRUEBA - new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate())) / 86400000);
}

function resumenPorSubdominio(ids, resp) {
  const r = {};
  for (const id of ids) {
    const p = banco.porId.get(id);
    r[p.subdominio] ??= { aciertos: 0, total: 0 };
    r[p.subdominio].total++;
    if (resp[id] === p.clave) r[p.subdominio].aciertos++;
  }
  return r;
}

function htmlDiagnosticoResumen() {
  const d = estado.diagnostico;
  const r = resumenPorSubdominio(d.ids, d.resp);
  const filas = Object.entries(r).sort((a, b) => (a[1].aciertos / a[1].total) - (b[1].aciertos / b[1].total) || a[0].localeCompare(b[0], 'es', { numeric: true }));
  const total = filas.reduce((s, [, v]) => s + v.aciertos, 0);
  const empezar = filas.filter(([, v]) => v.aciertos < v.total).slice(0, 3).map(([s]) => nombreSub(s));
  return `<p><strong>${total} de ${d.ids.length}</strong> correctas. ${empezar.length ? `Por dónde empezar: ${esc(empezar.join('; '))}.` : 'Respondiste todo bien.'}</p>
    <ul class="barras">${filas.map(([s, v]) => `<li><span class="nombre">${esc(nombreSub(s))}</span>
      <span class="barra"><i style="width:${(100 * v.aciertos) / v.total}%"></i></span><span class="valor">${v.aciertos}/${v.total}</span></li>`).join('')}</ul>
    <p class="meta">Son solo 2 preguntas por subdominio: sirve como pista de dónde partir, no como medida exacta.</p>`;
}

function vistaInicio() {
  const hoy = fechaLocal(new Date());
  const abiertos = erroresAbiertos(estado).length;
  const vencidos = erroresVencidos(estado, hoy).length;
  const intentos = estado.intentos.length;
  const aciertos = estado.intentos.filter((i) => i.ok).length;
  const act = estado.actual;
  const dias = diasParaPrueba();
  const exp = estado.exportado ? new Date(estado.exportado) : null;
  const sinRespaldo = intentos > 0 && (!exp || (Date.now() - exp.getTime()) > 3 * 86400000);

  const cardDiag = act?.modo === 'diagnostico'
    ? `<p>Vas en la pregunta ${act.i + 1} de ${act.ids.length}.</p><button class="btn primario" data-accion="continuar">Continuar diagnóstico</button>`
    : estado.diagnostico
      ? `${htmlDiagnosticoResumen()}<p><a href="#/resultado-diagnostico">Revisar las 28 preguntas</a></p>`
      : `<p>28 preguntas, 2 por subdominio, para ver por dónde partir. Las respuestas se muestran al terminar.</p>
         <button class="btn primario" data-accion="diagnostico">Empezar el diagnóstico</button>`;

  const cardPractica = act?.modo === 'practica'
    ? `<p>Tienes una sesión en curso: pregunta ${act.i + 1} de ${act.ids.length}.</p>
       <button class="btn primario" data-accion="continuar">Continuar sesión</button>
       <button class="btn enlace" data-accion="descartar">Descartar sesión</button>`
    : `<p>Sesiones de ${TAMANO_SESION} preguntas que mezclan errores por repasar, preguntas parecidas a tus errores y los subdominios más débiles.</p>
       <button class="btn primario" data-accion="practica" ${act ? 'disabled' : ''}>Nueva sesión de práctica</button>
       ${act ? '<p class="meta">Termina el diagnóstico primero.</p>' : ''}`;

  app.innerHTML = `
    <section class="hero">
      <h1>${dias > 0 ? `Quedan ${dias} días para la prueba` : dias === 0 ? 'La prueba es hoy' : 'La prueba ya pasó'}</h1>
      <p>Sábado 19 de diciembre de 2026. Hay ${banco.practicables.size} preguntas oficiales distintas para practicar. La prueba 2024 se guarda para el ensayo final.</p>
    </section>
    <div class="tarjetas">
      <section class="tarjeta"><h2>1. Diagnóstico</h2>${cardDiag}</section>
      <section class="tarjeta"><h2>2. Práctica</h2>${cardPractica}
        <dl class="cifras">
          <div><dt>Errores que vuelven hoy</dt><dd>${vencidos}</dd></div>
          <div><dt>Errores abiertos</dt><dd>${abiertos}</dd></div>
          <div><dt>Respondidas</dt><dd>${intentos}</dd></div>
          <div><dt>Aciertos</dt><dd>${intentos ? Math.round((100 * aciertos) / intentos) + '%' : '–'}</dd></div>
        </dl>
      </section>
      <section class="tarjeta"><h2>Respaldo del progreso</h2>
        <p>El progreso vive en este navegador. Si borras los datos del sitio o cambias de computador, se pierde: exporta un respaldo de vez en cuando.</p>
        ${sinRespaldo ? '<p class="alerta-chica">No has exportado un respaldo en los últimos 3 días.</p>' : ''}
        <p class="meta">Último respaldo: ${exp ? esc(exp.toLocaleString('es-CL')) : 'ninguno'}</p>
        <button class="btn" data-accion="exportar">Exportar progreso</button>
        <label class="btn">Importar<input type="file" accept="application/json,.json" id="importar" hidden></label>
        <button class="btn enlace peligro" data-accion="reiniciar">Borrar todo el progreso</button>
        <p id="msg-respaldo" class="meta" role="status"></p>
      </section>
    </div>`;
}

function preguntaActual() {
  const a = estado.actual;
  return banco.porId.get(a.ids[a.i]);
}

function vistaSesion() {
  const a = estado.actual;
  if (!a) { location.hash = '#/'; return; }
  const p = preguntaActual();
  const letra = a.resp[p.id];
  const respondida = letra !== undefined;
  const diag = a.modo === 'diagnostico';
  const mostrarRetro = respondida && !diag;
  const ultima = a.i === a.ids.length - 1;
  const titulo = diag ? 'Diagnóstico' : 'Práctica';

  app.innerHTML = `
    <div class="progreso-sesion">
      <a href="#/" class="enlace-salir">← Salir (se guarda)</a>
      <span>${titulo} · ${a.i + 1} de ${a.ids.length}</span>
      ${!diag && a.origen[p.id] ? `<span class="etiqueta origen-${a.origen[p.id]}">${MOTIVOS[a.origen[p.id]]}</span>` : ''}
    </div>
    <div class="avance"><i style="width:${(100 * a.i) / a.ids.length}%"></i></div>
    <article class="pregunta">
      <div class="enunciado">${htmlEnunciado(p)}</div>
      <ul class="opciones" role="radiogroup" aria-label="Opciones">
        ${Object.entries(p.opciones).map(([l, t]) => {
          const cls = mostrarRetro ? (l === p.clave ? 'ok' : l === letra ? 'mal' : '') : (l === letra ? 'elegida' : '');
          return `<li><button class="opcion ${cls}" data-letra="${l}" role="radio" aria-checked="${l === letra}" ${respondida ? 'disabled' : ''}>
            <span class="letra">${l}</span><span>${htmlOpcion(l, t)}</span></button></li>`;
        }).join('')}
      </ul>
      ${mostrarRetro ? htmlRetroalimentacion(p, letra) : ''}
      <div class="acciones">
        ${respondida
          ? `<button class="btn primario" data-accion="siguiente" id="siguiente">${ultima ? 'Terminar' : 'Siguiente'}</button>`
          : `<button class="btn primario" data-accion="responder" id="responder" disabled>Responder</button>`}
        <span class="meta">Teclas: A–D o 1–4 para elegir, Enter para continuar</span>
      </div>
    </article>`;
  window.scrollTo(0, 0);
}

function vistaResultado(modo) {
  const u = modo === 'diagnostico'
    ? (estado.diagnostico && { modo, ...estado.diagnostico })
    : estado.ultima;
  if (!u) { location.hash = '#/'; return; }
  const aciertos = u.ids.filter((id) => u.resp[id] === banco.porId.get(id).clave).length;
  const falladas = u.ids.length - aciertos;
  const lista = u.ids.map((id, k) => {
    const p = banco.porId.get(id);
    const ok = u.resp[id] === p.clave;
    return `<details class="revision ${ok ? 'ok' : 'mal'}"><summary>
      <span class="marca-res">${ok ? '✓' : '✗'}</span> ${k + 1}. ${esc(nombreSub(p.subdominio))} · ${esc(fuente(p))}
      ${u.origen?.[id] ? `<span class="etiqueta">${MOTIVOS[u.origen[id]]}</span>` : ''}</summary>
      ${htmlPreguntaCompleta(p, u.resp[id])}</details>`;
  }).join('');
  const cabecera = modo === 'diagnostico'
    ? `<h1>Resultado del diagnóstico</h1>${htmlDiagnosticoResumen()}`
    : `<h1>Sesión terminada: ${aciertos} de ${u.ids.length}</h1>
       <p>${falladas ? `${falladas === 1 ? 'La pregunta fallada vuelve' : `Las ${falladas} preguntas falladas vuelven`} mañana, y de nuevo a los 3 y 7 días hasta que las aciertes.` : 'No fallaste ninguna: no queda nada nuevo por repasar.'}</p>`;
  app.innerHTML = `${cabecera}
    <div class="acciones">
      <button class="btn primario" data-accion="practica">Otra sesión de práctica</button>
      <a class="btn" href="#/">Inicio</a>
    </div>
    <h2>Revisar las preguntas</h2>${lista}`;
  window.scrollTo(0, 0);
}

// ---------- acciones ----------

function iniciar(modo) {
  if (modo === 'diagnostico') {
    estado.actual = { modo, ids: armarDiagnostico(banco, estado.semilla), origen: {}, i: 0, resp: {} };
  } else {
    const s = armarSesion(banco, estado, new Date());
    if (!s.ids.length) { alert('No quedan preguntas disponibles para practicar.'); return; }
    estado.sesiones += 1;
    estado.actual = { modo, ids: s.ids, origen: s.origen, i: 0, resp: {} };
  }
  guardarEstado();
  location.hash = '#/sesion';
  enrutar();
}

function responder(letra) {
  const a = estado.actual;
  const p = preguntaActual();
  if (a.resp[p.id] !== undefined) return;
  a.resp[p.id] = letra;
  registrarRespuesta(estado, p, letra, a.modo, new Date());
  guardarEstado();
  if (a.modo === 'diagnostico') siguiente(); else vistaSesion();
}

function siguiente() {
  const a = estado.actual;
  if (a.i + 1 < a.ids.length) { a.i++; guardarEstado(); vistaSesion(); return; }
  const fin = { ids: a.ids, resp: a.resp, origen: a.origen, fecha: new Date().toISOString() };
  if (a.modo === 'diagnostico') estado.diagnostico = fin; else estado.ultima = { modo: a.modo, ...fin };
  estado.actual = null;
  guardarEstado();
  location.hash = a.modo === 'diagnostico' ? '#/resultado-diagnostico' : '#/resultado';
}

async function importar(archivo) {
  const msg = document.getElementById('msg-respaldo');
  try {
    const nuevo = await leerImportacion(archivo);
    if (!confirm(`Esto reemplaza todo el progreso de este navegador por el del respaldo (${nuevo.intentos.length} respuestas). ¿Seguir?`)) return;
    estado = nuevo;
    guardarEstado();
    vistaInicio();
    document.getElementById('msg-respaldo').textContent = 'Respaldo importado.';
  } catch (e) {
    msg.textContent = e.message;
  }
}

app.addEventListener('click', (ev) => {
  const op = ev.target.closest('[data-letra]');
  if (op && !op.disabled) {
    app.querySelectorAll('[data-letra]').forEach((b) => { b.classList.toggle('elegida', b === op); b.setAttribute('aria-checked', b === op); });
    const r = document.getElementById('responder');
    if (r) { r.disabled = false; r.dataset.elegida = op.dataset.letra; }
    return;
  }
  const bt = ev.target.closest('[data-accion]');
  if (!bt || bt.disabled) return;
  switch (bt.dataset.accion) {
    case 'diagnostico': iniciar('diagnostico'); break;
    case 'practica': iniciar('practica'); break;
    case 'continuar': location.hash = '#/sesion'; enrutar(); break;
    case 'responder': responder(bt.dataset.elegida); break;
    case 'siguiente': siguiente(); break;
    case 'exportar': exportar(estado); vistaInicio(); break;
    case 'descartar':
      if (confirm('Se descarta lo que falta de la sesión. Lo ya respondido queda registrado.')) { estado.actual = null; guardarEstado(); vistaInicio(); }
      break;
    case 'reiniciar':
      if (confirm('Se borra todo el progreso de este navegador (diagnóstico, errores y respuestas). ¿Seguro?')) {
        borrar();
        estado = cargar();
        guardarEstado();
        vistaInicio();
      }
      break;
    default:
  }
});

app.addEventListener('change', (ev) => {
  if (ev.target.id === 'importar' && ev.target.files[0]) importar(ev.target.files[0]);
});

document.addEventListener('keydown', (ev) => {
  if (!estado?.actual || location.hash !== '#/sesion' || ev.metaKey || ev.ctrlKey || ev.altKey) return;
  const p = preguntaActual();
  const letras = Object.keys(p.opciones);
  const k = ev.key.toUpperCase();
  const letra = letras.includes(k) ? k : letras[Number(ev.key) - 1];
  if (letra && estado.actual.resp[p.id] === undefined) {
    app.querySelector(`[data-letra="${letra}"]`)?.click();
  } else if (ev.key === 'Enter') {
    const b = document.getElementById('siguiente') || document.getElementById('responder');
    if (b && !b.disabled && document.activeElement !== b) { ev.preventDefault(); b.click(); }
  }
});

// ---------- arranque ----------

function enrutar() {
  switch (location.hash) {
    case '#/sesion': return vistaSesion();
    case '#/resultado': return vistaResultado('practica');
    case '#/resultado-diagnostico': return vistaResultado('diagnostico');
    default: return vistaInicio();
  }
}

async function arrancar() {
  try {
    const r = await fetch('banco.json');
    if (!r.ok) throw new Error(r.status);
    banco = indexarBanco(await r.json());
  } catch {
    app.innerHTML = '<p class="alerta">No se pudo cargar banco.json. Si abriste index.html con doble clic, usa un servidor local: <code>python3 -m http.server</code> dentro de la carpeta sitio/.</p>';
    return;
  }
  estado = cargar();
  avisarSiNoGuarda();
  window.addEventListener('hashchange', enrutar);
  enrutar();
}

arrancar();
