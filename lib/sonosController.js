const { SonosDevice, SonosManager } = require('@svrooij/sonos');
const EventEmitter = require('eventemitter3');
const os = require('os');

class SonosController extends EventEmitter {
  constructor(app) {
    super();
    this.app = app;
    this.devices = new Map();
    this.manager = null;
    this.pollingInterval = null;
    this.isStarted = false;
  }

  async start() {
    if (this.isStarted) return;

    this.app.debug('Starting Sonos controller');
    this.logNetworkInterfaces();
    this.isStarted = true;

    try {
      this.app.debug('Creating SonosManager instance');
      this.manager = new SonosManager();

      this.manager.on('device-discovered', (device) => {
        this.app.debug('Sonos device discovered:', {
          host: device.Host,
          port: device.Port,
          name: device.Name,
          uuid: device.Uuid
        });
        this.handleDeviceDiscovered(device);
      });

      this.manager.on('device-left', (device) => {
        this.app.debug('Sonos device left:', device.Host);
        this.handleDeviceUnavailable(device);
      });

      this.app.debug('Starting Sonos discovery with 15 second timeout');
      // TODO(mordred): Don't hardcode this here, why isn't discovery working?
      const discoveredDevices = await this.manager.InitializeFromDevice('192.168.50.161');
      // const discoveredDevices = await this.manager.InitializeWithDiscovery(15);

      this.app.debug(`Sonos discovery completed. Found ${discoveredDevices.length} devices`);
      if (discoveredDevices.length === 0) {
        this.app.debug('No Sonos devices found during initial discovery');
        this.logDiscoveryDiagnostics();
      } else {
        discoveredDevices.forEach(device => {
          this.app.debug('Initial discovery found device:', {
            host: device.Host,
            port: device.Port,
            name: device.Name
          });
        });
      }

      this.startPolling();
      this.startContinuousDiscovery();
    } catch (error) {
      this.app.error('Failed to start Sonos discovery:', error);
      this.logDiscoveryDiagnostics();
    }
  }

  stop() {
    if (!this.isStarted) return;

    this.app.debug('Stopping Sonos controller');
    this.isStarted = false;

    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }

    if (this.discoveryInterval) {
      clearInterval(this.discoveryInterval);
      this.discoveryInterval = null;
    }

    if (this.manager) {
      this.manager.removeAllListeners();
      this.manager = null;
    }

    this.devices.clear();
  }

  addDevice(deviceId) {
    if (this.devices.has(deviceId)) {
      this.app.debug(`Sonos device ${deviceId} already added`);
      return;
    }

    const discoveredDevice = this.findDeviceById(deviceId);
    if (discoveredDevice) {
      this.app.debug(`Adding Sonos device: ${deviceId}`);
      this.devices.set(deviceId, discoveredDevice);
      this.subscribeToDevice(deviceId, discoveredDevice);
    } else {
      this.app.debug(`Sonos device ${deviceId} not found`);
    }
  }

  removeDevice(deviceId) {
    if (this.devices.has(deviceId)) {
      this.app.debug(`Removing Sonos device: ${deviceId}`);
      this.devices.delete(deviceId);
    }
  }

  async setVolume(deviceId, volume) {
    const device = this.devices.get(deviceId);
    if (!device) {
      this.app.debug(`Sonos device ${deviceId} not found for volume control`);
      return;
    }

    try {
      await device.SetVolume(volume);
      this.app.debug(`Set Sonos volume: ${deviceId} -> ${volume}`);
    } catch (error) {
      this.app.error(`Failed to set Sonos volume: ${error.message}`);
    }
  }

  async adjustVolume(deviceId, volumeChange) {
    const device = this.devices.get(deviceId);
    if (!device) {
      this.app.debug(`Sonos device ${deviceId} not found for volume adjustment`);
      return;
    }

    try {
      const currentVolume = await device.GetVolume();
      const newVolume = Math.max(0, Math.min(100, currentVolume + volumeChange));
      await device.SetVolume(newVolume);
      this.app.debug(`Adjusted Sonos volume: ${deviceId} -> ${volumeChange}`);
    } catch (error) {
      this.app.error(`Failed to adjust Sonos volume: ${error.message}`);
    }
  }

  async getPlaybackState(deviceId) {
    const device = this.devices.get(deviceId);
    if (!device) return null;

    try {
      const state = await device.GetTransportInfo();
      return this.normalizePlaybackState(state.CurrentTransportState);
    } catch (error) {
      this.app.error(`Failed to get playback state: ${error.message}`);
      return null;
    }
  }

  async getCurrentTrack(deviceId) {
    const device = this.devices.get(deviceId);
    if (!device) return null;

    try {
      const track = await device.GetPositionInfo();
      return {
        title: track.TrackMetaData?.Title || 'Unknown',
        artist: track.TrackMetaData?.Artist || 'Unknown',
        album: track.TrackMetaData?.Album || 'Unknown',
        duration: this.parseDuration(track.TrackDuration) || 0,
        position: this.parseDuration(track.RelTime) || 0,
        uri: track.TrackURI
      };
    } catch (error) {
      this.app.error(`Failed to get current track: ${error.message}`);
      return null;
    }
  }

  async getVolume(deviceId) {
    const device = this.devices.get(deviceId);
    if (!device) return null;

    try {
      return await device.GetVolume();
    } catch (error) {
      this.app.error(`Failed to get volume: ${error.message}`);
      return null;
    }
  }

  handleDeviceDiscovered(device) {
    this.app.debug('New Sonos device discovered:', {
      host: device.Host,
      port: device.Port,
      name: device.Name
    });
  }

  handleDeviceUnavailable(device) {
    const deviceId = this.getDeviceId(device);
    if (this.devices.has(deviceId)) {
      this.app.debug(`Sonos device became unavailable: ${deviceId}`);
      this.devices.delete(deviceId);
    }
  }

  findDeviceById(deviceId) {
    if (!this.manager) return null;

    return this.manager.Devices.find(device => this.getDeviceId(device) === deviceId);
  }

  getDeviceId(device) {
    return `${device.Host}:${device.Port}`;
  }

  subscribeToDevice(deviceId, device) {
    this.pollDeviceState(deviceId, device);
  }

  async pollDeviceState(deviceId, device) {
    try {
      const [transportInfo, volume, positionInfo] = await Promise.all([
        device.GetTransportInfo(),
        device.GetVolume(),
        device.GetPositionInfo().catch(() => null)
      ]);

      const normalizedState = this.normalizePlaybackState(transportInfo.CurrentTransportState);

      this.emit('playbackStateChanged', deviceId, normalizedState);
      this.emit('volumeChanged', deviceId, volume);

      if (positionInfo && positionInfo.TrackMetaData) {
        const normalizedTrack = {
          title: positionInfo.TrackMetaData.Title || 'Unknown',
          artist: positionInfo.TrackMetaData.Artist || 'Unknown',
          album: positionInfo.TrackMetaData.Album || 'Unknown',
          duration: this.parseDuration(positionInfo.TrackDuration) || 0
        };
        this.emit('trackChanged', deviceId, normalizedTrack);
      }

    } catch (error) {
      this.app.debug(`Failed to poll device state for ${deviceId}: ${error.message}`);
    }
  }

  startPolling() {
    this.pollingInterval = setInterval(() => {
      this.devices.forEach((device, deviceId) => {
        this.pollDeviceState(deviceId, device);
      });
    }, 2000);
  }

  normalizePlaybackState(state) {
    switch (state?.toLowerCase()) {
      case 'playing':
        return 'playing';
      case 'paused_playback':
      case 'paused':
        return 'paused';
      case 'stopped':
        return 'stopped';
      case 'transitioning':
        return 'transitioning';
      default:
        return 'unknown';
    }
  }

  parseDuration(duration) {
    if (!duration || typeof duration !== 'string') return 0;

    const parts = duration.split(':');
    if (parts.length === 3) {
      const hours = parseInt(parts[0]) || 0;
      const minutes = parseInt(parts[1]) || 0;
      const seconds = parseInt(parts[2]) || 0;
      return hours * 3600 + minutes * 60 + seconds;
    } else if (parts.length === 2) {
      const minutes = parseInt(parts[0]) || 0;
      const seconds = parseInt(parts[1]) || 0;
      return minutes * 60 + seconds;
    } else {
      return parseInt(duration) || 0;
    }
  }

  getAvailableDevices() {
    if (!this.manager) return [];

    return this.manager.Devices.map(device => ({
      id: this.getDeviceId(device),
      name: device.Name || device.Host,
      host: device.Host,
      port: device.Port,
      online: true
    }));
  }

  logNetworkInterfaces() {
    const interfaces = os.networkInterfaces();
    this.app.debug('Available network interfaces:');

    Object.keys(interfaces).forEach(name => {
      interfaces[name].forEach(iface => {
        if (!iface.internal) {
          this.app.debug(`  ${name}: ${iface.address} (${iface.family})`);
        }
      });
    });
  }

  logDiscoveryDiagnostics() {
    this.app.debug('=== Sonos Discovery Diagnostics ===');
    this.app.debug('Manager status:', this.manager ? 'initialized' : 'not initialized');
    this.app.debug('Device count:', this.manager ? this.manager.Devices.length : 0);

    if (this.manager && this.manager.Devices.length > 0) {
      this.app.debug('Discovered devices:');
      this.manager.Devices.forEach(device => {
        this.app.debug(`  - ${device.Name} at ${device.Host}:${device.Port}`);
      });
    }

    // Check for common network issues
    const interfaces = os.networkInterfaces();
    const hasIPv4 = Object.values(interfaces).flat().some(iface =>
      !iface.internal && iface.family === 'IPv4'
    );

    if (!hasIPv4) {
      this.app.debug('WARNING: No external IPv4 interfaces found');
    }

    this.app.debug('=== End Diagnostics ===');
  }

  startContinuousDiscovery() {
    // Continue discovery every 30 seconds
    this.discoveryInterval = setInterval(async () => {
      try {
        this.app.debug('Running periodic Sonos discovery...');
        const newDevices = await this.manager.CheckAllGroupsForNewDevices();

        if (newDevices && newDevices.length > 0) {
          this.app.debug(`Found ${newDevices.length} new Sonos devices during periodic scan`);
          newDevices.forEach(device => {
            this.app.debug('New device found:', {
              host: device.Host,
              name: device.Name
            });
          });
        }
      } catch (error) {
        this.app.debug('Error during periodic Sonos discovery:', error.message);
      }
    }, 30000);
  }
}

module.exports = { SonosController };
