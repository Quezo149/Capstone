# ContadorIA — Prototipo navegable

Prototipo funcional de la app de gestión financiera para PYMEs, importado desde el
proyecto de Claude Design **"Prototipo app web multiplataforma"** (`ContadorIA App.dc.html`)
y convertido en una aplicación web autónoma que corre en el navegador, sin backend.

Pensado para que **clientes lo prueben** en PC y celular. Las funciones que dependerían
del backend real (IA de boletas, Azure AD, multi-empresa, envío de correos) están
simuladas; lo que sí es completamente funcional:

| Sistema | Estado en el prototipo |
|---|---|
| **Drag & drop / importación CSV** | Real. Arrastra un `.csv`, se parsea, valida fila por fila, muestra preview (válidas / con error) y al confirmar inserta los movimientos. Detecta separador `,` o `;`, tildes, y varios formatos de fecha. |
| **Generar movimientos** | Real. "Nuevo movimiento" abre un formulario que valida y agrega el movimiento (origen `manual`), a nombre del rol activo. También se pueden eliminar. |
| **Generar reportes** | Real. KPIs (ingresos, gastos, balance, margen) y gasto por categoría se **calculan** desde los movimientos del período elegido. Exporta el reporte a CSV y tiene vista imprimible (PDF vía "Imprimir"). |
| **Usuarios** | Empiezan **vacíos** (requisito). "Invitar usuario" agrega a la lista; se puede cambiar rol, activar/desactivar y quitar. |
| Login | Demo: cualquier correo y contraseña entran. Botón SSO simula el acceso. |
| Roles | `Admin` / `Contador` / `Empleado` con "Ver como" — cambian navegación, permisos y qué datos se ven. |

## Arranca en blanco

La app parte **sin empresa, sin movimientos y sin usuarios**, para que armes una
instancia desde cero según lo que necesite tu cliente:

1. Login (cualquier correo/contraseña).
2. Pantalla **"Crea tu empresa"**: pones el nombre del emprendimiento → entras al dashboard vacío.
3. Desde ahí: cargas movimientos, importas un CSV e invitas usuarios.

En la barra lateral (o el menú **"Más"** en celular):

- **Datos de ejemplo** — carga una empresa de muestra con ~20 movimientos, para ver todo funcionando de inmediato.
- **Vaciar todo** — vuelve al estado en blanco.
- El nombre de la empresa se cambia en cualquier momento con el ✎ de la barra superior.

Los datos se guardan en `localStorage` del navegador y persisten al recargar (clave `contadoria_proto_v2`).

## Cómo ejecutarlo

Necesita servirse por HTTP (no abrir el archivo con `file://`, para que funcionen
el service worker y la lectura de archivos de forma consistente).

### Opción 1 — Python (ya instalado en la mayoría de los equipos)

```bash
cd Prototipo
python -m http.server 8000
```

Luego abre <http://localhost:8000> en el navegador.

### Opción 2 — Node

```bash
cd Prototipo
npx serve .        # o:  npx http-server -p 8000
```

### Probar en el celular

1. El PC y el celular deben estar en la **misma red Wi-Fi**.
2. Averigua la IP local del PC (`ipconfig` en Windows → "Dirección IPv4", ej. `192.168.1.20`).
3. En el celular abre `http://192.168.1.20:8000`.
4. Opcional: "Agregar a pantalla de inicio" — está configurado como PWA (`manifest.webmanifest` + `sw.js`) y funciona offline tras la primera carga.

## Archivos

| Archivo | Qué es |
|---|---|
| `index.html` | La app completa: markup, estilos y lógica (JS vanilla, sin dependencias ni build). |
| `manifest.webmanifest` | Metadatos PWA (nombre, colores, íconos). |
| `sw.js` | Service worker: cachea la app para uso offline. Solo se registra en `http/https`. |

## Formato del CSV de importación

Descargable desde la pantalla **Importar → "Descargar plantilla"**. Columnas:

```
fecha,monto,tipo,categoria,proveedor,descripcion
2026-08-01,-52300,gasto,Insumos,Distribuidora Ñuble,Harina y levadura
2026-08-05,920100,ingreso,Ventas,Venta mostrador,Resumen semanal
```

- `fecha`: `AAAA-MM-DD` o `DD/MM/AAAA` (también `DD-MM-AAAA`).
- `monto`: número; el signo negativo o el `tipo` determinan gasto/ingreso.
- `tipo`: `gasto` o `ingreso` (si falta, se infiere del signo del monto).
- Se aceptan encabezados alternativos comunes (`date`, `amount`, `category`, …).
- XLSX no se procesa en el prototipo: expórtalo como CSV.

Las filas con error no se importan y se pueden descargar aparte para corregir y reintentar.
