# KontadorIA · App

App web para la PYME (React 19 + Vite). Usa la misma marca que `/landing`: los tokens de
color, el logo, las animaciones y el tema claro/oscuro se copiaron desde ahí.

## Correr en local

```bash
cd frontend
npm ci             # instala exactamente lo que dice package-lock.json
npm run dev        # http://localhost:5173
```

Para probar desde el celular en la misma red Wi-Fi:

```bash
npm run dev -- --host     # muestra la URL "Network", por ejemplo http://192.168.1.11:5173
```

Si el computador usa `ufw`, hay que abrir el puerto para la red local:
`sudo ufw allow from 192.168.1.0/24 to any port 5173 proto tcp`.

No necesita backend ni Azure: los movimientos se guardan en el `localStorage` del navegador
(clave `kontadoria-movimientos-v1`).

### Herramientas de datos (`?debug`)

Abriendo **http://localhost:5173/?debug** aparece en la barra lateral un panel para cargar
datos de ejemplo o borrar todo. Sin `?debug` está oculto, para que la app se vea como producto.

## Qué incluye

- **Movimientos manuales:** crear, editar y eliminar (con "Deshacer"). Filtros por tipo,
  categoría y mes, y búsqueda que ignora tildes. Totales de lo filtrado.
- **Inicio:** ingresos, gastos y resultado del mes, comparados con los mismos días del mes
  anterior; gastos por categoría y últimos movimientos.
- **Formulario:** monto con separador de miles, desglose de IVA en facturas, categorías del
  tipo elegido, validación y "Guardar y otro". La tecla `N` lo abre.
- **Layout responsivo:** barra lateral desde 861 px y barra inferior con botón "+" en el celular.
  Revisado de 320 a 1920 px. La tabla de movimientos se usa desde 1024 px; bajo eso, una lista.
- Cargar boleta, Por revisar, Reportes y Equipo aparecen desactivadas en el menú ("Pronto").

## Datos de ejemplo

La empresa de ejemplo es **Pollito Picarón**, uno de los negocios entrevistados
(*03 Registro de Stakeholders*). Por la condición de la entrevista solo se muestra el nombre
del negocio: no hay nombre de persona (el usuario aparece por su rol) ni RUT. Los montos y
proveedores del ejemplo son ilustrativos, no las cifras reales del negocio.

## Estructura

```
src/
  data/        movimientos.js   repositorio: hoy localStorage, después la API
               categorias.js    categorías globales con códigos estables
               demo.js          empresa y usuario de ejemplo
               secciones.js     menú; listo: true activa una sección
  state/       Movimientos.jsx  contexto con la lista y el CRUD
               Toasts.jsx       avisos (con "Deshacer" y confeti)
  components/  Shell, Drawer, MovimientoForm, Seg, Numero, Logo, Mark, Icon
  views/       Inicio, Movimientos, Bienvenida, Pronto, DatosLocales
  hooks/       useTheme, useInView (de la landing), useHashRoute
  lib/         format.js        pesos chilenos, fechas DD-MM-AAAA e IVA
  styles/      tokens.css y animations.css (de la landing), app.css
```

Las rutas usan `#` (`#/inicio`, `#/movimientos`), así funcionan en cualquier hosting
estático sin configurar redirecciones.

## Conectar la API después

Un movimiento tiene la forma de la tabla `movimientos` (*06 Modelo de Datos*): `fecha`,
`monto`, `tipo`, `categoria_id`, `proveedor`, `descripcion`, `tipo_documento`, `origen` y
`client_request_id` (para no duplicar si se guarda dos veces). `empresa_id` y `usuario_id`
no los envía el frontend: los pondrá el backend a partir del token.

Para usar `func-kontadoria` basta con reescribir el interior de `src/data/movimientos.js` con
`fetch`: sus funciones ya son `async` y las vistas no cambian.

## Mantener la marca sincronizada

`src/styles/tokens.css` es una copia del de la landing, más cuatro tokens propios
(`ingreso-tint`, `gasto-tint`, `warn-tint`, `scrim`). Si cambia un color de la marca,
hay que cambiarlo en los dos lados.
