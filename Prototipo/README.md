# KontadorIA — Prototipo (Sprints 3 y 4)

Copia de la app real (`/frontend`) **con datos falsos**, para mostrar cómo se verán las historias
del Sprint 3 antes de construirlas. No llama al backend, no pide iniciar sesión con Microsoft y
nada sale del navegador: los datos se guardan en `localStorage`.

| Historia | Qué muestra el prototipo |
|---|---|
| **HU08** Cargar boleta o factura | Sección **Cargar boleta**: arrastrar, elegir archivo o sacar foto (en el celular), indicador de lectura y, si falla, paso al formulario manual con el documento adjunto. |
| **HU09** Validar lo extraído | Formulario prellenado con marcas *Leído por IA* / *Revisa este dato* / *Corregido*, categoría sugerida por historial del proveedor, vista "Lo que leyó la IA" sobre el documento, **Confirmar y guardar** o **Cancelar** sin guardar nada. |
| **HU18** Dashboard | Selector de mes, gráfico de dona por categoría con sus colores, saldo del mes y últimos movimientos del mes elegido. El colaborador solo ve lo suyo. |

### Sprint 4: importación masiva (sección **Importar planilla**, solo Dueño y Contador)

| Historia | Qué muestra el prototipo |
|---|---|
| **HU10** Importar CSV/XLSX | Plantilla descargable (Excel con listas de tipo y categoría, o CSV), subir o arrastrar un `.csv`/`.xlsx` (hasta 2 MB y 2.000 filas). La **plantilla es el camino recomendado**: se reconoce sola y pasa directo a la revisión. |
| **Planilla propia** (propuesta) | Tres pasos visibles: **Subir → Revisar → Listo**. La planilla se sube tal cual: se reconoce la hoja (las ocultas se ignoran), el encabezado aunque tenga título arriba y las columnas por sinónimos o, si no, por sus datos. El mapeo solo aparece si falta la fecha o el monto (o se adivinaron); si no, la revisión muestra **"Así entendimos tu planilla"** con 3 muestras por campo, "Revisa esto" en lo dudoso y **Cambiar columnas**. En la revisión: varias hojas con el mismo formato juntas, filas ocultas por filtro fuera (botón **Incluirlas**), celdas combinadas completadas, filas de totales (texto o `=SUMA`) omitidas, saldos que cuadran o no, categorías de la planilla asociadas ahí mismo (se recuerdan) y casillas para quitar filas. Re-subir el mismo archivo deja todo como "Ya importada" (huella por fila). Rechazos con instrucción por la firma del archivo: .xls, .ods, contraseña, PDF, imagen, página web, fórmulas sin resultado y libro diario Debe/Haber. El formato se recuerda (**Tus formatos guardados**). |
| **HU11** Validar filas | Cada fila queda *Lista* o con su motivo: fecha inválida o futura, monto no numérico o negativo (los decimales se redondean con una nota), tipo distinto de ingreso/gasto, categoría inexistente o de otro tipo, sin descripción. Las filas con error se descargan en un CSV con las mismas columnas del archivo más una columna `error` (protegido contra fórmulas de Excel). Aviso (no bloquea) si una fila parece repetida. |
| **HU12** Revisar antes de confirmar | Resumen (filas, listas, con error, montos a sumar), filtro Todas / Con error / Listas, **Importar N movimientos** o **Cancelar** sin guardar nada. |
| **HU13** Historial | Fecha y hora, archivo, quién importó, filas importadas / totales, resultado. **Anular** quita de una vez los movimientos de una importación (permiso `importaciones.anular`: está en el prototipo; si pasa a producción se decide con el equipo). |

Los movimientos importados quedan con origen `importacion_masiva`, a nombre de quien importó, y
se marcan con el ícono de planilla en Movimientos. Hay 15 ejemplos en tres grupos (con la plantilla,
planillas propias y casos especiales); los de .xls, contraseña y PDF son simulados (muestran el
mismo mensaje que el archivo real). Archivos reales para probar las mejoras: `KontadorIA_Pruebas/planillas-mejoras/`. Con un archivo propio la
lectura y la validación son **reales** (en el navegador; en la app real las hará el backend).

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

- **Ambiente**: *Demo* (empresa de ejemplo, con planillas y boletas de prueba) o *Producción* (como
  la app real el primer día: se registra la empresa y se parte sin movimientos ni ejemplos). Cada
  ambiente guarda sus datos por separado. También se elige abriendo la URL con `?produccion` o `?demo`.
- **Ver como** (solo en Demo): Dueño, Contador o Colaborador. Cambia menús y permisos igual que en la
  app real (el contador no carga boletas; el colaborador solo ve sus movimientos).
- **Entrar como** (solo en Producción, cuando ya hay más de una persona): cambia entre el dueño y quienes
  aceptaron una invitación. Para aceptar una, abre en el mismo navegador el link que da **Equipo →
  Invitar** y pulsa «Unirme»: como no hay cuentas reales, se entra como la persona invitada.
- **↺**: en Demo vuelve a los datos de ejemplo; en Producción borra todo y vuelve a registrar la empresa.

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
`src/views/Cargar.jsx`, `src/views/Importar.jsx`, `src/lib/importacion.js`, `src/components/VisorDocumento.jsx` y `src/components/ProtoBar.jsx`.
Los cambios a `MovimientoForm.jsx`, `Inicio.jsx`, `Movimientos.jsx` y `App.jsx` están marcados con
`PROTOTIPO`.

`sw.js` existe solo para desactivar el service worker del prototipo anterior en los navegadores
que lo tenían guardado.
