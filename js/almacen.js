// Guardado del progreso en el navegador, con exportación e importación como respaldo.
import { estadoInicial } from './logica.js';

const CLAVE = 'ed2026-progreso-v1';
let disponible = true;

export function cargar() {
  try {
    const txt = localStorage.getItem(CLAVE);
    if (txt) {
      const e = JSON.parse(txt);
      if (validar(e)) return e;
    }
  } catch { disponible = false; }
  return estadoInicial();
}

export function guardar(estado) {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(estado));
    disponible = true;
  } catch { disponible = false; }
}

export const guardadoDisponible = () => disponible;

export function borrar() {
  try { localStorage.removeItem(CLAVE); } catch { /* sin acceso: nada que borrar */ }
}

export function validar(e) {
  return !!e && e.version === 1
    && Array.isArray(e.intentos)
    && e.intentos.every((i) => i && typeof i.id === 'string' && typeof i.grupo === 'string' && typeof i.ok === 'boolean' && Number.isFinite(i.t))
    && e.errores && typeof e.errores === 'object' && !Array.isArray(e.errores)
    && Object.values(e.errores).every((x) => x && typeof x.id === 'string' && typeof x.vence === 'string' && typeof x.abierto === 'boolean')
    && Number.isFinite(e.semilla) && Number.isFinite(e.sesiones);
}

export function exportar(estado, ahora = new Date()) {
  estado.exportado = ahora.toISOString();
  guardar(estado);
  const blob = new Blob([JSON.stringify(estado, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `progreso-evaluacion-docente-${ahora.toISOString().slice(0, 10)}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Devuelve el estado importado o lanza un Error con un mensaje para mostrar.
export async function leerImportacion(archivo) {
  let e;
  try { e = JSON.parse(await archivo.text()); } catch { throw new Error('El archivo no es un respaldo válido (no es JSON).'); }
  if (!validar(e)) throw new Error('El archivo no tiene el formato de un respaldo de este sitio.');
  return e;
}
