const EventEmitter = require('eventemitter3');
const _ = require('lodash');

class DeviceManager extends EventEmitter {
  constructor(app, options) {
    super();
    this.app = app;
    this.options = options || {};
    this.devicePairs = new Map();
    this.isStarted = false;
  }

  start() {
    if (this.isStarted) return;

    this.app.debug('Starting Device Manager');
    this.isStarted = true;

    this.loadDevicePairs();
  }

  stop() {
    if (!this.isStarted) return;

    this.app.debug('Stopping Device Manager');
    this.isStarted = false;

    this.devicePairs.clear();
  }

  loadDevicePairs() {
    const pairs = this.options.devicePairs || [];

    this.app.debug(`Loading ${pairs.length} device pairs`);

    pairs.forEach(pairConfig => {
      if (this.validatePairConfig(pairConfig)) {
        this.addDevicePair(pairConfig);
      } else {
        this.app.error(`Invalid device pair configuration: ${pairConfig.name}`);
      }
    });
  }

  validatePairConfig(config) {
    const required = ['name', 'sonosDevice', 'fusionDevice', 'fusionInput'];

    for (const field of required) {
      if (!config[field]) {
        this.app.error(`Missing required field '${field}' in device pair config`);
        return false;
      }
    }

    const validInputs = ['aux1', 'aux2', 'aux3', 'usb', 'bluetooth', 'am', 'fm'];
    if (!validInputs.includes(config.fusionInput.toLowerCase())) {
      this.app.error(`Invalid fusion input: ${config.fusionInput}`);
      return false;
    }

    return true;
  }

  addDevicePair(config) {
    const pair = {
      name: config.name,
      sonosDevice: config.sonosDevice,
      fusionDevice: config.fusionDevice,
      fusionInput: config.fusionInput.toLowerCase(),
      volumeSync: config.volumeSync !== false,
      enabled: config.enabled !== false,
      lastActivity: null,
      status: 'ready'
    };

    this.devicePairs.set(config.name, pair);

    this.app.debug(`Added device pair: ${pair.name}`, {
      sonos: pair.sonosDevice,
      fusion: pair.fusionDevice,
      input: pair.fusionInput,
      volumeSync: pair.volumeSync,
      enabled: pair.enabled
    });

    if (pair.enabled) {
      this.emit('devicePairReady', pair);
    }
  }

  removeDevicePair(name) {
    const pair = this.devicePairs.get(name);
    if (pair) {
      this.devicePairs.delete(name);
      this.emit('devicePairRemoved', pair);
      this.app.debug(`Removed device pair: ${name}`);
    }
  }

  updateDevicePair(name, updates) {
    const pair = this.devicePairs.get(name);
    if (!pair) {
      this.app.error(`Device pair not found: ${name}`);
      return;
    }

    const oldEnabled = pair.enabled;
    Object.assign(pair, updates);

    this.app.debug(`Updated device pair: ${name}`, updates);

    if (!oldEnabled && pair.enabled) {
      this.emit('devicePairReady', pair);
    } else if (oldEnabled && !pair.enabled) {
      this.emit('devicePairRemoved', pair);
    }
  }

  getPairByName(name) {
    return this.devicePairs.get(name);
  }

  getPairBySonosDevice(deviceId) {
    return Array.from(this.devicePairs.values())
      .find(pair => pair.sonosDevice === deviceId && pair.enabled);
  }

  getPairByFusionDevice(deviceId) {
    return Array.from(this.devicePairs.values())
      .find(pair => pair.fusionDevice === deviceId && pair.enabled);
  }

  getAllPairs() {
    return Array.from(this.devicePairs.values());
  }

  getEnabledPairs() {
    return Array.from(this.devicePairs.values()).filter(pair => pair.enabled);
  }

  updatePairActivity(pairName, activity) {
    const pair = this.devicePairs.get(pairName);
    if (pair) {
      pair.lastActivity = {
        timestamp: Date.now(),
        type: activity.type,
        data: activity.data
      };

      this.app.debug(`Updated pair activity: ${pairName}`, activity);
    }
  }

  updatePairStatus(pairName, status) {
    const pair = this.devicePairs.get(pairName);
    if (pair) {
      pair.status = status;
      this.app.debug(`Updated pair status: ${pairName} -> ${status}`);
    }
  }

  getPairsByInput(fusionInput) {
    return Array.from(this.devicePairs.values())
      .filter(pair => pair.fusionInput === fusionInput && pair.enabled);
  }

  validateDeviceAssociation(sonosDevice, fusionDevice) {
    const existingSonosPair = this.getPairBySonosDevice(sonosDevice);
    const existingFusionPair = this.getPairByFusionDevice(fusionDevice);

    const conflicts = [];

    if (existingSonosPair) {
      conflicts.push(`Sonos device ${sonosDevice} is already paired with ${existingSonosPair.name}`);
    }

    if (existingFusionPair) {
      conflicts.push(`Fusion device ${fusionDevice} is already paired with ${existingFusionPair.name}`);
    }

    return {
      valid: conflicts.length === 0,
      conflicts
    };
  }

  getDeviceStatistics() {
    const stats = {
      totalPairs: this.devicePairs.size,
      enabledPairs: this.getEnabledPairs().length,
      activePairs: 0,
      recentActivity: []
    };

    const pairs = Array.from(this.devicePairs.values());

    pairs.forEach(pair => {
      if (pair.lastActivity && Date.now() - pair.lastActivity.timestamp < 300000) {
        stats.activePairs++;
      }

      if (pair.lastActivity) {
        stats.recentActivity.push({
          pairName: pair.name,
          timestamp: pair.lastActivity.timestamp,
          type: pair.lastActivity.type
        });
      }
    });

    stats.recentActivity = _.orderBy(stats.recentActivity, ['timestamp'], ['desc']).slice(0, 10);

    return stats;
  }

  exportConfiguration() {
    return {
      devicePairs: Array.from(this.devicePairs.values()).map(pair => ({
        name: pair.name,
        sonosDevice: pair.sonosDevice,
        fusionDevice: pair.fusionDevice,
        fusionInput: pair.fusionInput,
        volumeSync: pair.volumeSync,
        enabled: pair.enabled
      }))
    };
  }

  importConfiguration(config) {
    if (!config.devicePairs || !Array.isArray(config.devicePairs)) {
      throw new Error('Invalid configuration format');
    }

    this.devicePairs.clear();

    config.devicePairs.forEach(pairConfig => {
      if (this.validatePairConfig(pairConfig)) {
        this.addDevicePair(pairConfig);
      } else {
        this.app.error(`Skipping invalid device pair: ${pairConfig.name}`);
      }
    });

    this.app.debug(`Imported ${this.devicePairs.size} device pairs`);
  }

  getDiagnostics() {
    const diagnostics = {
      deviceManager: {
        isStarted: this.isStarted,
        totalPairs: this.devicePairs.size,
        enabledPairs: this.getEnabledPairs().length
      },
      pairs: Array.from(this.devicePairs.values()).map(pair => ({
        name: pair.name,
        enabled: pair.enabled,
        status: pair.status,
        lastActivity: pair.lastActivity,
        sonosDevice: pair.sonosDevice,
        fusionDevice: pair.fusionDevice,
        fusionInput: pair.fusionInput,
        volumeSync: pair.volumeSync
      }))
    };

    return diagnostics;
  }
}

module.exports = { DeviceManager };