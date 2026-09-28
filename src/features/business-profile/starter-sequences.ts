import type { PresetId } from './types'

export interface StarterStep { stepNumber: number; subject: string; body: string; delayDays: number; personalizationPrompt: string }
export interface StarterSequence { id: string; name: string; description: string; steps: StarterStep[] }

const PM_PROMPT = 'Mention their property type and town if known, and one specific winter risk for that kind of property (icy walkways for residents, parking for tenants). Do not invent facts.'
const RETAIL_PROMPT = 'Mention their store or facility type and town if known, and why reliable early-morning clearing matters for it. Do not invent facts.'
const REENGAGE_PROMPT = 'Reference that they are a past customer or received a quote from us, using only what the lead data says. Keep it warm and brief. Do not invent dates or details.'

export const STARTER_SEQUENCES: Record<PresetId, StarterSequence[]> = {
  snow_paving: [
    {
      id: 'snow-pm-hoa',
      name: 'Snow — property managers & HOAs',
      description: 'Cold outreach to property managers and community associations for winter service quotes.',
      steps: [
        { stepNumber: 1, delayDays: 0, personalizationPrompt: PM_PROMPT, subject: 'Winter coverage for {company|your properties}', body: `Hi {firstName|there},

{personalization}

We handle commercial snow plowing, salting and sidewalk clearing for property managers and associations around {city|your area}. Most of our clients came to us after a season of late plows or missed salt runs, and they stay because every visit is logged with times and photos.

Would a short call or a quick site walk next week make sense, so we can put together a quote for this winter?

Thanks,` },
        { stepNumber: 2, delayDays: 3, personalizationPrompt: '', subject: 'Plow response times', body: `Hi {firstName|there},

A quick follow-up on winter service for {company|your properties}. The question we hear most from property managers is how fast the trucks show up once snow starts. Our routes are built so every lot is cleared before business hours, and we re-plow and re-salt during long storms instead of waiting for the next morning.

If it helps, I can send over a sample service log from last season so you can see exactly what gets recorded.

Thanks,` },
        { stepNumber: 3, delayDays: 7, personalizationPrompt: '', subject: 'Slip-and-fall paperwork', body: `Hi {firstName|there},

One more thought for {company|your properties}. When a slip-and-fall claim comes in, the first thing an insurer asks for is proof of when the lot and walks were plowed and salted. We record every visit with time stamps, temperatures and material used, and you can pull those records any time.

Happy to walk your {propertyType|property} with you and put together a written quote before the season fills up.

Thanks,` },
        { stepNumber: 4, delayDays: 14, personalizationPrompt: '', subject: 'Should I close your file?', body: `Hi {firstName|there},

I haven't heard back, so I'll assume winter service is already covered for {company|your properties} this year. If that changes, or if you'd like a second quote to compare before signing, just reply to this email and we'll set up a time to look at the site.

Either way, thanks for reading, and I hope the season goes smoothly.

Thanks,` },
      ],
    },
    {
      id: 'snow-retail-facilities',
      name: 'Snow — retail & facilities',
      description: 'Cold outreach to retail centers and facilities managers for winter service quotes.',
      steps: [
        { stepNumber: 1, delayDays: 0, personalizationPrompt: RETAIL_PROMPT, subject: 'Winter service for {company|your locations}', body: `Hi {firstName|there},

{personalization}

We plow, salt and clear sidewalks for retail centers and commercial facilities around {city|your area}. For stores, the goal is simple: open on time with safe, accessible parking and entrances, no matter when the snow falls overnight.

Every visit is logged with times, conditions and material used, which your insurance team will appreciate. Could we set up a short call or a site walk to quote this winter?

Thanks,` },
        { stepNumber: 2, delayDays: 3, personalizationPrompt: '', subject: 'Keeping lots open overnight', body: `Hi {firstName|there},

Following up on winter service for {company|your locations}. Most retail and facilities teams tell us their biggest headache is a lot that isn't cleared when the first employees arrive. Our crews work overnight routes timed around your opening hours, and we come back to re-salt when temperatures drop again during the day.

Would it help if I sent over a sample route plan and service log?

Thanks,` },
        { stepNumber: 3, delayDays: 7, personalizationPrompt: '', subject: 'Documented service for insurance', body: `Hi {firstName|there},

One more note for {company|your locations}. Retail sites see a lot of foot traffic in winter, and slip-and-fall claims usually come down to records. We log every plow and salt visit with time stamps and conditions, and you can request those records whenever you need them.

If you'd like, we can walk your {propertyType|site} and put together a written quote before the season fills up.

Thanks,` },
        { stepNumber: 4, delayDays: 14, personalizationPrompt: '', subject: 'Closing the loop', body: `Hi {firstName|there},

I haven't heard back, so I'll assume snow service for {company|your locations} is already set for this winter. If anything changes, or you'd like a second quote to compare, just reply here and we'll find a time to look at your sites.

Thanks for reading, and I hope the season is an easy one.

Thanks,` },
      ],
    },
    {
      id: 'reengage-customers-quotes',
      name: 'Re-engage past customers & lost quotes',
      description: 'Warm outreach to past customers and last season’s quotes before winter routes fill up.',
      steps: [
        { stepNumber: 1, delayDays: 0, personalizationPrompt: REENGAGE_PROMPT, subject: 'Winter service for {company|your properties} this year', body: `Hi {firstName|there},

{personalization}

We've worked with {company|your team} before, either on past winter service or on a quote, and I wanted to check in before the season fills up. Our routes around {city|your area} are being planned now, and returning clients get first choice of start times.

Would you like me to refresh your quote for this winter, or set up a quick site walk if anything has changed?

Thanks,` },
        { stepNumber: 2, delayDays: 5, personalizationPrompt: '', subject: 'Refreshing your winter quote', body: `Hi {firstName|there},

Following up on this winter's snow service for {company|your properties}. A lot has changed since last season on our side: more trucks on your side of town, a dedicated salting crew, and service logs you can look up whenever you need them.

If you send over anything that has changed at your sites, I'll put an updated quote together this week.

Thanks,` },
        { stepNumber: 3, delayDays: 12, personalizationPrompt: '', subject: 'Last check-in before winter', body: `Hi {firstName|there},

This is my last note before our winter routes are set. If you'd like us back on your lots at {company|your properties} this season, just reply and I'll get a quote over quickly. If you've gone with someone else, no problem at all, and thanks for the time. Either way, we're happy to help with paving, sealcoating or striping in the spring as well.

Thanks,` },
      ],
    },
  ],
  blank: [],
}
