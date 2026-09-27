# Contenido de la landing — KontadorIA

Todo el texto de la landing, en el orden en que aparece en la página. Edita aquí directamente; después los cambios se pasan al código.

**Convenciones**

- `==texto==` = texto **resaltado** en la página (subrayado o marcador de color, componente `Mark`).
- `(archivo.jsx)` al lado de cada sección indica dónde vive el texto en `landing/src/components/`.
- Los textos marcados como *ejemplo* son datos ficticios de las ilustraciones (boletas, tablas, montos).
- Si quieres dejar un comentario sin cambiar el texto, usa `> NOTA: ...` debajo de la línea.

---

## 0. Pestaña del navegador y buscadores (`index.html`)

- **Título de la pestaña:** KontadorIA
- **Descripción para Google (meta description):** KontadorIA ordena los gastos e ingresos de tu PYME chilena. Sube boletas, importa Excel y comparte información ordenada con tu contador.

---

## 1. Barra de navegación (`Navbar.jsx`)

- Logo: Kontador**IA**
- Enlaces:
  - Cómo funciona
  - Equipo
  - Seguridad
  - Planes
  - Preguntas
- Botón: **Súmate al piloto**

---

## 2. Portada (`Hero.jsx`)

- **Etiqueta superior:** Para PYMEs chilenas, sin importar el tamaño
- **Título:** Tus boletas en ==orden==.
- **Bajada:** Saca una foto, sube el PDF o importa el Excel que ya usas. KontadorIA lee los datos, tú los confirmas, y tu contador recibe todo ordenado. Sin aprender un software contable.
- **Botón principal:** Súmate al piloto gratis →
- **Botón secundario:** Ver cómo funciona
- **Garantías (con check):**
  - Sin tarjeta de crédito
  - Trae tu planilla actual
  - Funciona en el celular

### 2.1 Animación de la boleta (`HeroDemo.jsx`)

**Boleta (ejemplo):**

```
FERRETERÍA LOS ALERCES
RUT 76.482.915-3
Av. Vicuña Mackenna 7110
---
BOLETA ELECTRÓNICA
N° 0048213 · 22-09-2026
---
TORNILLO 1/4 X100      3.490
CINTA AISLANTE         1.990
BROCHA 2"              2.590
---
NETO                   6.782
IVA 19%                1.288
TOTAL                $ 8.070
Timbre electrónico SII
```

**Tarjeta resultante:**

- Título: **Nuevo movimiento**
- Insignia: Revisa y confirma
- Proveedor: Ferretería Los Alerces
- Fecha: 22-09-2026
- Monto: $ 8.070
- Categoría: Materiales *(sugerida)*
- Documento: Boleta · gasto
- Botones: Corregir / Confirmar
- Botón para repetir la animación: Ver de nuevo

---

## 3. El problema (`Problem.jsx`)

- **Etiqueta:** El problema
- **Título:** Hoy tus gastos viven en ==tres lugares distintos==.

**Tarjeta 1 — La planilla**

- Ilustración (ejemplo): `gastos_sept_FINAL(2).xlsx` · ~~Bencina 45.000~~ · Bencina?? #¡VALOR!
- Texto: Tres versiones, fórmulas rotas y filas que alguien tipeó dos semanas tarde.

**Tarjeta 2 — El WhatsApp**

- Ilustración (ejemplo): "te mando la boleta del almuerzo con el cliente" (23:41) · "y la de ayer?? no la encuentro" (23:52)
- Texto: Fotos de boletas perdidas entre stickers y audios, imposibles de encontrar después.

**Tarjeta 3 — El papel**

- Ilustración (ejemplo): Boletas en la guantera ~ 14 · Legibles ~ 9
- Texto: La boleta térmica se borra con el calor. Si no la registras pronto, el gasto desaparece.

**Cierre:** Tu contador recibe el desorden. Tú no sabes en qué se fue la plata ==hasta que toca ordenar todo.==

---

## 4. Cómo cargas tus movimientos (`LoadTabs.jsx` + `LoadMocks.jsx`)

- **Etiqueta:** Cómo cargas tus movimientos
- **Título:** ==Tres formas de cargar.== Sin abandonar lo que ya tienes.

### Pestaña 1 — Foto o PDF

- Nombre de la pestaña: **Foto o PDF** · La IA lee la boleta o factura
- Título: Saca la foto y ==listo==.
- Texto: Desde el celular abres la cámara; desde el computador arrastras el archivo. Leemos fecha, proveedor, monto y tipo de documento, y te proponemos una categoría.
- Puntos:
  - Fotos de boletas y PDF de facturas, incluso de varias páginas
  - Nada se guarda hasta que tú confirmas
  - Si no se puede leer, pasas directo al formulario
- Ilustración (ejemplo): "Subir documento" · Arrastra la boleta o factura · JPG, PNG o PDF · `factura_proveedor.pdf · 3 págs.` · Leyendo datos...

### Pestaña 2 — Excel o CSV

- Nombre de la pestaña: **Excel o CSV** · Importa tu historial de una vez
- Título: Tu Excel de siempre, importado en ==un paso==.
- Texto: Descarga la plantilla, pega tu historial o el archivo que exportaste del banco, y súbelo. Antes de importar ves exactamente qué filas entran y cuáles tienen problemas.
- Puntos:
  - Vista previa del lote antes de guardar
  - Descargas las filas con error para corregirlas
  - Exportas en el mismo formato que importas
- Ilustración (ejemplo): "Vista previa de importación" · 148 filas válidas · 3 con error

  | Fecha | Proveedor | Categoría | Monto |
  |---|---|---|---|
  | 02-09-2026 | Copec | Combustible | 45.000 |
  | 03-09-2026 | Arriendo local | Arriendo | 480.000 |
  | Falta fecha | Líder | Insumos | 18.450 |
  | 05-09-2026 | Entel | Servicios | 24.990 |

### Pestaña 3 — A mano

- Nombre de la pestaña: **A mano** · Para el gasto sin boleta
- Título: Para lo que ==no trae boleta==.
- Texto: El pago al maestro, la propina, el ingreso por transferencia. Un formulario corto, pensado para llenarlo en diez segundos desde el celular.
- Puntos:
  - Gastos e ingresos en el mismo lugar
  - Categorías que se adaptan a tu rubro
  - Montos en pesos, sin decimales
- Ilustración (ejemplo): "Nuevo movimiento" · Gasto / **Ingreso** · Fecha 21-09-2026 · Monto $ 150.000 · Descripción: Transferencia cliente, pedido 214 · Categoría: Ventas

---

## 5. Tres pasos (`Steps.jsx`)

- **Etiqueta:** Del documento al contador
- **Título:** Tu mes, en ==tres pasos==.

1. **Cargas el gasto el mismo día** — Tú o tus empleados suben la boleta desde el celular apenas pagan. Se acabó la guantera.
2. **Revisas y confirmas** — La IA propone, tú decides. Corriges lo que haga falta y el movimiento queda registrado con su documento original.
3. **Tu contador lo tiene listo** — Entra con su propio acceso, filtra por fecha o categoría y exporta a Excel. Sin correos con adjuntos ni archivos perdidos.

---

## 6. Roles del equipo (`Roles.jsx`)

- **Etiqueta:** Para ti y tu equipo
- **Título:** Tu equipo, ==tu control==.
- **Bajada:** Dueños, contadores y empleados trabajan en la misma plataforma, pero cada uno accede solo a lo que necesita.

**Dueño** — Quien lleva el negocio

- ✓ Ve todos los movimientos y reportes
- ✓ Invita y gestiona al equipo
- ✓ Define categorías y presupuestos

**Contador** — Tu asesor financiero

- ✓ Lee todos los movimientos
- ✓ Exporta reportes a Excel o CSV
- ✗ No cambia usuarios ni configuración

**Empleado** — Registra los movimientos del día a día

- ✓ Sube boletas por foto, PDF o a mano
- ✓ Ve solo lo que él mismo cargó
- ✗ No ve reportes de la empresa

---

## 7. Seguridad (`Security.jsx`)

- **Etiqueta:** Seguridad
- **Título:** Tus números están separados ==de otras empresas==.
- **Bajada:** Cada empresa tiene su propio espacio y cada usuario ve solo lo que necesita. Los datos de tu negocio se mantienen separados de los de otras empresas.

**Garantías:**

- **Solo ves los movimientos de tu negocio** — Antes de mostrar información, el sistema comprueba a qué negocio perteneces.
- **Cada negocio ve lo suyo** — Los movimientos de cada empresa se guardan en su propio espacio y no se mezclan con otras.
- **Invitaciones a nombre de una persona** — El link solo funciona con el correo invitado, sirve una sola vez y vence a las 72 horas.
- **Boletas guardadas por separado** — Los archivos de cada empresa quedan en su propio espacio y se abren con enlaces que expiran.

**Ilustración (ejemplo):**

| Panadería Don Luis *(empresa A)* | | Taller Rivas *(empresa B)* | |
|---|---|---|---|
| Harina | − $ 86.400 | Repuestos | − $ 312.900 |
| Gas | − $ 42.300 | Arriendo | − $ 450.000 |
| Ventas | + $ 1.204.000 | Reparaciones | + $ 890.500 |

Leyenda: + ingreso · − gasto

**Nota al pie:** Empresas y montos de ejemplo. KontadorIA se diseña teniendo presente la Ley N° 21.719 de protección de datos personales.

---

## 8. Planes (`Pricing.jsx`)

- **Etiqueta:** Planes
- **Título:** ==Empieza gratis.== Construyamos juntos el futuro de tus finanzas.
- **Bajada:** Sé parte de las primeras PYMEs en probar la plataforma. Durante el piloto es gratis y tu feedback nos ayudará a mejorarla.

**Free** — Empieza a organizar las finanzas de tu negocio.

- Precio: **$ 0** · para siempre
- ✓ 1 usuario
- ✓ Movimientos y lecturas con IA limitados al mes
- ✓ Importación de Excel
- Botón: Súmate al piloto

**PYME** *(destacado)* — Lleva la gestión financiera a todo tu equipo.

- Etiqueta superior: Gratis durante el piloto
- Precio: **$ 0** · durante el piloto
- ✓ Dueño, contador y empleados
- ✓ Lectura de boletas y facturas sin límite duro
- ✓ Reportes por categoría, usuario y fecha
- ✓ Presupuestos por categoría
- Botón: Súmate al piloto

**Tarjeta para contadores** (tercera tarjeta, borde punteado y sin precio; todavía no es un plan)

- Título: ¿Eres contador y llevas varias PYMEs?
- Texto: Estamos diseñando una cuenta para gestionar a todos tus clientes en un solo lugar. Súmate al piloto y cuéntanos qué necesitas.
- Botón: Súmate como contador → *(lleva al formulario)*

**Notas bajo los planes:**

- Estamos construyendo la plataforma junto a las primeras PYMEs que la prueban.
- Durante el piloto, puedes usarla sin costo y ayudarnos a mejorarla con tu feedback.

---

## 9. Preguntas frecuentes (`Faq.jsx`)

- **Etiqueta:** Preguntas frecuentes
- **Título:** Lo que nos preguntan ==antes de partir==.

**¿Reemplaza a mi facturador electrónico del SII?**
No. KontadorIA no emite boletas ni facturas y no hace contabilidad completa (libro mayor, balances tributarios). Registra y ordena los documentos que ya emites y recibes, para que tú entiendas tus números y tu contador trabaje con datos limpios.

**¿Tengo que dejar mi Excel?**
No. Puedes importar tu historial utilizando nuestra plantilla y, si quieres, sigues exportando a Excel cuando lo necesites. El formato de exportación es el mismo de importación.

**¿Qué pasa si la IA lee mal una boleta?**
La IA no guarda automáticamente lo que interpreta. Primero te mostramos los datos que encontró para que puedas revisarlos y corregirlos antes de confirmar. Si no puede leer una boleta, puedes ingresar los datos manualmente.

**¿Necesito instalar algo?**
No. La aplicación funciona directamente en el navegador del celular y del computador, y puedes agregarla a la pantalla de inicio como si fuera una app.

**¿Se conecta automáticamente con mi banco?**
No, y nunca te pediremos tus claves bancarias. Puedes exportar la cartola o los movimientos desde tu banco e importarlos como archivo.

**¿Funciona con dólares u otras monedas?**
Por ahora, KontadorIA trabaja solo con pesos chilenos y montos enteros.

**¿Cuánto cuesta?**
Durante el piloto, puedes usar la plataforma sin costo y ayudarnos a mejorarla con tu feedback. Antes de que termine, te contaremos el precio para continuar y tú decides si seguir.

---

## 10. Formulario del piloto (`SignupForm.jsx`)

- **Etiqueta:** Programa piloto
- **Título:** Buscamos las primeras ==PYMEs==.
- **Bajada:** Durante el piloto usas el plan PYME completo sin costo. A cambio, nos cuentas qué funciona y qué no. Cupos limitados.

**Campos** (etiqueta — texto de ejemplo dentro del campo):

- Tu nombre — María González
- Correo — maria@tupyme.cl
- Empresa — Nombre de tu PYME
- Personas en el equipo — opciones:
  - Solo yo
  - 2 a 5 *(preseleccionada)*
  - 6 a 10
  - 11 a 20
  - Más de 20
- ¿Dónde llevas tus gastos hoy? — opciones:
  - Excel o Google Sheets *(preseleccionada)*
  - WhatsApp y fotos
  - Papel y boletas sueltas
  - Otro sistema
- Casilla (desmarcada por defecto): Soy contador y llevo las finanzas de varias PYMEs

> Las opciones de los dos menús se pueden reescribir libremente: lo que se guarda en la base es un código interno. Solo **agregar o quitar** opciones requiere tocar el backend y la base de datos.

- **Botón:** Quiero sumarme al piloto → *(mientras envía: "Enviando…")*
- **Texto bajo el botón:** Usaremos tu correo solo para contactarte sobre el piloto.

**Mensajes de error:**

- Nombre vacío: Escribe tu nombre para saber a quién contactar.
- Correo inválido: Revisa el correo: debe verse como nombre@empresa.cl.
- Empresa vacía: Falta el nombre de tu empresa.
- El servidor rechazó los datos: Revisa los datos del formulario e inténtalo de nuevo.
- Error del servidor: No pudimos registrar tus datos. Inténtalo de nuevo en unos minutos.
- Sin conexión: No pudimos conectar con el servidor. Revisa tu conexión.

**Mensaje de éxito:**

- Título: Listo, *[primer nombre]*.
- Texto: Registramos el interés de ***[empresa]***. Te escribiremos para coordinar el inicio del piloto.

---

## 11. Pie de página (`Footer.jsx`)

- Logo: Kontador**IA**
- Texto: Gestión de gastos e ingresos para PYMEs chilenas · Santiago, Chile · 2026

---

## 12. Textos no visibles (lectores de pantalla)

No se ven en pantalla, pero los leen los lectores de pantalla y algunos buscadores.

- Logo en la barra: "KontadorIA, inicio"
- Logo en el pie: "KontadorIA, volver arriba"
- Botón de tema: "Activar modo claro" / "Activar modo oscuro" · tooltip: "Cambiar entre modo claro y modo oscuro"
- Animación de la portada: "Ejemplo: una boleta fotografiada se convierte en un movimiento listo para confirmar"
- Pestañas de carga: "Formas de cargar movimientos"
- Ilustración de seguridad: "Ilustración: dos empresas separadas por un muro"
