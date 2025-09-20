const EventEmitter = require('eventemitter3');

class NMEA2000Handler extends EventEmitter {
  constructor(app, options) {
    super();
    this.app = app;
    this.options = options || {};
    this.enabled = options.enabled !== false;
    this.deviceInstance = options.deviceInstance || 0;
    this.pairStates = new Map();
    this.subscriptions = [];
    this.isStarted = false;
  }

  start() {
    if (this.isStarted || !this.enabled) return;

    this.app.debug('Starting NMEA2000 handler');
    this.isStarted = true;

    this.subscribeToNMEAMessages();
    this.startHeartbeat();
  }

  stop() {
    if (!this.isStarted) return;

    this.app.debug('Stopping NMEA2000 handler');
    this.isStarted = false;

    this.subscriptions.forEach(unsub => unsub());
    this.subscriptions = [];

    this.pairStates.clear();
  }

  subscribeToNMEAMessages() {
    this.subscriptions.push(
      this.app.streambundle.getSelfBus('/vessels/self').onValue(delta => {
        this.handleDeltaMessage(delta);
      })
    );

    this.subscriptions.push(
      this.app.streambundle.getSelfBus('/vessels/self/entertainment/audio/*/controls/volume').onValue(delta => {
        this.handleVolumeControl(delta);
      })
    );

    this.subscriptions.push(
      this.app.streambundle.getSelfBus('/vessels/self/entertainment/audio/*/controls/playback').onValue(delta => {
        this.handlePlaybackControl(delta);
      })
    );
  }

  handleDeltaMessage(delta) {
    if (!delta.updates) return;

    delta.updates.forEach(update => {
      if (update.source && update.source.bus && update.source.bus.startsWith('can')) {
        this.processNMEAUpdate(update);
      }
    });
  }

  processNMEAUpdate(update) {
    if (!update.values) return;

    update.values.forEach(value => {
      const path = value.path;

      if (path.includes('entertainment.audio') && path.includes('controls')) {
        this.handleNMEAControl(path, value.value);
      }
    });
  }

  handleNMEAControl(path, value) {
    const pathParts = path.split('.');
    const pairNameIndex = pathParts.indexOf('audio') + 1;

    if (pairNameIndex >= pathParts.length) return;

    const pairName = pathParts[pairNameIndex];
    const controlType = pathParts[pathParts.length - 1];

    this.app.debug(`NMEA control received: ${pairName} ${controlType}`, value);

    switch (controlType) {
      case 'volume':
        this.handleNMEAVolumeControl(pairName, value);
        break;
      case 'playback':
        this.handleNMEAPlaybackControl(pairName, value);
        break;
      case 'source':
        this.handleNMEASourceControl(pairName, value);
        break;
    }
  }

  handleNMEAVolumeControl(pairName, volumeData) {
    if (typeof volumeData === 'object' && volumeData.change !== undefined) {
      this.emit('volumeControl', pairName, volumeData.change);
    } else if (typeof volumeData === 'number') {
      this.emit('volumeSet', pairName, volumeData);
    }
  }

  handleNMEAPlaybackControl(pairName, playbackData) {
    if (typeof playbackData === 'string') {
      this.emit('playbackControl', pairName, playbackData);
    }
  }

  handleNMEASourceControl(pairName, sourceData) {
    if (typeof sourceData === 'string') {
      this.emit('sourceControl', pairName, sourceData);
    }
  }

  handleVolumeControl(delta) {
    if (!delta.context || !delta.updates) return;

    const pathMatch = delta.context.match(/entertainment\/audio\/([^\/]+)\/controls\/volume/);
    if (!pathMatch) return;

    const pairName = pathMatch[1];

    delta.updates.forEach(update => {
      if (update.values) {
        update.values.forEach(value => {
          if (value.path === 'entertainment.audio.' + pairName + '.controls.volume') {
            this.handleNMEAVolumeControl(pairName, value.value);
          }
        });
      }
    });
  }

  handlePlaybackControl(delta) {
    if (!delta.context || !delta.updates) return;

    const pathMatch = delta.context.match(/entertainment\/audio\/([^\/]+)\/controls\/playback/);
    if (!pathMatch) return;

    const pairName = pathMatch[1];

    delta.updates.forEach(update => {
      if (update.values) {
        update.values.forEach(value => {
          if (value.path === 'entertainment.audio.' + pairName + '.controls.playback') {
            this.handleNMEAPlaybackControl(pairName, value.value);
          }
        });
      }
    });
  }

  updatePlaybackState(pairName, state) {
    if (!this.enabled || !this.isStarted) return;

    const pairState = this.getPairState(pairName);
    pairState.playbackState = state;
    pairState.lastUpdate = Date.now();

    this.sendPGN129540(pairName, pairState);
    this.sendPGN129041(pairName, pairState);
  }

  updateVolume(pairName, volume) {
    if (!this.enabled || !this.isStarted) return;

    const pairState = this.getPairState(pairName);
    pairState.volume = volume;
    pairState.lastUpdate = Date.now();

    this.sendPGN129540(pairName, pairState);
  }

  updateTrack(pairName, track) {
    if (!this.enabled || !this.isStarted) return;

    const pairState = this.getPairState(pairName);
    pairState.currentTrack = track;
    pairState.lastUpdate = Date.now();

    this.sendPGN129041(pairName, pairState);
  }

  getPairState(pairName) {
    if (!this.pairStates.has(pairName)) {
      this.pairStates.set(pairName, {
        playbackState: 'stopped',
        volume: 0,
        currentTrack: null,
        lastUpdate: Date.now()
      });
    }

    return this.pairStates.get(pairName);
  }

  sendPGN129540(pairName, state) {
    const message = {
      timestamp: new Date().toISOString(),
      source: `sonos-fusion-plugin.${this.deviceInstance}`,
      values: {
        [`entertainment.audio.${pairName}.playbackState`]: {
          value: state.playbackState,
          timestamp: new Date().toISOString()
        },
        [`entertainment.audio.${pairName}.volume`]: {
          value: state.volume / 100,
          timestamp: new Date().toISOString()
        }
      }
    };

    this.app.handleMessage('sonos-fusion-plugin', message);

    this.app.debug(`Sent PGN 129540 for ${pairName}:`, {
      playbackState: state.playbackState,
      volume: state.volume
    });
  }

  sendPGN129041(pairName, state) {
    if (!state.currentTrack) return;

    const message = {
      timestamp: new Date().toISOString(),
      source: `sonos-fusion-plugin.${this.deviceInstance}`,
      values: {
        [`entertainment.audio.${pairName}.currentTrack.title`]: {
          value: state.currentTrack.title,
          timestamp: new Date().toISOString()
        },
        [`entertainment.audio.${pairName}.currentTrack.artist`]: {
          value: state.currentTrack.artist,
          timestamp: new Date().toISOString()
        },
        [`entertainment.audio.${pairName}.currentTrack.album`]: {
          value: state.currentTrack.album,
          timestamp: new Date().toISOString()
        },
        [`entertainment.audio.${pairName}.currentTrack.duration`]: {
          value: state.currentTrack.duration,
          timestamp: new Date().toISOString()
        }
      }
    };

    this.app.handleMessage('sonos-fusion-plugin', message);

    this.app.debug(`Sent PGN 129041 for ${pairName}:`, state.currentTrack);
  }

  startHeartbeat() {
    setInterval(() => {
      if (!this.enabled || !this.isStarted) return;

      this.pairStates.forEach((state, pairName) => {
        if (Date.now() - state.lastUpdate < 30000) {
          this.sendHeartbeat(pairName, state);
        }
      });
    }, 10000);
  }

  sendHeartbeat(pairName, state) {
    const message = {
      timestamp: new Date().toISOString(),
      source: `sonos-fusion-plugin.${this.deviceInstance}`,
      values: {
        [`entertainment.audio.${pairName}.status`]: {
          value: 'online',
          timestamp: new Date().toISOString()
        },
        [`entertainment.audio.${pairName}.lastSeen`]: {
          value: new Date().toISOString(),
          timestamp: new Date().toISOString()
        }
      }
    };

    this.app.handleMessage('sonos-fusion-plugin', message);
  }

  getDeviceInfo() {
    return {
      deviceInstance: this.deviceInstance,
      manufacturer: 'WanderTracks',
      model: 'Sonos-Fusion Bridge',
      softwareVersion: '1.0.0',
      serialNumber: `SF-${this.deviceInstance.toString().padStart(3, '0')}`
    };
  }

  sendDeviceInfo() {
    const deviceInfo = this.getDeviceInfo();

    const message = {
      timestamp: new Date().toISOString(),
      source: `sonos-fusion-plugin.${this.deviceInstance}`,
      values: {
        'design.aisClass': {
          value: 'B',
          timestamp: new Date().toISOString()
        },
        'design.draft': {
          value: {
            maximum: 0,
            minimum: 0,
            current: 0
          },
          timestamp: new Date().toISOString()
        }
      }
    };

    this.app.handleMessage('sonos-fusion-plugin', message);
  }
}

module.exports = { NMEA2000Handler };