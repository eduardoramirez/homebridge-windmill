import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import { BlynkHttpClient } from '../api/blynkHttpClient.js';
import { PURIFIER_PIN_MAP } from '../config.js';
import type { WindmillAirPlatform } from '../platform.js';

type AccessoryDeviceContext = {
  name: string;
  authToken: string;
  deviceType: 'fan' | 'purifier';
};

export class WindmillPurifierAccessory {
  private service: Service;
  private readonly pins = PURIFIER_PIN_MAP;
  private readonly client: BlynkHttpClient;

  constructor(
    private readonly platform: WindmillAirPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    const device = accessory.context.device as AccessoryDeviceContext;
    this.client = new BlynkHttpClient(this.platform.log, device.authToken, this.platform.host);

    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Windmill')
      .setCharacteristic(this.platform.Characteristic.Model, 'Purifier')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, device.name);

    this.service = this.accessory.getService(this.platform.Service.AirPurifier)
      || this.accessory.addService(this.platform.Service.AirPurifier);

    this.service.setCharacteristic(this.platform.Characteristic.Name, device.name);

    this.service.getCharacteristic(this.platform.Characteristic.Active)
      .onSet(this.setActive.bind(this))
      .onGet(this.getActive.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .setProps({ minValue: 0, maxValue: 6, minStep: 1 })
      .onSet(this.setMode.bind(this))
      .onGet(this.getMode.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.CurrentAirPurifierState)
      .onGet(this.getCurrentPurifierState.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TargetAirPurifierState)
      .onSet(this.setTargetPurifierState.bind(this))
      .onGet(this.getTargetPurifierState.bind(this));

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

  async setMode(value: CharacteristicValue) {
    const nextValue = value as number;
    if (nextValue <= 0) {
      await this.client.setPin(this.pins.power, 0);
      return;
    }
    const modeValue = this.toDeviceMode(nextValue);
    await Promise.all([
      this.client.setPin(this.pins.power, 1),
      this.client.setPin(this.pins.mode, modeValue),
    ]);
    this.platform.log.debug('Set Characteristic RotationSpeed ->', value);
  }

  async getMode(): Promise<CharacteristicValue> {
    const value = await this.client.getPin(this.pins.mode);
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) {
      return 0;
    }
    return this.fromDeviceMode(parsed);
  }

  async getCurrentPurifierState(): Promise<CharacteristicValue> {
    const active = await this.getActive();
    return active === this.platform.Characteristic.Active.ACTIVE
      ? this.platform.Characteristic.CurrentAirPurifierState.PURIFYING_AIR
      : this.platform.Characteristic.CurrentAirPurifierState.INACTIVE;
  }

  async setTargetPurifierState(value: CharacteristicValue) {
    const nextValue = value as number;
    if (nextValue === this.platform.Characteristic.TargetAirPurifierState.AUTO) {
      await Promise.all([
        this.client.setPin(this.pins.power, 1),
        this.client.setPin(this.pins.mode, 5),
      ]);
    } else {
      await Promise.all([
        this.client.setPin(this.pins.power, 1),
        this.client.setPin(this.pins.mode, 1),
      ]);
    }
  }

  async getTargetPurifierState(): Promise<CharacteristicValue> {
    const value = await this.client.getPin(this.pins.mode);
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) {
      return this.platform.Characteristic.TargetAirPurifierState.MANUAL;
    }
    return parsed >= 5
      ? this.platform.Characteristic.TargetAirPurifierState.AUTO
      : this.platform.Characteristic.TargetAirPurifierState.MANUAL;
  }

  private toDeviceMode(value: number): number {
    return Math.min(6, Math.max(1, Math.round(value)));
  }

  private fromDeviceMode(value: number): number {
    return Math.min(6, Math.max(1, value));
  }

  private startPolling(): void {
    const intervalMs = this.platform.refreshIntervalMs;
    setInterval(() => {
      void this.refreshState();
    }, intervalMs);
  }

  private async refreshState(): Promise<void> {
    try {
      const [powerValue, modeValue] = await Promise.all([
        this.client.getPin(this.pins.power),
        this.client.getPin(this.pins.mode),
      ]);

      const powerNormalized = powerValue.toLowerCase();
      const isActive = powerNormalized === '1' || powerNormalized === 'true' || powerNormalized === 'on';
      const parsedMode = Number.parseInt(modeValue, 10);

      this.service.updateCharacteristic(
        this.platform.Characteristic.Active,
        isActive ? this.platform.Characteristic.Active.ACTIVE : this.platform.Characteristic.Active.INACTIVE,
      );
      if (!Number.isNaN(parsedMode)) {
        this.service.updateCharacteristic(
          this.platform.Characteristic.RotationSpeed,
          this.fromDeviceMode(parsedMode),
        );
      }
      this.service.updateCharacteristic(
        this.platform.Characteristic.CurrentAirPurifierState,
        isActive
          ? this.platform.Characteristic.CurrentAirPurifierState.PURIFYING_AIR
          : this.platform.Characteristic.CurrentAirPurifierState.INACTIVE,
      );
      if (!Number.isNaN(parsedMode)) {
        this.service.updateCharacteristic(
          this.platform.Characteristic.TargetAirPurifierState,
          parsedMode >= 5
            ? this.platform.Characteristic.TargetAirPurifierState.AUTO
            : this.platform.Characteristic.TargetAirPurifierState.MANUAL,
        );
      }
    } catch (error) {
      this.platform.log.debug('Failed to refresh device state:', error);
    }
  }
}
