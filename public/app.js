class SonosFusionUI {
    constructor() {
        this.baseUrl = '/plugins/signalk-sonos-fusion-plugin';
        this.init();
    }

    async init() {
        await this.loadStatus();
        await this.loadData();
        this.setupEventListeners();
        this.startPolling();
    }

    setupEventListeners() {
        document.getElementById('addPairForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.addPair();
        });
    }

    startPolling() {
        setInterval(() => {
            this.loadStatus();
            this.loadData();
        }, 5000);
    }

    async loadStatus() {
        try {
            const response = await fetch(`${this.baseUrl}/status`);
            const status = await response.json();

            const statusIndicator = document.getElementById('pluginStatus');
            const statusText = document.getElementById('pluginStatusText');
            const statusDetails = document.getElementById('pluginDetails');

            if (status.enabled) {
                statusIndicator.className = 'status-indicator status-online';
                statusText.textContent = 'Online';
                statusDetails.textContent = `Active pairs: ${status.activePairs || 0}`;
            } else {
                statusIndicator.className = 'status-indicator status-offline';
                statusText.textContent = 'Offline';
                statusDetails.textContent = status.error || 'Plugin is disabled';
            }
        } catch (error) {
            console.error('Failed to load status:', error);
            document.getElementById('pluginStatus').className = 'status-indicator status-offline';
            document.getElementById('pluginStatusText').textContent = 'Error';
        }
    }

    async loadData() {
        await Promise.all([
            this.loadDevices(),
            this.loadPairs(),
            this.loadOverview()
        ]);
    }

    async loadDevices() {
        try {
            const [sonosResponse, fusionResponse] = await Promise.all([
                fetch(`${this.baseUrl}/devices/sonos`),
                fetch(`${this.baseUrl}/devices/fusion`)
            ]);

            const sonosDevices = await sonosResponse.json();
            const fusionDevices = await fusionResponse.json();

            this.renderDevices('sonosDeviceList', sonosDevices, 'sonos');
            this.renderDevices('fusionDeviceList', fusionDevices, 'fusion');

            this.populateDeviceSelectors(sonosDevices, fusionDevices);
        } catch (error) {
            console.error('Failed to load devices:', error);
        }
    }

    renderDevices(containerId, devices, type) {
        const container = document.getElementById(containerId);
        container.innerHTML = '';

        devices.forEach(device => {
            const card = document.createElement('div');
            card.className = `device-card ${device.online ? 'online' : 'offline'}`;
            card.innerHTML = `
                <h5>${device.name || device.id}</h5>
                <p><strong>ID:</strong> ${device.id}</p>
                <p><strong>Host:</strong> ${device.host}</p>
                ${device.port ? `<p><strong>Port:</strong> ${device.port}</p>` : ''}
                <p><strong>Status:</strong> ${device.online ? 'Online' : 'Offline'}</p>
                ${device.lastSeen ? `<p><strong>Last Seen:</strong> ${new Date(device.lastSeen).toLocaleString()}</p>` : ''}
            `;
            container.appendChild(card);
        });

        if (devices.length === 0) {
            container.innerHTML = `<p>No ${type} devices discovered</p>`;
        }
    }

    populateDeviceSelectors(sonosDevices, fusionDevices) {
        const sonosSelect = document.getElementById('sonosDevice');
        const fusionSelect = document.getElementById('fusionDevice');

        sonosSelect.innerHTML = '<option value="">Select Sonos Device</option>';
        fusionSelect.innerHTML = '<option value="">Select Fusion Device</option>';

        sonosDevices.forEach(device => {
            const option = document.createElement('option');
            option.value = device.id;
            option.textContent = `${device.name || device.id} (${device.host})`;
            sonosSelect.appendChild(option);
        });

        fusionDevices.forEach(device => {
            const option = document.createElement('option');
            option.value = device.id;
            option.textContent = `${device.name || device.id} (${device.host})`;
            fusionSelect.appendChild(option);
        });
    }

    async loadPairs() {
        try {
            const response = await fetch(`${this.baseUrl}/pairs`);
            const pairs = await response.json();

            this.renderPairs(pairs);
        } catch (error) {
            console.error('Failed to load pairs:', error);
        }
    }

    renderPairs(pairs) {
        const container = document.getElementById('pairsList');
        container.innerHTML = '';

        pairs.forEach(pair => {
            const card = document.createElement('div');
            card.className = `pair-card ${pair.enabled ? 'enabled' : 'disabled'}`;
            card.innerHTML = `
                <h5>${pair.name}</h5>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 15px;">
                    <div>
                        <p><strong>Sonos Device:</strong> ${pair.sonosDevice}</p>
                        <p><strong>Fusion Device:</strong> ${pair.fusionDevice}</p>
                    </div>
                    <div>
                        <p><strong>Fusion Input:</strong> ${pair.fusionInput.toUpperCase()}</p>
                        <p><strong>Volume Sync:</strong> ${pair.volumeSync ? 'Yes' : 'No'}</p>
                        <p><strong>Status:</strong> ${pair.enabled ? 'Enabled' : 'Disabled'}</p>
                    </div>
                </div>
                ${pair.lastActivity ? `
                    <p><strong>Last Activity:</strong> ${new Date(pair.lastActivity.timestamp).toLocaleString()}</p>
                    <p><strong>Activity Type:</strong> ${pair.lastActivity.type}</p>
                ` : ''}
                <div class="controls">
                    <button class="btn ${pair.enabled ? 'btn-secondary' : 'btn-success'}"
                            onclick="togglePair('${pair.name}', ${!pair.enabled})">
                        ${pair.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button class="btn btn-primary" onclick="testPair('${pair.name}')">Test</button>
                    <button class="btn btn-danger" onclick="deletePair('${pair.name}')">Delete</button>
                </div>
            `;
            container.appendChild(card);
        });

        if (pairs.length === 0) {
            container.innerHTML = '<p>No device pairs configured</p>';
        }
    }

    async loadOverview() {
        try {
            const response = await fetch(`${this.baseUrl}/overview`);
            const overview = await response.json();

            this.renderOverview(overview);
        } catch (error) {
            console.error('Failed to load overview:', error);
        }
    }

    renderOverview(overview) {
        const statsContainer = document.getElementById('overviewStats');
        const activityContainer = document.getElementById('recentActivity');

        statsContainer.innerHTML = `
            <div class="device-grid">
                <div class="device-card">
                    <h5>Device Pairs</h5>
                    <p>Total: ${overview.stats.totalPairs}</p>
                    <p>Enabled: ${overview.stats.enabledPairs}</p>
                    <p>Active: ${overview.stats.activePairs}</p>
                </div>
                <div class="device-card">
                    <h5>Devices</h5>
                    <p>Sonos: ${overview.sonosDevices || 0}</p>
                    <p>Fusion: ${overview.fusionDevices || 0}</p>
                </div>
            </div>
        `;

        if (overview.stats.recentActivity.length > 0) {
            activityContainer.innerHTML = `
                <h4>Recent Activity</h4>
                <div style="max-height: 300px; overflow-y: auto;">
                    ${overview.stats.recentActivity.map(activity => `
                        <div style="padding: 10px; border-bottom: 1px solid #eee;">
                            <strong>${activity.pairName}</strong> - ${activity.type}
                            <br><small>${new Date(activity.timestamp).toLocaleString()}</small>
                        </div>
                    `).join('')}
                </div>
            `;
        } else {
            activityContainer.innerHTML = '<h4>Recent Activity</h4><p>No recent activity</p>';
        }
    }

    async addPair() {
        const formData = {
            name: document.getElementById('pairName').value,
            sonosDevice: document.getElementById('sonosDevice').value,
            fusionDevice: document.getElementById('fusionDevice').value,
            fusionInput: document.getElementById('fusionInput').value,
            volumeSync: document.getElementById('volumeSync').checked,
            enabled: true
        };

        try {
            const response = await fetch(`${this.baseUrl}/pairs`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });

            if (response.ok) {
                this.closeModal('addPairModal');
                document.getElementById('addPairForm').reset();
                await this.loadPairs();
            } else {
                const error = await response.text();
                alert(`Failed to add pair: ${error}`);
            }
        } catch (error) {
            console.error('Failed to add pair:', error);
            alert('Failed to add pair');
        }
    }

    showTab(tabName) {
        document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

        document.querySelector(`[onclick="showTab('${tabName}')"]`).classList.add('active');
        document.getElementById(tabName).classList.add('active');
    }

    showAddPairModal() {
        document.getElementById('addPairModal').style.display = 'block';
    }

    showImportModal() {
        document.getElementById('importModal').style.display = 'block';
    }

    closeModal(modalId) {
        document.getElementById(modalId).style.display = 'none';
    }

    async refreshDevices() {
        await this.loadDevices();
    }

    async refreshDiagnostics() {
        try {
            const response = await fetch(`${this.baseUrl}/diagnostics`);
            const diagnostics = await response.json();

            document.getElementById('diagnosticsData').textContent = JSON.stringify(diagnostics, null, 2);
        } catch (error) {
            console.error('Failed to load diagnostics:', error);
        }
    }

    async exportConfig() {
        try {
            const response = await fetch(`${this.baseUrl}/export`);
            const config = await response.json();

            const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'sonos-fusion-config.json';
            a.click();
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Failed to export config:', error);
            alert('Failed to export configuration');
        }
    }

    async importConfig() {
        const data = document.getElementById('importData').value;

        try {
            const config = JSON.parse(data);

            const response = await fetch(`${this.baseUrl}/import`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
            });

            if (response.ok) {
                this.closeModal('importModal');
                document.getElementById('importData').value = '';
                await this.loadData();
                alert('Configuration imported successfully');
            } else {
                const error = await response.text();
                alert(`Failed to import config: ${error}`);
            }
        } catch (error) {
            console.error('Failed to import config:', error);
            alert('Invalid JSON format');
        }
    }
}

// Global functions for button callbacks
async function togglePair(pairName, enabled) {
    try {
        const response = await fetch(`/plugins/signalk-sonos-fusion-plugin/pairs/${pairName}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled })
        });

        if (response.ok) {
            window.ui.loadPairs();
        } else {
            alert('Failed to toggle pair');
        }
    } catch (error) {
        console.error('Failed to toggle pair:', error);
        alert('Failed to toggle pair');
    }
}

async function testPair(pairName) {
    try {
        const response = await fetch(`/plugins/signalk-sonos-fusion-plugin/pairs/${pairName}/test`, {
            method: 'POST'
        });

        const result = await response.json();
        alert(`Test result: ${result.success ? 'Success' : 'Failed - ' + result.error}`);
    } catch (error) {
        console.error('Failed to test pair:', error);
        alert('Failed to test pair');
    }
}

async function deletePair(pairName) {
    if (!confirm(`Are you sure you want to delete pair "${pairName}"?`)) {
        return;
    }

    try {
        const response = await fetch(`/plugins/signalk-sonos-fusion-plugin/pairs/${pairName}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            window.ui.loadPairs();
        } else {
            alert('Failed to delete pair');
        }
    } catch (error) {
        console.error('Failed to delete pair:', error);
        alert('Failed to delete pair');
    }
}

function showTab(tabName) {
    window.ui.showTab(tabName);
}

function showAddPairModal() {
    window.ui.showAddPairModal();
}

function showImportModal() {
    window.ui.showImportModal();
}

function closeModal(modalId) {
    window.ui.closeModal(modalId);
}

function refreshDevices() {
    window.ui.refreshDevices();
}

function refreshDiagnostics() {
    window.ui.refreshDiagnostics();
}

function exportConfig() {
    window.ui.exportConfig();
}

function importConfig() {
    window.ui.importConfig();
}

// Initialize the UI when the page loads
document.addEventListener('DOMContentLoaded', () => {
    window.ui = new SonosFusionUI();
});