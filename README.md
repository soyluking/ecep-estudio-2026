# Sitio de estudio: Evaluación Docente 2026, Matemática básica

HTML, CSS y JS sin build. El progreso se guarda en el navegador (localStorage).

## Probarlo en local

```
cd sitio
python3 -m http.server 8000
```

Luego abrir http://localhost:8000. Hace falta servidor: con doble clic en `index.html` el navegador bloquea la carga de `banco.json`.

## Qué hay

- `banco.json`: preguntas oficiales 2017–2024 (solo cerradas), con clave, explicación propuesta y grupo de repetidas. Se genera, no se edita a mano.
- `img/`: figuras recortadas de los PDF oficiales.
- `js/logica.js`: diagnóstico, repetición de errores (1, 3 y 7 días) y armado de sesiones.

## Aviso

Las preguntas, claves y figuras provienen de las pruebas oficiales publicadas en evaluacionconocimientos.cl. Este sitio es material de estudio personal, sin fines de lucro y sin afiliación oficial. Las explicaciones son propuestas y no reemplazan la clave oficial.
