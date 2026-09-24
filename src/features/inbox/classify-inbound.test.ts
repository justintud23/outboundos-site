import { describe, it, expect } from 'vitest'
import { classifyInboundMessage, extractBouncedRecipients, type InboundMessage } from './classify-inbound'

const OWN = new Set(['mike@getacmesnow.com', 'alerts@getacmesnow.com'])
const msg = (o: Partial<InboundMessage>): InboundMessage => ({
  fromAddress: 'jane@acmepm.com',
  subject: 'Re: Snow plan for Acme',
  bodyText: 'Sounds good, can you quote our 3 lots?',
  headers: {},
  ...o,
})

describe('classifyInboundMessage', () => {
  it('HUMAN for a normal reply', () => {
    expect(classifyInboundMessage(msg({}), OWN)).toBe('HUMAN')
  })
  it('INTERNAL for mail from our own mailboxes (case-insensitive)', () => {
    expect(classifyInboundMessage(msg({ fromAddress: 'Mike@GetAcmeSnow.com' }), OWN)).toBe('INTERNAL')
  })
  it('BOUNCE for an Exchange Online NDR', () => {
    const ndr = msg({
      fromAddress: 'MicrosoftExchange329e71ec88ae4615bbc36ab6ce41109e@getacmesnow.com',
      subject: 'Undeliverable: Snow plan for Acme',
      bodyText: "Your message to bob@nowhere.example couldn't be delivered.",
    })
    expect(classifyInboundMessage(ndr, OWN)).toBe('BOUNCE')
  })
  it('BOUNCE for a postmaster DSN', () => {
    expect(classifyInboundMessage(msg({ fromAddress: 'postmaster@acmepm.com', subject: 'Delivery Status Notification (Failure)' }), OWN)).toBe('BOUNCE')
  })
  it('BOUNCE for a multipart/report delivery-status', () => {
    expect(
      classifyInboundMessage(msg({ headers: { 'content-type': 'multipart/report; report-type=delivery-status' } }), OWN),
    ).toBe('BOUNCE')
  })
  it('AUTO_REPLY for Auto-Submitted: auto-replied', () => {
    expect(classifyInboundMessage(msg({ headers: { 'auto-submitted': 'auto-replied' } }), OWN)).toBe('AUTO_REPLY')
  })
  it('HUMAN when Auto-Submitted: no', () => {
    expect(classifyInboundMessage(msg({ headers: { 'auto-submitted': 'no' } }), OWN)).toBe('HUMAN')
  })
  it('AUTO_REPLY for an Outlook "Automatic reply:" subject with no headers', () => {
    expect(classifyInboundMessage(msg({ subject: 'Automatic reply: Snow plan for Acme' }), OWN)).toBe('AUTO_REPLY')
  })
  it('AUTO_REPLY for Out of Office subject', () => {
    expect(classifyInboundMessage(msg({ subject: 'Out of Office Re: Snow plan' }), OWN)).toBe('AUTO_REPLY')
  })
})

describe('extractBouncedRecipients', () => {
  it('pulls distinct external addresses, lower-cased, excluding ours and postmaster', () => {
    const body = "Your message to Bob@Nowhere.example couldn't be delivered. bob@nowhere.example\nFrom: mike@getacmesnow.com postmaster@nowhere.example"
    expect(extractBouncedRecipients(body, OWN)).toEqual(['bob@nowhere.example'])
  })
})
