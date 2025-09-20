const { DeviceDiscovery, Sonos } = require('node-sonos');
const EventEmitter = require('eventemitter3');

class SonosController extends EventEmitter {
  constructor(app) {
    super();
    this.app = app;
    this.devices = new Map();
    this.discovery = null;
    this.pollingInterval = null;
    this.isStarted = false;
  }

  start() {
    if (this.isStarted) return;

    this.app.debug('Starting Sonos controller');
    this.isStarted = true;

    this.discovery = DeviceDiscovery();

    this.discovery.on('DeviceAvailable', (device) => {
      this.app.debug('Sonos device discovered:', device.host);
      this.handleDeviceDiscovered(device);
    });

    this.discovery.on('DeviceUnavailable', (device) => {
      this.app.debug('Sonos device unavailable:', device.host);
      this.handleDeviceUnavailable(device);
    });

    this.startPolling();
  }

  stop() {
    if (!this.isStarted) return;

    this.app.debug('Stopping Sonos controller');
    this.isStarted = false;

    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }

    if (this.discovery) {
      this.discovery.destroy();
      this.discovery = null;
    }

    this.devices.clear();
  }

  addDevice(deviceId) {
    if (this.devices.has(deviceId)) {
      this.app.debug(`Sonos device ${deviceId} already added`);
      return;
    }

    const device = this.findDeviceById(deviceId);
    if (device) {
      this.app.debug(`Adding Sonos device: ${deviceId}`);
      this.devices.set(deviceId, device);
      this.subscribeToDevice(deviceId, device);
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
      await device.setVolume(volume);
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
      await device.adjustVolume(volumeChange);
      this.app.debug(`Adjusted Sonos volume: ${deviceId} -> ${volumeChange}`);
    } catch (error) {
      this.app.error(`Failed to adjust Sonos volume: ${error.message}`);
    }
  }

  async getPlaybackState(deviceId) {
    const device = this.devices.get(deviceId);
    if (!device) return null;

    try {
      const state = await device.getCurrentState();
      return this.normalizePlaybackState(state);
    } catch (error) {
      this.app.error(`Failed to get playback state: ${error.message}`);
      return null;
    }
  }

  async getCurrentTrack(deviceId) {
    const device = this.devices.get(deviceId);
    if (!device) return null;

    try {
      const track = await device.currentTrack();
      return {
        title: track.title || 'Unknown',
        artist: track.artist || 'Unknown',
        album: track.album || 'Unknown',
        duration: track.duration || 0,
        position: track.position || 0,
        uri: track.uri
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
      return await device.getVolume();
    } catch (error) {
      this.app.error(`Failed to get volume: ${error.message}`);
      return null;
    }
  }

  handleDeviceDiscovered(device) {
    this.app.debug('New Sonos device discovered:', {
      host: device.host,
      port: device.port,
      name: device.roomName
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
    if (!this.discovery) return null;

    const devices = this.discovery.getDevices();
    return devices.find(device => this.getDeviceId(device) === deviceId);
  }

  getDeviceId(device) {
    return `${device.host}:${device.port}`;
  }

  subscribeToDevice(deviceId, device) {
    this.pollDeviceState(deviceId, device);
  }

  async pollDeviceState(deviceId, device) {
    try {
      const [state, volume, track] = await Promise.all([
        device.getCurrentState(),
        device.getVolume(),
        device.currentTrack().catch(() => null)
      ]);

      const normalizedState = this.normalizePlaybackState(state);

      this.emit('playbackStateChanged', deviceId, normalizedState);
      this.emit('volumeChanged', deviceId, volume);

      if (track) {
        const normalizedTrack = {
          title: track.title || 'Unknown',
          artist: track.artist || 'Unknown',
          album: track.album || 'Unknown',
          duration: track.duration || 0
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
    switch (state) {
      case 'playing':
        return 'playing';
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

  getAvailableDevices() {
    if (!this.discovery) return [];

    return this.discovery.getDevices().map(device => ({
      id: this.getDeviceId(device),
      name: device.roomName || device.host,
      host: device.host,
      port: device.port
    }));
  }
}

module.exports = { SonosController };