import { useEffect, useRef } from 'react'
import Icon from './Icon'
import { CONTACTO, HASH, RESPONSABLES, VERSION, VIGENTE_DESDE } from '../data/privacidad'
import './PrivacyDialog.css'

// Política de privacidad del formulario piloto, en un <dialog> nativo (foco atrapado,
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
            Aquí explicamos cómo tratamos los datos que nos entregas en el formulario del programa piloto de
            KontadorIA. Esta política sigue la Ley N° 19.628 sobre protección de la vida privada y la Ley N° 21.719,
            que la modifica y entra en vigencia el 1 de diciembre de 2026.
          </p>

          <h3>1. Quién es responsable de tus datos</h3>
          <p>
            KontadorIA es un proyecto de título de estudiantes de Duoc UC y todavía no es una empresa constituida. Los
            responsables del tratamiento son los integrantes del equipo: {RESPONSABLES}.
            No hay representante legal ni encargado de prevención designado.
          </p>
          <p>Para cualquier consulta o solicitud sobre tus datos, escríbenos a {correo}.</p>

          <h3>2. Qué datos recogemos</h3>
          <ul>
            <li>
              <b>Los que escribes en el formulario:</b> tu nombre, tu correo, el nombre de tu empresa, cuántas personas
              tiene tu equipo, dónde llevas hoy tus gastos y si eres contador de varias PYMEs.
            </li>
            <li>
              <b>Los que agrega el sistema:</b> la fecha y hora de tu registro y de tu aceptación, y la versión de esta
              política que aceptaste.
            </li>
          </ul>
          <p>
            Todos los datos vienen de ti. No usamos fuentes de acceso público, no compramos bases de datos y no pedimos
            datos sensibles. Las personas registradas son dueños o encargados de PYMEs y contadores interesados en el
            piloto.
          </p>
          <p>
            Como cualquier sitio web, nuestros proveedores de alojamiento guardan datos técnicos de la conexión (por
            ejemplo, la dirección IP) en sus registros de funcionamiento y seguridad. No los usamos para identificarte.
          </p>

          <h3>3. Para qué los usamos</h3>
          <ul>
            <li>Para contactarte y coordinar tu participación en el piloto.</li>
            <li>Para conocer el perfil de quienes se inscriben (tamaño del equipo, herramienta que usan) y preparar el piloto.</li>
            <li>Para elaborar estadísticas agregadas, sin identificar a nadie, para el informe académico del proyecto.</li>
          </ul>
          <p>
            No los usamos para publicidad ni te enviaremos promociones. No elaboramos perfiles ni tomamos decisiones
            automatizadas sobre ti. No vendemos ni cedemos tus datos a terceros.
          </p>

          <h3>4. Por qué podemos tratarlos</h3>
          <p>
            Por tu consentimiento, que nos das al marcar la casilla del formulario (art. 4 de la Ley 19.628; art. 12 de
            la Ley 21.719). Puedes retirarlo cuando quieras, como se explica en la sección 8. Retirarlo no afecta lo que
            hicimos antes con tu consentimiento.
          </p>

          <h3>5. Dónde se guardan y quién más los ve</h3>
          <p>
            Tus datos se guardan en una base de datos de Microsoft Azure, en servidores ubicados en Estados Unidos. Microsoft
            los almacena por cuenta nuestra (como encargado), bajo sus términos de protección de datos para clientes. El
            sitio web está alojado en Netlify, que no recibe el contenido del formulario: tus datos viajan directamente a
            Azure. Dentro del equipo, solo sus tres integrantes tienen acceso a la base de datos.
          </p>
          <p>
            <b>Transferencia internacional.</b> Como los servidores están fuera de Chile, guardar tus datos implica una
            transferencia internacional. A la fecha, la Agencia de Protección de Datos Personales no ha determinado si
            Estados Unidos ofrece un nivel adecuado de protección. Por eso te pedimos tu consentimiento expreso para esta
            transferencia, además de apoyarnos en las garantías contractuales de Microsoft.
          </p>

          <h3>6. Cuánto tiempo los guardamos</h3>
          <p>
            Hasta que termine el piloto o hasta 12 meses desde tu registro, lo que ocurra primero. Después los eliminamos.
            Si antes retiras tu consentimiento o pides que los borremos, los eliminamos en ese momento.
          </p>

          <h3>7. Cómo los protegemos</h3>
          <ul>
            <li>La conexión entre tu navegador y nuestros servidores va cifrada (HTTPS).</li>
            <li>La base de datos está cifrada en reposo.</li>
            <li>El acceso a la base de datos está restringido a los integrantes del equipo.</li>
            <li>El formulario tiene un filtro contra envíos automatizados.</li>
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
            Para ejercerlos, escríbenos a {correo} desde el correo con que te registraste (o indicando cuál fue) y dinos
            qué necesitas. Es gratis. Te confirmaremos que recibimos tu solicitud y te responderemos por escrito dentro
            de los plazos legales: hasta el 30 de noviembre de 2026, dentro de 2 días hábiles (Ley 19.628); desde el 1
            de diciembre de 2026, dentro de 30 días corridos, prorrogables una sola vez por otros 30 (Ley 21.719).
          </p>
          <p>
            Si rechazamos tu solicitud o no respondemos a tiempo, puedes reclamar: hasta el 30 de noviembre de 2026, ante
            el juez de letras en lo civil; desde el 1 de diciembre de 2026, ante la Agencia de Protección de Datos
            Personales.
          </p>

          <h3>9. Cambios a esta política</h3>
          <p>
            Si cambiamos esta política, publicaremos aquí la nueva versión con su fecha. Si el cambio implica usar tus
            datos para algo distinto de lo que aceptaste, te pediremos de nuevo tu consentimiento.
          </p>
        </div>
      </div>
    </dialog>
  )
}
