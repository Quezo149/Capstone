import Navbar from './components/Navbar'
import Hero from './components/Hero'
import Problem from './components/Problem'
import LoadTabs from './components/LoadTabs'
import Steps from './components/Steps'
import Roles from './components/Roles'
import Security from './components/Security'
import Pricing from './components/Pricing'
import Faq from './components/Faq'
import FinalCta from './components/FinalCta'
import Footer from './components/Footer'
import PrivacyDialog from './components/PrivacyDialog'

function App() {
  return (
    <>
      <Navbar />
      <main id="top">
        <Hero />
        <Problem />
        <LoadTabs />
        <Steps />
        <Roles />
        <Security />
        <Pricing />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
      <PrivacyDialog />
    </>
  )
}

export default App
