# KontadorIA — Prototipo del Sprint 3

Copia de la app real (`/frontend`) **con datos falsos**, para mostrar cómo se verán las historias
del Sprint 3 antes de construirlas. No llama al backend, no pide iniciar sesión con Microsoft y
nada sale del navegador: los datos se guardan en `localStorage`.

| Historia | Qué muestra el prototipo |
|---|---|
| **HU08** Cargar boleta o factura | Sección **Cargar boleta**: arrastrar, elegir archivo o sacar foto (en el celular), indicador de lectura y, si falla, paso al formulario manual con el documento adjunto. |
| **HU09** Validar lo extraído | Formulario prellenado con marcas *Leído por IA* / *Revisa este dato* / *Corregido*, categoría sugerida por historial del proveedor, vista "Lo que leyó la IA" sobre el documento, **Confirmar y guardar** o **Cancelar** sin guardar nada. |
| **HU18** Dashboard | Selector de mes, gráfico de dona por categoría con sus colores, saldo del mes y últimos movimientos del mes elegido. El colaborador solo ve lo suyo. |

Además: los movimientos que vienen de foto o PDF muestran su ícono en la lista y el documento
adjunto al editarlos; el registro manual ofrece el atajo "¿Tienes la boleta?".

**Lo simulado:** la llamada a la IA (en la app real será Azure AI Document Intelligence vía
`POST /documentos/extraer`). Los 7 ejemplos son **fotos reales** de boletas y vouchers POS
(`ejemplos/`), y lo que muestra la pantalla es lo que Document Intelligence leyó de verdad en ellas,
con la posición de cada dato (`fuente/src/data/ejemplos-lectura.json`, generado con
`backend/scripts/probar_lectura.py`, `locale="es-CL"`). Las fotos van sin metadatos (EXIF/GPS), sin
la sección "Mi Club" de Líder y con el RUT de la persona del voucher Pluxee pixelado. **No van en la
versión de producción.**

Reglas que se prueban aquí y pasarán al backend:
- **Tipo de documento** por el texto impreso que exige el SII ("Boleta Electrónica", "Bol.
  Electronica", "Válido como boleta"); "Comprobante de venta" queda a revisar y el voucher de pago
  queda como "otro".
- **RUT del emisor** validado con dígito verificador: es la llave del historial de categorías.
- **Proveedor a revisar** si la IA no lo encontró o si es una sola palabra, aunque venga con 99 %.
- **Aviso de duplicado**: mismo monto, fecha y RUT/proveedor (voucher + boleta de la misma compra).
  Para verlo: guarda el voucher de Mercado Pago y luego carga la boleta de XS Market.

Con un archivo propio, el prototipo muestra tu imagen pero propone datos de muestra. El historial
sembrado (movimientos de meses anteriores) usa boletas dibujadas con comercios, RUT y personas
inventados.

## Controles del prototipo

Barra amarilla abajo a la izquierda (sobre la barra inferior en el celular):

- **Ver como**: Dueño, Contador o Colaborador. Cambia menús y permisos igual que en la app real
  (el contador no carga boletas; el colaborador solo ve sus movimientos).
- **↺**: vuelve a los datos de ejemplo.

## Cómo abrirlo

```bash
cd Prototipo
python -m http.server 8000
```

Abrir <http://localhost:8000>. Para el celular: misma red Wi-Fi y `http://<IP-del-PC>:8000`.

## Cómo modificarlo

El código está en `fuente/` (copia de `/frontend` con la sesión y la API reemplazadas):

```bash
cd Prototipo/fuente
npm install
npm run dev      # para trabajar
npm run build    # compila y copia el resultado a Prototipo/
```

Archivos propios del prototipo: `src/lib/proto.js` (datos falsos), `src/lib/api.js` (API simulada),
`src/auth/msal.js` (sesión simulada), `src/lib/documentos.js` (documentos y lectura simulada),
`src/views/Cargar.jsx`, `src/components/VisorDocumento.jsx` y `src/components/ProtoBar.jsx`.
Los cambios a `MovimientoForm.jsx`, `Inicio.jsx`, `Movimientos.jsx` y `App.jsx` están marcados con
`PROTOTIPO`.

`sw.js` existe solo para desactivar el service worker del prototipo anterior en los navegadores
que lo tenían guardado.
