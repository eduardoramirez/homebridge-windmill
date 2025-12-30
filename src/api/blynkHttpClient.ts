import type { Logging } from 'homebridge';

export class BlynkHttpClient {
  private nextRequestAt = 0;

  constructor(
    private readonly log: Logging,
    private readonly authToken: string,
    private readonly host: string,
    private readonly minIntervalMs = 200,
  ) { }

  async getPin(pin: string): Promise<string> {
    const url = this.buildGetUrl(pin);
    const text = await this.requestText(url);
    return text.trim();
  }

  async getPins(pins: string[]): Promise<{ [key: string]: string }> {
    // curl 'https://dashboard.windmillair.com/external/api/get?token=DDNbFqCCMiuyjedrD1OMSxozNtXGSHSh&V1&V2'
    // {"V1":0,"V2":2}% 
    const url = this.buildGetUrl(pins.join('&'));
    const text = await this.requestText(url);
    return JSON.parse(text.trim());
  }

  async setPin(pin: string, value: string | number | boolean): Promise<void> {
    const url = this.buildUpdateUrl(pin, String(value));
    await this.requestText(url);
  }

  private buildGetUrl(pin: string): string {
    const query = new URLSearchParams({ token: this.authToken }).toString();
    return `https://${this.host}/external/api/get?${query}&${pin}`;
  }

  private buildUpdateUrl(pin: string, value: string): string {
    const query = new URLSearchParams({ token: this.authToken }).toString();
    return `https://${this.host}/external/api/update?${query}&${pin}=${encodeURIComponent(value)}`;
  }

  private async requestText(url: string): Promise<string> {
    const maxAttempts = 3;
    let attempt = 0;
    let lastError: Error | undefined;

    while (attempt < maxAttempts) {
      attempt += 1;
      try {
        await this.throttle();
        const response = await fetch(url);
        if (!response.ok) {
          const body = await response.text();
          this.log.warn('Blynk request failed:', response.status, response.statusText, body);
          throw new Error(`Blynk request failed: ${response.status} ${response.statusText}`);
        }
        return response.text();
      } catch (error) {
        lastError = error as Error;
        const delayMs = 250 * Math.pow(2, attempt - 1);
        this.log.debug('Retrying Blynk request in', delayMs, 'ms');
        await this.sleep(delayMs);
      }
    }

    throw lastError ?? new Error('Blynk request failed');
  }

  private async throttle(): Promise<void> {
    const now = Date.now();
    if (now < this.nextRequestAt) {
      await this.sleep(this.nextRequestAt - now);
    }
    this.nextRequestAt = Date.now() + this.minIntervalMs;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
