import type { Metadata } from 'next'
import { MarketingPage, Prose } from '../../_components/MarketingPage'

export const metadata: Metadata = {
  title: 'Privacy Policy | OutboundOS',
  description: 'How OutboundOS collects, uses and protects data.',
}

// Plain-language policy based on how the app handles data today. Have it
// reviewed by someone qualified before relying on it with paying customers,
// and update LAST_UPDATED whenever the content changes.
const LAST_UPDATED = 'September 30, 2026'
const CONTACT_EMAIL = 'justin.tudhope@gmail.com'

export default function PrivacyPage() {
  return (
    <MarketingPage eyebrow="Legal" title="Privacy Policy" intro={`Last updated ${LAST_UPDATED}`}>
      <Prose>
        <p>
          This policy explains what information OutboundOS collects, how it is used,
          and the choices you have. It covers people who use the OutboundOS app
          (&ldquo;customers&rdquo;) and the prospects our customers contact through it.
        </p>

        <h2>Information we collect</h2>
        <ul>
          <li>
            <strong>Account information.</strong> Your name, email address and
            organization when you sign up. Sign-in is handled by our authentication
            provider, Clerk.
          </li>
          <li>
            <strong>Lead data you provide.</strong> Contact details you import or
            enter about prospects, such as name, email, company, title, phone and
            location, plus any extra columns you upload.
          </li>
          <li>
            <strong>Email activity.</strong> The emails you send through OutboundOS,
            replies you receive, and delivery events such as bounces and
            unsubscribes.
          </li>
          <li>
            <strong>Connected accounts.</strong> If you connect Microsoft 365 or
            Salesforce, we store the access needed to send email, read replies,
            import records and log activity. Salesforce access tokens are stored
            encrypted.
          </li>
          <li>
            <strong>Basic usage data.</strong> Information needed to run and secure
            the service, such as sign-in sessions and error logs.
          </li>
        </ul>

        <h2>How we use it</h2>
        <ul>
          <li>To run the service: import leads, draft and send email, detect replies and show your pipeline.</li>
          <li>To score leads and draft messages with AI. Lead and message content is sent to our AI provider, OpenAI, for this purpose.</li>
          <li>To protect deliverability: verify email addresses, enforce sending limits, and honor unsubscribes.</li>
          <li>To support you and keep the service secure.</li>
        </ul>
        <p>We do not sell personal information, and we do not use your lead data to market to those leads ourselves.</p>

        <h2>Service providers</h2>
        <p>We rely on these providers to run OutboundOS. Each processes data only to provide its service to us:</p>
        <ul>
          <li>Vercel (application hosting) and Neon (database)</li>
          <li>Clerk (sign-in and organization management)</li>
          <li>OpenAI (lead scoring, drafting and reply classification)</li>
          <li>Microsoft 365, through your own tenant, and SendGrid (sending email)</li>
          <li>MillionVerifier (optional email address verification)</li>
          <li>Salesforce (optional, only if you connect it)</li>
        </ul>

        <h2>If you received an email sent with OutboundOS</h2>
        <p>
          Our customers use OutboundOS to send business email from their own
          mailboxes. The sending company is responsible for that message and for
          having a lawful reason to contact you. Every message includes an
          unsubscribe link. Using it stops further emails from that sender through
          OutboundOS. You can also contact us at the address below.
        </p>

        <h2>Keeping and deleting data</h2>
        <p>
          We keep data while your account is active. You can ask us to delete
          specific leads, or your whole account and its data, by emailing us. Some
          records, such as unsubscribes, may be kept so we can keep honoring them.
        </p>

        <h2>Security</h2>
        <p>
          Data is transmitted over encrypted connections, access to each
          organization&apos;s data is restricted to its members, and sensitive
          credentials are encrypted at rest. No system is perfectly secure, but we
          work to protect your information.
        </p>

        <h2>Changes</h2>
        <p>If we change this policy, we will update the date at the top of this page.</p>

        <h2>Contact</h2>
        <p>
          Questions or requests: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        </p>
      </Prose>
    </MarketingPage>
  )
}
