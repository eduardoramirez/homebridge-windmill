import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import { BlynkHttpClient } from '../api/blynkHttpClient.js';
import { FAN_PIN_MAP } from '../config.js';
import type { WindmillAirPlatform } from '../platform.js';

type AccessoryDeviceContext = {
  name: string;
  authToken: string;
  deviceType: 'fan' | 'purifier';
};

export class WindmillFanAccessory {
  private service: Service;
  private readonly autoFadeService: Service;
  private readonly pins = FAN_PIN_MAP;
  private readonly client: BlynkHttpClient;

  constructor(
    private readonly platform: WindmillAirPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    const device = accessory.context.device as AccessoryDeviceContext;
    this.client = new BlynkHttpClient(this.platform.log, device.authToken, this.platform.host);

    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Windmill')
      .setCharacteristic(this.platform.Characteristic.Model, 'Fan')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, device.name);

    this.service = this.accessory.getService(this.platform.Service.Fanv2)
      || this.accessory.addService(this.platform.Service.Fanv2);
    this.autoFadeService = this.accessory.getService('Auto Fade')
      || this.accessory.addService(this.platform.Service.Switch, 'Auto Fade', 'auto-fade');

    this.service.setCharacteristic(this.platform.Characteristic.Name, device.name);
    this.autoFadeService.setCharacteristic(this.platform.Characteristic.Name, 'Auto Fade');

    this.service.getCharacteristic(this.platform.Characteristic.Active)
      .onSet(this.setActive.bind(this))
      .onGet(this.getActive.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .setProps({ minValue: 0, maxValue: 100, minStep: 20 })
      .onSet(this.setRotationSpeed.bind(this))
      .onGet(this.getRotationSpeed.bind(this));

    this.autoFadeService.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setAutoFade.bind(this))
      .onGet(this.getAutoFade.bind(this));

    this.startPolling();
  }

  async setActive(value: CharacteristicValue) {
    const nextValue = value as number;
    const active = nextValue === this.platform.Characteristic.Active.ACTIVE;
    await this.client.setPin(this.pins.power, active ? 1 : 0);

    this.platform.log.debug('Set Characteristic Active ->', value);
  }

  async getActive(): Promise<CharacteristicValue> {
    const value = await this.client.getPin(this.pins.power);
    const normalized = value.toLowerCase();
    const isActive = normalized === '1' || normalized === 'true' || normalized === 'on';

    this.platform.log.debug('Get Characteristic Active ->', isActive);

    return isActive
      ? this.platform.Characteristic.Active.ACTIVE
      : this.platform.Characteristic.Active.INACTIVE;
  }

  async setRotationSpeed(value: CharacteristicValue) {
    const nextValue = value as number;
    const deviceSpeed = this.toDeviceSpeed(nextValue);
    await this.client.setPin(this.pins.speed, deviceSpeed);

    this.platform.log.debug('Set Characteristic RotationSpeed -> ', value);
  }

  async getRotationSpeed(): Promise<CharacteristicValue> {
    const value = await this.client.getPin(this.pins.speed);
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) {
      return 0;
    }
    return this.fromDeviceSpeed(parsed);
  }

  async setAutoFade(value: CharacteristicValue) {
    const nextValue = value as boolean;
    await this.client.setPin(this.pins.autoFade, nextValue ? 1 : 0);
    this.platform.log.debug('Set Characteristic Auto Fade ->', value);
  }

  async getAutoFade(): Promise<CharacteristicValue> {
    const value = await this.client.getPin(this.pins.autoFade);
    const normalized = value.toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'on';
  }

  private toDeviceSpeed(value: number): number {
    if (value <= 0) {
      return 0;
    }
    if (value <= 20) {
      return 1;
    }
    if (value <= 40) {
      return 2;
    }
    if (value <= 60) {
      return 3;
    }
    if (value <= 80) {
      return 4;
    }
    return 5;
  }

  private fromDeviceSpeed(value: number): number {
    if (value <= 0) {
      return 0;
    }
    return Math.min(5, Math.max(1, value)) * 20;
  }

  private startPolling(): void {
    const intervalMs = this.platform.refreshIntervalMs;
    setInterval(() => {
      void this.refreshState();
    }, intervalMs);
  }

  private async refreshState(): Promise<void> {
    try {
      const [powerValue, speedValue, autoFadeValue] = await Promise.all([
        this.client.getPin(this.pins.power),
        this.client.getPin(this.pins.speed),
        this.client.getPin(this.pins.autoFade),
      ]);

      const powerNormalized = powerValue.toLowerCase();
      const isActive = powerNormalized === '1' || powerNormalized === 'true' || powerNormalized === 'on';
      const parsedSpeed = Number.parseInt(speedValue, 10);
      const autoFadeNormalized = autoFadeValue.toLowerCase();
      const isAutoFade = autoFadeNormalized === '1' || autoFadeNormalized === 'true' || autoFadeNormalized === 'on';

      this.service.updateCharacteristic(
        this.platform.Characteristic.Active,
        isActive ? this.platform.Characteristic.Active.ACTIVE : this.platform.Characteristic.Active.INACTIVE,
      );
      if (!Number.isNaN(parsedSpeed)) {
        this.service.updateCharacteristic(
          this.platform.Characteristic.RotationSpeed,
          this.fromDeviceSpeed(parsedSpeed),
        );
      }
      this.autoFadeService.updateCharacteristic(
        this.platform.Characteristic.On,
        isAutoFade,
      );
    } catch (error) {
      this.platform.log.debug('Failed to refresh device state:', error);
    }
  }
}
