import type { PlatformConfig } from 'homebridge';

export interface WindmillDeviceConfig {
  name?: string;
  authToken: string;
  deviceId?: string;
  deviceType?: 'fan' | 'purifier';
}

export interface WindmillConfig extends PlatformConfig {
  host?: string;
  authToken?: string;
  deviceId?: string;
  devices?: WindmillDeviceConfig[];
  refreshIntervalSeconds?: number;
  deviceType?: 'fan' | 'purifier';
}

export const DEFAULT_BLYNK_HOST = 'dashboard.windmillair.com';

export const FAN_PIN_MAP = {
  power: 'V0',
  autoFade: 'V1',
  speed: 'V2',
};

export const PURIFIER_PIN_MAP = {
  power: 'V0',
  mode: 'V3',
};
