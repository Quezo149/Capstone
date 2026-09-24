import Navbar from './components/Navbar'
import Hero from './components/Hero'
import Problem from './components/Problem'
import LoadTabs from './components/LoadTabs'
import Steps from './components/Steps'
import Roles from './components/Roles'
import Security from './components/Security'
import Pricing from './components/Pricing'
import Faq from './components/Faq'
import SignupForm from './components/SignupForm'
import Footer from './components/Footer'

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
        <SignupForm />
      </main>
      <Footer />
    </>
  )
}

export default App
