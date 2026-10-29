# Almacenamiento de comprobantes

Las fotos y PDF de boletas y facturas (HU08/HU09) van al contenedor privado `comprobantes` de la
cuenta `stkontadoria`. Solo el backend accede; la app nunca recibe una URL pública.

## Ciclo de vida de un archivo

| Momento | Dónde queda | Quién lo hace |
|---|---|---|
| Se sube para leerlo con la IA (`POST /documentos/extraer`) | `pendientes/<empresa_id>/<uuid>.<ext>` | backend |
| El usuario confirma el movimiento (`POST /movimientos`) | se mueve a `<empresa_id>/<año>/<mes>/<uuid>.<ext>` y se guarda en `movimientos.archivo_blob` | backend |
| El usuario cancela | se borra | backend |
| Nadie confirma ni cancela (pestaña cerrada, sin conexión) | lo borra Azure al día siguiente | regla de ciclo de vida |

Así no quedan guardadas fotos con datos de compras que nadie registró (política de privacidad).
La regla solo mira `pendientes/`: los comprobantes confirmados nunca se borran solos.

## Cargar la regla (una vez)

Archivo: [`ciclo-de-vida-comprobantes.json`](ciclo-de-vida-comprobantes.json).

**Portal:** Storage account `stkontadoria` → Data management → Lifecycle management →
pestaña *Code view* → pegar el JSON → Save.

**CLI (alternativa):**

```bash
az storage account management-policy create \
  --account-name stkontadoria --resource-group <grupo> \
  --policy @infra/storage/ciclo-de-vida-comprobantes.json
```

Azure revisa las reglas una vez al día, así que un archivo abandonado puede durar entre 1 y 2 días.
Cuando se migre a la cuenta profesional, volver a cargar la regla en la cuenta nueva.
