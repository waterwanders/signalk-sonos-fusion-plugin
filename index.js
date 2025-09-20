const { DeviceManager } = require('./lib/deviceManager');
const { FusionController } = require('./lib/fusionController');
const { SonosController } = require('./lib/sonosController');
const { NMEA2000Handler } = require('./lib/nmea2000Handler');
const EventEmitter = require('eventemitter3');

module.exports = function(app) {
  const plugin = {};
  let deviceManager;
  let fusionController;
  let sonosController;
  let nmea2000Handler;
  let unsubscribes = [];

  plugin.id = 'signalk-sonos-fusion-plugin';
  plugin.name = 'Sonos-Fusion Integration';
  plugin.description = 'Integrates Sonos Port with Fusion Audio amplifiers for marine audio control';

  plugin.schema = {
    type: 'object',
    properties: {
      devicePairs: {
        type: 'array',
        title: 'Device Pairs',
        description: 'Configure Sonos Port and Fusion Audio device associations',
        items: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              title: 'Pair Name',
              description: 'Friendly name for this device pair'
            },
            sonosDevice: {
              type: 'string',
              title: 'Sonos Device',
              description: 'Sonos Port device identifier'
            },
            fusionDevice: {
              type: 'string',
              title: 'Fusion Device',
              description: 'Fusion Audio device identifier'
            },
            fusionInput: {
              type: 'string',
              title: 'Fusion Input',
              description: 'Input on Fusion device that Sonos is connected to',
              enum: ['aux1', 'aux2', 'aux3', 'usb', 'bluetooth', 'am', 'fm']
            },
            volumeSync: {
              type: 'boolean',
              title: 'Volume Synchronization',
              description: 'Sync volume changes between Sonos and Fusion',
              default: true
            },
            enabled: {
              type: 'boolean',
              title: 'Enabled',
              description: 'Enable this device pair',
              default: true
            }
          },
          required: ['name', 'sonosDevice', 'fusionDevice', 'fusionInput']
        }
      },
      nmea2000: {
        type: 'object',
        title: 'NMEA2000 Settings',
        properties: {
          enabled: {
            type: 'boolean',
            title: 'Enable NMEA2000 Integration',
            description: 'Expose audio status and controls over NMEA2000',
            default: true
          },
          deviceInstance: {
            type: 'number',
            title: 'Device Instance',
            description: 'NMEA2000 device instance number',
            default: 0,
            minimum: 0,
            maximum: 255
          }
        }
      },
      discovery: {
        type: 'object',
        title: 'Device Discovery',
        properties: {
          autoDiscovery: {
            type: 'boolean',
            title: 'Auto Discovery',
            description: 'Automatically discover Sonos and Fusion devices',
            default: true
          },
          discoveryInterval: {
            type: 'number',
            title: 'Discovery Interval (seconds)',
            description: 'How often to scan for new devices',
            default: 30,
            minimum: 10,
            maximum: 300
          }
        }
      }
    }
  };

  plugin.start = function(options) {
    app.debug('Starting Sonos-Fusion plugin with options:', options);

    try {
      deviceManager = new DeviceManager(app, options);
      fusionController = new FusionController(app);
      sonosController = new SonosController(app);
      nmea2000Handler = new NMEA2000Handler(app, options.nmea2000 || {});

      deviceManager.on('devicePairReady', handleDevicePairReady);
      deviceManager.on('devicePairRemoved', handleDevicePairRemoved);

      sonosController.on('playbackStateChanged', handlePlaybackStateChanged);
      sonosController.on('volumeChanged', handleVolumeChanged);
      sonosController.on('trackChanged', handleTrackChanged);

      fusionController.on('volumeChanged', handleFusionVolumeChanged);

      nmea2000Handler.on('volumeControl', handleNMEAVolumeControl);

      deviceManager.start();

      app.setPluginStatus('Started successfully');
    } catch (error) {
      app.setPluginError(`Failed to start: ${error.message}`);
      app.error('Plugin start error:', error);
    }
  };

  plugin.stop = function() {
    app.debug('Stopping Sonos-Fusion plugin');

    unsubscribes.forEach(fn => fn());
    unsubscribes = [];

    if (deviceManager) {
      deviceManager.stop();
      deviceManager = null;
    }

    if (fusionController) {
      fusionController.stop();
      fusionController = null;
    }

    if (sonosController) {
      sonosController.stop();
      sonosController = null;
    }

    if (nmea2000Handler) {
      nmea2000Handler.stop();
      nmea2000Handler = null;
    }

    app.setPluginStatus('Stopped');
  };

  function handleDevicePairReady(pair) {
    app.debug(`Device pair ready: ${pair.name}`);

    sonosController.addDevice(pair.sonosDevice);
    fusionController.addDevice(pair.fusionDevice);

    const status = {
      timestamp: Date.now(),
      source: plugin.id,
      values: {
        [`entertainment.audio.${pair.name}.status`]: {
          value: 'ready',
          timestamp: new Date().toISOString()
        }
      }
    };

    app.handleMessage(plugin.id, status);
  }

  function handleDevicePairRemoved(pair) {
    app.debug(`Device pair removed: ${pair.name}`);

    sonosController.removeDevice(pair.sonosDevice);
    fusionController.removeDevice(pair.fusionDevice);
  }

  function handlePlaybackStateChanged(device, state) {
    app.debug(`Sonos playback state changed: ${device} -> ${state}`);

    const pair = deviceManager.getPairBySonosDevice(device);
    if (!pair) return;

    if (state === 'playing') {
      fusionController.switchInput(pair.fusionDevice, pair.fusionInput);
    }

    const status = {
      timestamp: Date.now(),
      source: plugin.id,
      values: {
        [`entertainment.audio.${pair.name}.playbackState`]: {
          value: state,
          timestamp: new Date().toISOString()
        }
      }
    };

    app.handleMessage(plugin.id, status);

    if (nmea2000Handler) {
      nmea2000Handler.updatePlaybackState(pair.name, state);
    }
  }

  function handleVolumeChanged(device, volume) {
    app.debug(`Sonos volume changed: ${device} -> ${volume}`);

    const pair = deviceManager.getPairBySonosDevice(device);
    if (!pair || !pair.volumeSync) return;

    fusionController.setVolume(pair.fusionDevice, volume);

    const status = {
      timestamp: Date.now(),
      source: plugin.id,
      values: {
        [`entertainment.audio.${pair.name}.volume`]: {
          value: volume / 100,
          timestamp: new Date().toISOString()
        }
      }
    };

    app.handleMessage(plugin.id, status);

    if (nmea2000Handler) {
      nmea2000Handler.updateVolume(pair.name, volume);
    }
  }

  function handleTrackChanged(device, track) {
    app.debug(`Sonos track changed: ${device}`, track);

    const pair = deviceManager.getPairBySonosDevice(device);
    if (!pair) return;

    const status = {
      timestamp: Date.now(),
      source: plugin.id,
      values: {
        [`entertainment.audio.${pair.name}.currentTrack`]: {
          value: {
            title: track.title,
            artist: track.artist,
            album: track.album,
            duration: track.duration
          },
          timestamp: new Date().toISOString()
        }
      }
    };

    app.handleMessage(plugin.id, status);

    if (nmea2000Handler) {
      nmea2000Handler.updateTrack(pair.name, track);
    }
  }

  function handleFusionVolumeChanged(device, volume) {
    app.debug(`Fusion volume changed: ${device} -> ${volume}`);

    const pair = deviceManager.getPairByFusionDevice(device);
    if (!pair || !pair.volumeSync) return;

    sonosController.setVolume(pair.sonosDevice, volume);
  }

  function handleNMEAVolumeControl(pairName, volumeChange) {
    app.debug(`NMEA volume control: ${pairName} -> ${volumeChange}`);

    const pair = deviceManager.getPairByName(pairName);
    if (!pair) return;

    sonosController.adjustVolume(pair.sonosDevice, volumeChange);
  }

  return plugin;
};