import { useEffect, useRef } from 'react'
import Icon from './Icon'
import { CONTACTO, HASH, RESPONSABLES, VERSION, VIGENTE_DESDE } from '../data/privacidad'
import './PrivacyDialog.css'

// Política de privacidad de la app (cuenta, empresa y movimientos), en un <dialog> nativo (foco atrapado,
// Esc para cerrar y devolución del foco al enlace los resuelve el navegador).
// Se abre con cualquier enlace a #privacidad; el botón Atrás del navegador también lo cierra.
// Contenido exigido por la Ley 21.719, art. 14 ter (deber de información y transparencia).
export default function PrivacyDialog() {
  const ref = useRef(null)

  useEffect(() => {
    const dialog = ref.current
    const sync = () => {
      if (window.location.hash === HASH) {
        if (!dialog.open) dialog.showModal()
      } else if (dialog.open) {
        dialog.close()
      }
    }
    sync()
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])

  // Al cerrar (Esc, botón o clic fuera) se quita el hash para que el mismo enlace vuelva a abrirlo.
  function onClose() {
    if (window.location.hash === HASH) {
      history.replaceState(null, '', window.location.pathname + window.location.search)
    }
  }

  // El clic en el fondo oscuro llega con target = el propio <dialog> (el contenido ocupa todo su interior).
  function onClick(e) {
    if (e.target === ref.current) ref.current.close()
  }

  const correo = <a href={`mailto:${CONTACTO}`}>{CONTACTO}</a>

  return (
    <dialog ref={ref} className="privacy" aria-labelledby="privacy-title" onClose={onClose} onClick={onClick}>
      <div className="privacy-inner">
        <header className="privacy-head">
          <div>
            <h2 id="privacy-title">Política de privacidad</h2>
            <p className="privacy-meta">
              Versión {VERSION} · vigente desde el {VIGENTE_DESDE}
            </p>
          </div>
          <button type="button" className="privacy-close" onClick={() => ref.current.close()} aria-label="Cerrar">
            <Icon name="x" />
          </button>
        </header>

        <div className="privacy-body">
          <p>
            Aquí explicamos cómo tratamos tus datos cuando creas una cuenta y usas KontadorIA, la app para registrar los
            gastos e ingresos de tu PYME. Esta política sigue la Ley N° 19.628 sobre protección de la vida privada y la
            Ley N° 21.719, que la modifica y entra en vigencia el 1 de diciembre de 2026.
          </p>

          <h3>1. Quién es responsable de tus datos</h3>
          <p>
            KontadorIA es un proyecto de título de estudiantes de Duoc UC y todavía no es una empresa constituida. Los
            responsables del tratamiento son los integrantes del equipo: {RESPONSABLES}.
            No hay representante legal ni encargado de prevención designado.
          </p>
          <p>
            Los movimientos y documentos que tu empresa registra pertenecen a tu empresa: el dueño decide quién los ve
            y qué se guarda, y nosotros los tratamos por cuenta de ella para prestar el servicio.
          </p>
          <p>Para cualquier consulta o solicitud sobre tus datos, escríbenos a {correo}.</p>

          <h3>2. Qué datos recogemos</h3>
          <ul>
            <li>
              <b>Tu cuenta:</b> tu correo y tu nombre. Tu contraseña la escribes en la página de Microsoft
              (Entra External ID), que verifica tu correo y guarda la contraseña; KontadorIA nunca la ve ni la guarda.
            </li>
            <li>
              <b>Tu empresa:</b> su nombre, RUT y giro, quiénes forman el equipo y con qué rol (dueño, contador o
              colaborador), y las invitaciones enviadas (correo invitado, rol y fechas).
            </li>
            <li>
              <b>Lo que registras:</b> los movimientos (fecha, monto, categoría, proveedor, descripción y tipo de
              documento), quién registró cada uno y, si los subes, las fotos o PDF de boletas y facturas.
            </li>
            <li>
              <b>Los que agrega el sistema:</b> fechas de creación, cambios y anulaciones, para que el equipo sepa qué
              se hizo y cuándo.
            </li>
          </ul>
          <p>
            No pedimos datos sensibles. Una boleta o factura puede incluir datos de terceros (por ejemplo, el nombre o
            RUT de quien la emitió); los guardamos solo como parte del registro de tu empresa.
          </p>
          <p>
            Como cualquier sitio web, nuestros proveedores guardan datos técnicos de la conexión (por ejemplo, la
            dirección IP) en sus registros de funcionamiento y seguridad. No los usamos para identificarte. La app no
            usa cookies de publicidad ni de seguimiento; solo guarda en tu navegador lo necesario para mantener tu
            sesión abierta.
          </p>

          <h3>3. Para qué los usamos</h3>
          <ul>
            <li>Para que inicies sesión y accedas solo a lo que tu rol permite en tu empresa.</li>
            <li>Para guardar y mostrarte los movimientos de tu empresa, sus reportes y sus respaldos.</li>
            <li>Para leer automáticamente los datos de las boletas y facturas que subes y prellenar el registro.</li>
            <li>Para enviar las invitaciones que tú generas para sumar a tu contador o colaboradores.</li>
            <li>Para contactarte sobre tu participación en el piloto y pedirte feedback.</li>
            <li>Para elaborar estadísticas agregadas, sin identificar a nadie, para el informe académico del proyecto.</li>
          </ul>
          <p>
            No los usamos para publicidad ni te enviaremos promociones. No vendemos ni cedemos tus datos a terceros. La
            lectura automática de documentos solo propone datos que tú revisas y confirmas: no tomamos decisiones
            automatizadas sobre ti.
          </p>

          <h3>4. Por qué podemos tratarlos</h3>
          <p>
            Porque son necesarios para prestarte el servicio que pides al crear tu cuenta y registrar tu empresa (art.
            13 de la Ley 21.719), y por tu consentimiento expreso (art. 4 de la Ley 19.628; art. 12 de la Ley 21.719). Lo
            das marcando la casilla de aceptación, que viene sin marcar, cuando registras tu empresa o aceptas una
            invitación; crear la cuenta en Microsoft no basta. Guardamos qué versión de esta política aceptaste y
            cuándo. Puedes retirarlo cuando quieras, como se explica en la sección 8; sin él no podemos mantener tu
            cuenta activa. Retirarlo no afecta lo que hicimos antes con tu consentimiento.
          </p>

          <h3>5. Dónde se guardan y quién más los ve</h3>
          <p>Usamos estos proveedores, que tratan los datos por cuenta nuestra (como encargados):</p>
          <ul>
            <li>
              <b>Microsoft Azure:</b> la base de datos, el almacenamiento de las fotos y PDF, el servidor de la app y la
              lectura automática de documentos (Azure AI Document Intelligence), en servidores ubicados en Estados
              Unidos, bajo sus términos de protección de datos para clientes.
            </li>
            <li>
              <b>Microsoft Entra External ID:</b> tu correo, nombre y contraseña para iniciar sesión.
            </li>
            <li>
              <b>Netlify:</b> aloja el sitio web y la app. No recibe tus movimientos ni documentos: viajan directamente a
              Azure.
            </li>
          </ul>
          <p>
            Dentro de tu empresa, cada persona ve lo que su rol permite: el dueño y el contador ven todos los
            movimientos; un colaborador ve solo lo que él mismo registró. Dentro del equipo de KontadorIA, solo sus tres
            integrantes tienen acceso a la base de datos, y solo para operar y dar soporte al servicio.
          </p>
          <p>
            <b>Transferencia internacional.</b> Como los servidores están fuera de Chile, guardar tus datos implica una
            transferencia internacional. A la fecha, la Agencia de Protección de Datos Personales no ha determinado si
            Estados Unidos ofrece un nivel adecuado de protección. Por eso te pedimos tu consentimiento expreso para esta
            transferencia, además de apoyarnos en las garantías contractuales de Microsoft.
          </p>

          <h3>6. Cuánto tiempo los guardamos</h3>
          <p>
            Mientras tu cuenta y tu empresa estén activas en KontadorIA. Si pides cerrarlas, o cuando termine el piloto
            sin que decidas continuar, eliminamos sus datos y documentos dentro de 30 días. Antes de eliminarlos te
            avisamos para que puedas descargar tus movimientos.
          </p>
          <p>
            Si el dueño desactiva tu acceso a una empresa, dejas de ver sus datos, pero los movimientos que registraste
            siguen siendo parte del registro de esa empresa.
          </p>

          <h3>7. Cómo los protegemos</h3>
          <ul>
            <li>La conexión entre tu navegador y nuestros servidores va cifrada (HTTPS).</li>
            <li>La base de datos y los documentos están cifrados en reposo.</li>
            <li>
              Inicias sesión con Microsoft, que verifica tu correo con un código y protege tu contraseña.
            </li>
            <li>
              Los datos de cada empresa están aislados en la base de datos: una empresa no puede ver los de otra.
            </li>
            <li>El acceso a la base de datos está restringido a los integrantes del equipo.</li>
          </ul>
          <p>
            Si ocurre un incidente de seguridad que afecte tus datos, lo informaremos en los términos que exige la ley.
          </p>

          <h3>8. Tus derechos y cómo ejercerlos</h3>
          <p>Respecto de tus datos, tienes derecho a:</p>
          <ul>
            <li><b>Acceso:</b> saber si tenemos datos tuyos, cuáles son y qué hacemos con ellos.</li>
            <li><b>Rectificación:</b> corregirlos si están incorrectos o desactualizados.</li>
            <li><b>Supresión:</b> pedir que los borremos.</li>
            <li><b>Oposición:</b> oponerte a un uso determinado.</li>
            <li><b>Portabilidad:</b> recibir una copia en un formato electrónico de uso común.</li>
            <li><b>Bloqueo:</b> pedir que dejemos de usarlos mientras resolvemos otra solicitud tuya.</li>
            <li><b>Retirar tu consentimiento</b> en cualquier momento.</li>
          </ul>
          <p>
            Para ejercerlos, escríbenos a {correo} desde el correo de tu cuenta (o indicando cuál es) y dinos qué
            necesitas. Es gratis. Si la solicitud es sobre los datos de una empresa, la atendemos junto con su dueño.
            Te confirmaremos que recibimos tu solicitud y te responderemos por escrito dentro de los plazos legales:
            hasta el 30 de noviembre de 2026, dentro de 2 días hábiles (Ley 19.628); desde el 1 de diciembre de 2026,
            dentro de 30 días corridos, prorrogables una sola vez por otros 30 (Ley 21.719).
          </p>
          <p>
            Si rechazamos tu solicitud o no respondemos a tiempo, puedes reclamar: hasta el 30 de noviembre de 2026, ante
            el juez de letras en lo civil; desde el 1 de diciembre de 2026, ante la Agencia de Protección de Datos
            Personales.
          </p>

          <h3>9. Si te inscribiste en el formulario del piloto</h3>
          <p>
            Hasta octubre de 2026 la página tenía un formulario de interés para el piloto (nombre, correo, empresa,
            tamaño del equipo y herramienta que usabas). Ese formulario ya no existe. Los datos que nos dejaste ahí se
            siguen tratando según la versión 1.0 de esta política, que aceptaste: solo para coordinar el piloto, y se
            eliminan al terminar el piloto o a los 12 meses desde tu registro, lo que ocurra primero. Puedes pedir que
            los borremos antes escribiendo a {correo}.
          </p>

          <h3>10. Cambios a esta política</h3>
          <p>
            Si cambiamos esta política, publicaremos aquí la nueva versión con su fecha. Si el cambio implica usar tus
            datos para algo distinto de lo que aceptaste, te pediremos de nuevo tu consentimiento.
          </p>
        </div>
      </div>
    </dialog>
  )
}
