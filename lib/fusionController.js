const axios = require('axios');
const bonjour = require('bonjour')();
const EventEmitter = require('eventemitter3');

class FusionController extends EventEmitter {
  constructor(app) {
    super();
    this.app = app;
    this.devices = new Map();
    this.discoveryInterval = null;
    this.pollingInterval = null;
    this.isStarted = false;
  }

  start() {
    if (this.isStarted) return;

    this.app.debug('Starting Fusion controller');
    this.isStarted = true;

    this.startDiscovery();
    this.startPolling();
  }

  stop() {
    if (!this.isStarted) return;

    this.app.debug('Stopping Fusion controller');
    this.isStarted = false;

    if (this.discoveryInterval) {
      clearInterval(this.discoveryInterval);
      this.discoveryInterval = null;
    }

    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }

    this.devices.clear();
    bonjour.destroy();
  }

  addDevice(deviceId) {
    if (this.devices.has(deviceId)) {
      this.app.debug(`Fusion device ${deviceId} already added`);
      return;
    }

    const deviceInfo = this.findDeviceById(deviceId);
    if (deviceInfo) {
      this.app.debug(`Adding Fusion device: ${deviceId}`);
      this.devices.set(deviceId, {
        ...deviceInfo,
        lastSeen: Date.now(),
        currentInput: null,
        currentVolume: null
      });
    } else {
      this.app.debug(`Fusion device ${deviceId} not found`);
    }
  }

  removeDevice(deviceId) {
    if (this.devices.has(deviceId)) {
      this.app.debug(`Removing Fusion device: ${deviceId}`);
      this.devices.delete(deviceId);
    }
  }

  async switchInput(deviceId, inputSource) {
    const device = this.devices.get(deviceId);
    if (!device) {
      this.app.debug(`Fusion device ${deviceId} not found for input switching`);
      return;
    }

    try {
      const inputMap = {
        'aux1': 1,
        'aux2': 2,
        'aux3': 3,
        'usb': 4,
        'bluetooth': 5,
        'am': 6,
        'fm': 7
      };

      const inputNumber = inputMap[inputSource.toLowerCase()];
      if (!inputNumber) {
        this.app.error(`Invalid input source: ${inputSource}`);
        return;
      }

      const response = await this.sendCommand(device, 'setInput', { input: inputNumber });

      if (response.success) {
        device.currentInput = inputSource;
        this.app.debug(`Switched Fusion input: ${deviceId} -> ${inputSource}`);
      } else {
        this.app.error(`Failed to switch input: ${response.error}`);
      }
    } catch (error) {
      this.app.error(`Failed to switch Fusion input: ${error.message}`);
    }
  }

  async setVolume(deviceId, volume) {
    const device = this.devices.get(deviceId);
    if (!device) {
      this.app.debug(`Fusion device ${deviceId} not found for volume control`);
      return;
    }

    try {
      const fusionVolume = Math.round((volume / 100) * 40);

      const response = await this.sendCommand(device, 'setVolume', { volume: fusionVolume });

      if (response.success) {
        device.currentVolume = volume;
        this.app.debug(`Set Fusion volume: ${deviceId} -> ${volume}%`);
      } else {
        this.app.error(`Failed to set volume: ${response.error}`);
      }
    } catch (error) {
      this.app.error(`Failed to set Fusion volume: ${error.message}`);
    }
  }

  async getStatus(deviceId) {
    const device = this.devices.get(deviceId);
    if (!device) return null;

    try {
      const response = await this.sendCommand(device, 'getStatus');

      if (response.success) {
        return {
          input: response.data.currentInput,
          volume: response.data.volume,
          power: response.data.power,
          source: response.data.source
        };
      }

      return null;
    } catch (error) {
      this.app.error(`Failed to get Fusion status: ${error.message}`);
      return null;
    }
  }

  startDiscovery() {
    this.app.debug('Starting Fusion device discovery');

    const browser = bonjour.find({ type: 'http' });

    browser.on('up', (service) => {
      if (this.isFusionDevice(service)) {
        this.handleDeviceDiscovered(service);
      }
    });

    browser.on('down', (service) => {
      if (this.isFusionDevice(service)) {
        this.handleDeviceUnavailable(service);
      }
    });

    this.discoveryInterval = setInterval(() => {
      browser.update();
    }, 30000);
  }

  startPolling() {
    this.pollingInterval = setInterval(async () => {
      for (const [deviceId, device] of this.devices) {
        try {
          const status = await this.getStatus(deviceId);
          if (status) {
            if (status.volume !== device.currentVolume) {
              device.currentVolume = status.volume;
              this.emit('volumeChanged', deviceId, status.volume);
            }

            if (status.input !== device.currentInput) {
              device.currentInput = status.input;
              this.emit('inputChanged', deviceId, status.input);
            }
          }
        } catch (error) {
          this.app.debug(`Failed to poll device ${deviceId}: ${error.message}`);
        }
      }
    }, 5000);
  }

  isFusionDevice(service) {
    return service.name && (
      service.name.toLowerCase().includes('fusion') ||
      service.name.toLowerCase().includes('garmin') ||
      (service.txt && service.txt.manufacturer === 'Garmin')
    );
  }

  handleDeviceDiscovered(service) {
    const deviceId = this.getDeviceId(service);

    this.app.debug('Fusion device discovered:', {
      id: deviceId,
      name: service.name,
      host: service.host,
      port: service.port
    });

    if (!this.devices.has(deviceId)) {
      this.devices.set(deviceId, {
        id: deviceId,
        name: service.name,
        host: service.host,
        port: service.port,
        lastSeen: Date.now(),
        currentInput: null,
        currentVolume: null
      });
    }
  }

  handleDeviceUnavailable(service) {
    const deviceId = this.getDeviceId(service);

    if (this.devices.has(deviceId)) {
      this.app.debug(`Fusion device became unavailable: ${deviceId}`);
      this.devices.delete(deviceId);
    }
  }

  findDeviceById(deviceId) {
    return this.devices.get(deviceId);
  }

  getDeviceId(service) {
    return `${service.host}:${service.port}`;
  }

  async sendCommand(device, command, params = {}) {
    try {
      const url = `http://${device.host}:${device.port}/api/fusion/${command}`;

      const response = await axios.post(url, params, {
        timeout: 5000,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'SignalK-Sonos-Fusion-Plugin/1.0'
        }
      });

      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      if (error.response) {
        return {
          success: false,
          error: `HTTP ${error.response.status}: ${error.response.statusText}`,
          data: error.response.data
        };
      } else if (error.request) {
        return {
          success: false,
          error: 'No response from device'
        };
      } else {
        return {
          success: false,
          error: error.message
        };
      }
    }
  }

  getAvailableDevices() {
    return Array.from(this.devices.values()).map(device => ({
      id: device.id,
      name: device.name,
      host: device.host,
      port: device.port,
      lastSeen: device.lastSeen
    }));
  }

  async testConnection(deviceId) {
    const device = this.devices.get(deviceId);
    if (!device) return false;

    try {
      const response = await this.sendCommand(device, 'ping');
      return response.success;
    } catch (error) {
      return false;
    }
  }
}

module.exports = { FusionController };