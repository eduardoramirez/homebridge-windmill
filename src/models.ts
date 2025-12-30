export interface WindmillDevice {
  name: string;
  authToken: string;
  deviceId?: string;
  deviceType: 'fan' | 'purifier';
}
