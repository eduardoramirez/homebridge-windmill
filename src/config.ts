import type { PlatformConfig } from 'homebridge';

export interface WindmillDeviceConfig {
  name: string;
  authToken: string;
  deviceType: 'fan' | 'purifier';
  deviceId: string;
}

export interface WindmillConfig extends PlatformConfig {
  host: string;
  devices: WindmillDeviceConfig[];
  refreshIntervalSeconds: number;
}

export const FAN_PIN_MAP = {
  power: 'V0',
  speed: 'V2',
};

export const PURIFIER_PIN_MAP = {
  power: 'V0',
  mode: 'V3',
  airQualityAqi: 'V6',
  filterLife: 'V7',
};
