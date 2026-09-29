export class SalesforceAuthError extends Error {
  constructor(message = 'Salesforce access was revoked or expired.') {
    super(message)
    this.name = 'SalesforceAuthError'
  }
}

export class SalesforceRateLimitError extends Error {
  constructor(message = 'Salesforce API limit reached for today.') {
    super(message)
    this.name = 'SalesforceRateLimitError'
  }
}

export class SalesforceApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly errorCode: string,
    message: string,
  ) {
    super(message)
    this.name = 'SalesforceApiError'
  }
}
