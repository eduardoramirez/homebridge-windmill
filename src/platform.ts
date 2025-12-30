import type { API, Characteristic, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service } from 'homebridge';

import { DEFAULT_BLYNK_HOST } from './config.js';
import type { WindmillConfig } from './config.js';
import type { WindmillDevice } from './models.js';
import { WindmillFanAccessory } from './accessories/fanAccessory.js';
import { WindmillPurifierAccessory } from './accessories/purifierAccessory.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class WindmillAirPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;
  public readonly host: string;
  public readonly refreshIntervalMs: number;
  private readonly windmillConfig: WindmillConfig;

  // this is used to track restored cached accessories
  public readonly accessories: Map<string, PlatformAccessory> = new Map();
  public readonly discoveredCacheUUIDs: string[] = [];

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.windmillConfig = config as WindmillConfig;
    this.host = this.windmillConfig.host ?? DEFAULT_BLYNK_HOST;
    const refreshSeconds = this.windmillConfig.refreshIntervalSeconds ?? 30;
    this.refreshIntervalMs = Math.max(5, refreshSeconds) * 1000;
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    if (this.getConfiguredDevices().length === 0) {
      this.log.warn('No authToken configured; update Homebridge config to connect to Windmill Air.');
    }

    this.log.debug('Finished initializing platform:', this.config.name);

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');
      // run the method to discover / register your devices as accessories
      this.discoverDevices();
    });
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to set up event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache, so we can track if it has already been registered
    this.accessories.set(accessory.UUID, accessory);
  }

  /**
   * This is an example method showing how to register discovered accessories.
   * Accessories must only be registered once, previously created accessories
   * must not be registered again to prevent "duplicate UUID" errors.
   */
  discoverDevices() {
    const configuredDevices = this.getConfiguredDevices();
    if (configuredDevices.length === 0) {
      this.log.warn('No devices configured; skipping discovery.');
      return;
    }

    // loop over the discovered devices and register each one if it has not already been registered
    for (const device of configuredDevices) {
      // generate a unique id for the accessory this should be generated from
      // something globally unique, but constant, for example, the device serial
      // number or MAC address
      const uuid = this.api.hap.uuid.generate(device.deviceId ?? device.authToken);

      // see if an accessory with the same uuid has already been registered and restored from
      // the cached devices we stored in the `configureAccessory` method above
      const existingAccessory = this.accessories.get(uuid);

      if (existingAccessory) {
        // the accessory already exists
        this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);

        // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. e.g.:
        // existingAccessory.context.device = device;
        // this.api.updatePlatformAccessories([existingAccessory]);

        // create the accessory handler for the restored accessory
        this.createAccessoryHandler(existingAccessory);

        // it is possible to remove platform accessories at any time using `api.unregisterPlatformAccessories`, e.g.:
        // remove platform accessories when no longer present
        // this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
        // this.log.info('Removing existing accessory from cache:', existingAccessory.displayName);
      } else {
        // the accessory does not yet exist, so we need to create it
        this.log.info('Adding new accessory:', device.name);

        // create a new accessory
        const accessory = new this.api.platformAccessory(device.name, uuid);

        // store a copy of the device object in the `accessory.context`
        // the `context` property can be used to store any data about the accessory you may need
        accessory.context.device = device;

        // create the accessory handler for the newly create accessory
        this.createAccessoryHandler(accessory);

        // link the accessory to your platform
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }

      // push into discoveredCacheUUIDs
      this.discoveredCacheUUIDs.push(uuid);
    }

    // you can also deal with accessories from the cache which are no longer present by removing them from Homebridge
    // for example, if your plugin logs into a cloud account to retrieve a device list, and a user has previously removed a device
    // from this cloud account, then this device will no longer be present in the device list but will still be in the Homebridge cache
    for (const [uuid, accessory] of this.accessories) {
      if (!this.discoveredCacheUUIDs.includes(uuid)) {
        this.log.info('Removing existing accessory from cache:', accessory.displayName);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }
  }

  private getConfiguredDevices(): WindmillDevice[] {
    const devices = this.windmillConfig.devices ?? [];
    return devices.map((device, index) => ({
      name: device.name ?? this.defaultDeviceName(index),
      authToken: device.authToken,
      deviceId: device.deviceId,
      deviceType: device.deviceType ?? 'fan',
    }));
  }

  private defaultDeviceName(index: number): string {
    const baseName = this.windmillConfig.name ?? 'Windmill Air';
    return `${baseName} ${index + 1}`;
  }

  private createAccessoryHandler(accessory: PlatformAccessory): void {
    const device = accessory.context.device as WindmillDevice;
    if (device.deviceType === 'purifier') {
      new WindmillPurifierAccessory(this, accessory);
    } else {
      new WindmillFanAccessory(this, accessory);
    }
  }
}
