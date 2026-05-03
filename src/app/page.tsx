import type { Metadata } from 'next'
import { MarketingHeader } from './(marketing)/_components/MarketingHeader'
import { Hero } from './(marketing)/_components/Hero'
import { ProblemSection } from './(marketing)/_components/ProblemSection'
import { SolutionSection } from './(marketing)/_components/SolutionSection'
import { FeatureGrid } from './(marketing)/_components/FeatureGrid'
import { HowItWorks } from './(marketing)/_components/HowItWorks'
import { ComparisonTable } from './(marketing)/_components/ComparisonTable'
import { PricingTeaser } from './(marketing)/_components/PricingTeaser'
import { FAQ } from './(marketing)/_components/FAQ'
import { FinalCTA } from './(marketing)/_components/FinalCTA'
import { MarketingFooter } from './(marketing)/_components/MarketingFooter'

const TITLE =
  'OutboundOS — Outbound sales automation that tells you what to do next'
const DESCRIPTION =
  'AI-powered outbound platform for B2B agencies and sales teams. Decision engine prioritizes every action. Inline execution. No more dashboards.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: 'website',
  },
}

export default function HomePage() {
  return (
    <>
      <MarketingHeader />
      <main id="main-content">
        <Hero />
        <ProblemSection />
        <SolutionSection />
        <FeatureGrid />
        <HowItWorks />
        <ComparisonTable />
        <PricingTeaser />
        <FAQ />
        <FinalCTA />
      </main>
      <MarketingFooter />
    </>
  )
}
