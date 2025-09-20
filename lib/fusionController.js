const axios = require('axios');
const bonjour = require('bonjour');
const EventEmitter = require('eventemitter3');
const os = require('os');

class FusionController extends EventEmitter {
  constructor(app) {
    super();
    this.app = app;
    this.devices = new Map();
    this.discoveryInterval = null;
    this.pollingInterval = null;
    this.browsers = [];
    this.bonjourInstances = [];
    this.isStarted = false;
  }

  start() {
    if (this.isStarted) return;

    this.app.debug('Starting Fusion controller');
    this.logNetworkInterfaces();
    this.isStarted = true;

    this.startDiscovery();
    this.startPolling();
    this.startNetworkScan();
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

    if (this.networkScanInterval) {
      clearInterval(this.networkScanInterval);
      this.networkScanInterval = null;
    }

    this.browsers.forEach(browser => {
      try {
        browser.stop();
      } catch (error) {
        this.app.debug('Error stopping browser:', error.message);
      }
    });
    this.browsers = [];

    this.bonjourInstances.forEach(instance => {
      try {
        instance.destroy();
      } catch (error) {
        this.app.debug('Error destroying bonjour instance:', error.message);
      }
    });
    this.bonjourInstances = [];

    this.devices.clear();
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
    this.app.debug('Starting Fusion device discovery via mDNS');

    // Get all network interfaces for comprehensive discovery
    const interfaces = os.networkInterfaces();
    const externalInterfaces = [];

    Object.keys(interfaces).forEach(name => {
      interfaces[name].forEach(iface => {
        if (!iface.internal && iface.family === 'IPv4') {
          externalInterfaces.push({ name, address: iface.address });
        }
      });
    });

    this.app.debug(`Found ${externalInterfaces.length} external IPv4 interfaces for discovery`);

    // Create bonjour instances for each interface
    externalInterfaces.forEach(iface => {
      try {
        this.app.debug(`Creating bonjour instance for interface ${iface.name} (${iface.address})`);
        const bonjourInstance = bonjour({ interface: iface.address });
        this.bonjourInstances.push(bonjourInstance);

        // Search for various service types that Fusion devices might advertise
        const serviceTypes = ['http', 'https', '_fusion._tcp', '_garmin._tcp', '_fusion-ms._tcp'];

        serviceTypes.forEach(serviceType => {
          const browser = bonjourInstance.find({ type: serviceType });
          this.browsers.push(browser);

          browser.on('up', (service) => {
            this.app.debug(`mDNS service discovered on ${iface.name}:`, {
              name: service.name,
              type: service.type,
              host: service.host,
              port: service.port,
              addresses: service.addresses
            });

            if (this.isFusionDevice(service)) {
              this.app.debug('Service identified as Fusion device');
              this.handleDeviceDiscovered(service);
            }
          });

          browser.on('down', (service) => {
            if (this.isFusionDevice(service)) {
              this.app.debug('Fusion service went down:', service.name);
              this.handleDeviceUnavailable(service);
            }
          });
        });
      } catch (error) {
        this.app.error(`Failed to create bonjour instance for ${iface.name}:`, error.message);
      }
    });

    // Periodic refresh
    this.discoveryInterval = setInterval(() => {
      this.app.debug('Refreshing Fusion mDNS discovery...');
      this.browsers.forEach(browser => {
        try {
          browser.update();
        } catch (error) {
          this.app.debug('Error updating browser:', error.message);
        }
      });
    }, 30000);

    // Initial diagnostic log
    setTimeout(() => {
      this.logDiscoveryDiagnostics();
    }, 5000);
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
    const name = service.name ? service.name.toLowerCase() : '';
    const type = service.type ? service.type.toLowerCase() : '';
    const txt = service.txt || {};

    // Check for Fusion/Garmin indicators
    const nameMatch = name.includes('fusion') ||
                     name.includes('garmin') ||
                     name.includes('ms-ra') ||
                     name.includes('marine-stereo');

    const typeMatch = type.includes('fusion') ||
                     type.includes('garmin');

    const txtMatch = txt.manufacturer === 'Garmin' ||
                    txt.model?.toLowerCase().includes('fusion') ||
                    txt.model?.toLowerCase().includes('ms-ra');

    const portMatch = service.port === 80 || service.port === 8080 || service.port === 443;

    this.app.debug(`Checking if service is Fusion device:`, {
      name,
      type,
      txt,
      port: service.port,
      nameMatch,
      typeMatch,
      txtMatch,
      portMatch
    });

    return nameMatch || typeMatch || txtMatch;
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
      lastSeen: device.lastSeen,
      online: Date.now() - device.lastSeen < 60000 // Consider online if seen in last minute
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

  logNetworkInterfaces() {
    const interfaces = os.networkInterfaces();
    this.app.debug('Available network interfaces for Fusion discovery:');

    Object.keys(interfaces).forEach(name => {
      interfaces[name].forEach(iface => {
        if (!iface.internal) {
          this.app.debug(`  ${name}: ${iface.address} (${iface.family})`);
        }
      });
    });
  }

  logDiscoveryDiagnostics() {
    this.app.debug('=== Fusion Discovery Diagnostics ===');
    this.app.debug('Discovery status:', this.isStarted ? 'running' : 'stopped');
    this.app.debug('Bonjour instances:', this.bonjourInstances.length);
    this.app.debug('Active browsers:', this.browsers.length);
    this.app.debug('Discovered devices:', this.devices.size);

    if (this.devices.size > 0) {
      this.app.debug('Device details:');
      this.devices.forEach((device, id) => {
        const age = Date.now() - device.lastSeen;
        this.app.debug(`  - ${device.name} at ${device.host}:${device.port} (${Math.round(age/1000)}s ago)`);
      });
    }

    this.app.debug('=== End Fusion Diagnostics ===');
  }

  startNetworkScan() {
    // Additional network scanning for Fusion devices
    this.app.debug('Starting network scan for Fusion devices...');

    // Get local network ranges
    const interfaces = os.networkInterfaces();
    const networks = [];

    Object.keys(interfaces).forEach(name => {
      interfaces[name].forEach(iface => {
        if (!iface.internal && iface.family === 'IPv4') {
          // Calculate network address (simple /24 assumption)
          const parts = iface.address.split('.');
          const networkBase = `${parts[0]}.${parts[1]}.${parts[2]}`;
          networks.push(networkBase);
        }
      });
    });

    this.app.debug(`Scanning networks: ${networks.join(', ')}`);

    // Scan common Fusion device ports on local networks
    networks.forEach(networkBase => {
      this.scanNetwork(networkBase);
    });

    // Repeat network scan every 5 minutes
    this.networkScanInterval = setInterval(() => {
      networks.forEach(networkBase => {
        this.scanNetwork(networkBase);
      });
    }, 300000);
  }

  async scanNetwork(networkBase) {
    const commonPorts = [80, 8080, 443, 8000, 8443];
    const hostPromises = [];

    // Scan first 10 and last 10 addresses in range (common device locations)
    const addresses = [
      ...Array.from({length: 10}, (_, i) => i + 1),
      ...Array.from({length: 10}, (_, i) => i + 245)
    ];

    addresses.forEach(lastOctet => {
      const host = `${networkBase}.${lastOctet}`;
      commonPorts.forEach(port => {
        hostPromises.push(this.checkFusionDevice(host, port));
      });
    });

    // Process in batches to avoid overwhelming the network
    const batchSize = 10;
    for (let i = 0; i < hostPromises.length; i += batchSize) {
      const batch = hostPromises.slice(i, i + batchSize);
      await Promise.allSettled(batch);
      // Small delay between batches
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  async checkFusionDevice(host, port) {
    try {
      const response = await axios.get(`http://${host}:${port}/`, {
        timeout: 2000,
        headers: {
          'User-Agent': 'SignalK-Sonos-Fusion-Plugin/1.0'
        }
      });

      // Check response for Fusion/Garmin indicators
      const content = response.data.toLowerCase();
      const headers = Object.keys(response.headers).map(k =>
        `${k}: ${response.headers[k]}`.toLowerCase()
      ).join(' ');

      if (content.includes('fusion') ||
          content.includes('garmin') ||
          content.includes('marine stereo') ||
          headers.includes('fusion') ||
          headers.includes('garmin')) {

        this.app.debug(`Found potential Fusion device via HTTP scan: ${host}:${port}`);

        // Add to devices if not already present
        const deviceId = `${host}:${port}`;
        if (!this.devices.has(deviceId)) {
          this.devices.set(deviceId, {
            id: deviceId,
            name: `Fusion Device (${host})`,
            host: host,
            port: port,
            lastSeen: Date.now(),
            discoveryMethod: 'network-scan'
          });

          this.app.debug(`Added Fusion device from network scan: ${deviceId}`);
        }
      }
    } catch (error) {
      // Silently ignore connection failures during scanning
    }
  }
}

module.exports = { FusionController };