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
  private readonly airQualityService: Service;
  private readonly filterService: Service;
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
    this.airQualityService = this.accessory.getService(this.platform.Service.AirQualitySensor)
      || this.accessory.addService(this.platform.Service.AirQualitySensor);
    this.filterService = this.accessory.getService(this.platform.Service.FilterMaintenance)
      || this.accessory.addService(this.platform.Service.FilterMaintenance);

    this.service.setCharacteristic(this.platform.Characteristic.Name, device.name);
    this.airQualityService.setCharacteristic(this.platform.Characteristic.Name, 'Air Quality');
    this.filterService.setCharacteristic(this.platform.Characteristic.Name, 'Filter');

    this.service.getCharacteristic(this.platform.Characteristic.Active)
      .onSet(this.setActive.bind(this))
      .onGet(this.getActive.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .setProps({ minValue: 0, maxValue: 5, minStep: 1 })
      .onSet(this.setMode.bind(this))
      .onGet(this.getMode.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.CurrentAirPurifierState)
      .onGet(this.getCurrentPurifierState.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TargetAirPurifierState)
      .onSet(this.setTargetPurifierState.bind(this))
      .onGet(this.getTargetPurifierState.bind(this));

    this.filterService.getCharacteristic(this.platform.Characteristic.FilterLifeLevel)
      .onGet(this.getFilterLifeLevel.bind(this));
    this.filterService.getCharacteristic(this.platform.Characteristic.FilterChangeIndication)
      .onGet(this.getFilterChangeIndication.bind(this));

    this.airQualityService.getCharacteristic(this.platform.Characteristic.PM2_5Density)
      .onGet(this.getPm25Density.bind(this));
    this.airQualityService.getCharacteristic(this.platform.Characteristic.AirQuality)
      .onGet(this.getAirQuality.bind(this));

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

  async getFilterLifeLevel(): Promise<CharacteristicValue> {
    const value = await this.client.getPin(this.pins.filterLife);
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) {
      return 100;
    }
    return this.clampPercent(parsed);
  }

  async getFilterChangeIndication(): Promise<CharacteristicValue> {
    const level = await this.getFilterLifeLevel();
    const percentage = Number(level);
    return percentage <= 10
      ? this.platform.Characteristic.FilterChangeIndication.CHANGE_FILTER
      : this.platform.Characteristic.FilterChangeIndication.FILTER_OK;
  }

  async getPm25Density(): Promise<CharacteristicValue> {
    const value = await this.client.getPin(this.pins.airQualityAqi);
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) {
      return 0;
    }
    return parsed;
  }

  async getAirQuality(): Promise<CharacteristicValue> {
    const density = await this.getPm25Density();
    return this.mapPm25ToAirQuality(Number(density));
  }

  private toDeviceMode(value: number): number {
    return Math.min(6, Math.max(1, Math.round(value)));
  }

  private fromDeviceMode(value: number): number {
    return Math.min(6, Math.max(1, value));
  }

  private clampPercent(value: number): number {
    return Math.min(100, Math.max(0, value));
  }

  private mapPm25ToAirQuality(pm25: number): number {
    if (pm25 <= 12) {
      return this.platform.Characteristic.AirQuality.EXCELLENT;
    }
    if (pm25 <= 35.4) {
      return this.platform.Characteristic.AirQuality.GOOD;
    }
    if (pm25 <= 55.4) {
      return this.platform.Characteristic.AirQuality.FAIR;
    }
    if (pm25 <= 150.4) {
      return this.platform.Characteristic.AirQuality.INFERIOR;
    }
    return this.platform.Characteristic.AirQuality.POOR;
  }

  private startPolling(): void {
    const intervalMs = this.platform.refreshIntervalMs;
    setInterval(() => {
      void this.refreshState();
    }, intervalMs);
  }

  private async refreshState(): Promise<void> {
    try {
      const values = await this.client.getPins([
        this.pins.power,
        this.pins.mode,
        this.pins.airQualityAqi,
        this.pins.filterLife,
      ]);
      const powerValue = values[this.pins.power];
      const modeValue = values[this.pins.mode];
      const airQualityValue = values[this.pins.airQualityAqi];
      const filterValue = values[this.pins.filterLife];

      const powerNormalized = powerValue.toLowerCase();
      const isActive = powerNormalized === '1' || powerNormalized === 'true' || powerNormalized === 'on';
      const parsedMode = Number.parseInt(modeValue, 10);
      const parsedAqi = Number.parseInt(airQualityValue, 10);
      const parsedFilter = Number.parseInt(filterValue, 10);

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
      if (!Number.isNaN(parsedAqi)) {
        this.airQualityService.updateCharacteristic(
          this.platform.Characteristic.PM2_5Density,
          parsedAqi,
        );
        this.airQualityService.updateCharacteristic(
          this.platform.Characteristic.AirQuality,
          this.mapPm25ToAirQuality(parsedAqi),
        );
      }
      if (!Number.isNaN(parsedFilter)) {
        const level = this.clampPercent(parsedFilter);
        this.filterService.updateCharacteristic(
          this.platform.Characteristic.FilterLifeLevel,
          level,
        );
        this.filterService.updateCharacteristic(
          this.platform.Characteristic.FilterChangeIndication,
          level <= 10
            ? this.platform.Characteristic.FilterChangeIndication.CHANGE_FILTER
            : this.platform.Characteristic.FilterChangeIndication.FILTER_OK,
        );
      }
    } catch (error) {
      this.platform.log.debug('Failed to refresh device state:', error);
    }
  }
}
