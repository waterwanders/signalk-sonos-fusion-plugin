# SignalK Sonos-Fusion Integration Plugin

A SignalK plugin that seamlessly integrates Sonos Port devices with Fusion Audio amplifiers, providing "Works with Sonos" style functionality for marine audio systems.

## Features

- **Automatic Device Discovery**: Discovers Sonos Port and Fusion Audio devices on your network
- **Device Association**: Pair Sonos Port devices with specific Fusion Audio amplifiers
- **Automatic Input Switching**: When Sonos starts playing, automatically switches Fusion to the configured input
- **Volume Synchronization**: Bidirectional volume control between Sonos and Fusion devices
- **NMEA2000 Integration**: Exposes audio status and controls over NMEA2000 for chartplotter compatibility
- **Web Interface**: Complete management interface for device configuration
- **Real-time Monitoring**: Live status updates and activity tracking

## Installation

### Via SignalK Plugin Manager

1. Open SignalK server admin interface
2. Navigate to "Server" → "Plugin Config"
3. Search for "signalk-sonos-fusion"
4. Click "Install"

### Manual Installation

```bash
cd /opt/signalk-server/
npm install @waterwanders/signalk-sonos-fusion
```

## Configuration

### Basic Setup

1. Enable the plugin in SignalK admin interface
2. Navigate to the plugin configuration page
3. Configure your device pairs:
   - **Pair Name**: Friendly name for the device pair
   - **Sonos Device**: Select your Sonos Port from discovered devices
   - **Fusion Device**: Select your Fusion amplifier
   - **Fusion Input**: Choose which input the Sonos is connected to
   - **Volume Sync**: Enable/disable volume synchronization

### Configuration Options

#### Device Pairs

Each device pair represents a Sonos Port connected to a Fusion Audio device:

```json
{
  "name": "Main Salon",
  "sonosDevice": "192.168.1.100:1400",
  "fusionDevice": "192.168.1.101:80",
  "fusionInput": "aux1",
  "volumeSync": true,
  "enabled": true
}
```

**Supported Fusion Inputs:**
- `aux1`, `aux2`, `aux3` - Auxiliary inputs
- `usb` - USB input
- `bluetooth` - Bluetooth input
- `am`, `fm` - Radio inputs

#### NMEA2000 Settings

```json
{
  "nmea2000": {
    "enabled": true,
    "deviceInstance": 0
  }
}
```

#### Discovery Settings

```json
{
  "discovery": {
    "autoDiscovery": true,
    "discoveryInterval": 30
  }
}
```

## Usage

### Basic Operation

1. **Device Discovery**: The plugin automatically discovers Sonos and Fusion devices on your network
2. **Create Pairs**: Use the web interface to associate Sonos devices with Fusion amplifiers
3. **Automatic Switching**: When you start playing music on Sonos, the Fusion automatically switches to the configured input
4. **Volume Control**: Adjust volume on either device, and the other will follow (if volume sync is enabled)

### Web Interface

Access the plugin web interface at: `http://your-signalk-server/plugins/sonos-fusion`

The interface provides:

- **Overview**: System status and activity summary
- **Devices**: List of discovered Sonos and Fusion devices
- **Device Pairs**: Manage device associations
- **Diagnostics**: System diagnostics and troubleshooting

### NMEA2000 Integration

The plugin exposes the following NMEA2000 data:

#### PGN 129540 - Entertainment System Status
- Playback state (playing/paused/stopped)
- Volume level
- Device status

#### PGN 129041 - Entertainment System Track Info
- Current track title
- Artist name
- Album name
- Track duration

#### Chartplotter Controls

Compatible chartplotters can control the audio system via NMEA2000:

- Volume up/down
- Playback control (play/pause/stop)
- Source selection

## API Reference

The plugin provides a REST API for programmatic control:

### Device Management

```bash
# Get discovered Sonos devices
GET /plugins/sonos-fusion/devices/sonos

# Get discovered Fusion devices
GET /plugins/sonos-fusion/devices/fusion
```

### Pair Management

```bash
# Get all device pairs
GET /plugins/sonos-fusion/pairs

# Create new device pair
POST /plugins/sonos-fusion/pairs
Content-Type: application/json
{
  "name": "Cockpit",
  "sonosDevice": "192.168.1.100:1400",
  "fusionDevice": "192.168.1.101:80",
  "fusionInput": "aux2",
  "volumeSync": true
}

# Update device pair
PATCH /plugins/sonos-fusion/pairs/{pairName}
Content-Type: application/json
{ "enabled": false }

# Delete device pair
DELETE /plugins/sonos-fusion/pairs/{pairName}

# Test device pair connection
POST /plugins/sonos-fusion/pairs/{pairName}/test
```

### System Information

```bash
# Get plugin status
GET /plugins/sonos-fusion/status

# Get system overview
GET /plugins/sonos-fusion/overview

# Get diagnostics
GET /plugins/sonos-fusion/diagnostics

# Export configuration
GET /plugins/sonos-fusion/export

# Import configuration
POST /plugins/sonos-fusion/import
Content-Type: application/json
{
  "devicePairs": [...]
}
```

## SignalK Data Paths

The plugin publishes data to the following SignalK paths:

### Audio System Status

```
vessels.self.entertainment.audio.{pairName}.status
vessels.self.entertainment.audio.{pairName}.playbackState
vessels.self.entertainment.audio.{pairName}.volume
```

### Current Track Information

```
vessels.self.entertainment.audio.{pairName}.currentTrack.title
vessels.self.entertainment.audio.{pairName}.currentTrack.artist
vessels.self.entertainment.audio.{pairName}.currentTrack.album
vessels.self.entertainment.audio.{pairName}.currentTrack.duration
```

## Troubleshooting

### Common Issues

#### Devices Not Discovered

1. **Network Connectivity**: Ensure all devices are on the same network segment
2. **Firewall**: Check that multicast traffic is allowed
3. **Device Compatibility**: Verify you have a Sonos Port (not other Sonos models)

#### Connection Failures

1. **Device IP Changes**: If devices get new IP addresses, re-discover them
2. **Fusion API**: Ensure Fusion device has API access enabled
3. **Port Conflicts**: Check for port conflicts on the Fusion device

#### Volume Sync Issues

1. **Timing**: Volume changes may have a small delay
2. **Range Differences**: Sonos (0-100) vs Fusion (0-40) ranges are automatically converted
3. **Disable Sync**: Turn off volume sync if experiencing issues

### Diagnostic Information

Use the diagnostics page in the web interface or API endpoint to get detailed system information:

```bash
curl http://your-signalk-server/plugins/sonos-fusion/diagnostics
```

### Log Files

Check SignalK server logs for plugin-specific messages:

```bash
tail -f /var/log/signalk/signalk.log | grep sonos-fusion
```

## Development

### Building from Source

```bash
git clone https://github.com/waterwanders/signalk-sonos-fusion-plugin.git
cd signalk-sonos-fusion-plugin
npm install
npm test
```

### Plugin Structure

```
signalk-sonos-fusion-plugin/
├── index.js                 # Main plugin entry point
├── lib/
│   ├── deviceManager.js     # Device pair management
│   ├── sonosController.js   # Sonos integration
│   ├── fusionController.js  # Fusion Audio integration
│   └── nmea2000Handler.js   # NMEA2000 integration
├── public/
│   ├── index.html          # Web interface
│   └── app.js              # Frontend JavaScript
└── package.json
```

### Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## Hardware Requirements

### Supported Devices

#### Sonos
- **Sonos Port** - Required for line output to Fusion amplifier

#### Fusion Audio
- Fusion MS-RA770 series
- Fusion MS-RA670 series
- Other Fusion amplifiers with network API support

### Wiring

Connect the Sonos Port line output to one of the Fusion amplifier's auxiliary inputs using appropriate marine-grade audio cables.

## License

MIT License - see LICENSE file for details

## Support

- **Issues**: Report bugs and feature requests on GitHub
- **Documentation**: Additional documentation available in the wiki
- **Community**: Join the SignalK community for support and discussion

## Changelog

### v1.0.0
- Initial release
- Sonos Port and Fusion Audio integration
- NMEA2000 support
- Web management interface
- Automatic device discovery
- Volume synchronization
