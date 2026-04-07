/**
 * Main Application Logic - Client-side KML Marker Generator
 * Replaces Flask backend with pure JavaScript
 */

// Global state
let map = null;
let pathLayer = null;
let markerLayers = [];
let uploadedCoords = null;
let currentOffset = 0;
let currentInterval = 60;
let parsedKmlData = null;
let isTreeView = true;

// DOM element references
const elements = {};

/**
 * Initialize the application
 */
document.addEventListener('DOMContentLoaded', () => {
    cacheElements();
    initMap();
    setupEventListeners();
    initializeDefaultValues();
});

/**
 * Cache DOM element references for better performance
 */
function cacheElements() {
    // Form elements
    elements.kmlForm = document.getElementById('kmlForm');
    elements.kmlFile = document.getElementById('kml_file');
    elements.interval = document.getElementById('interval');
    elements.offsetSlider = document.getElementById('offsetSlider');
    elements.offset = document.getElementById('offset');
    elements.offsetValue = document.getElementById('offsetValue');
    elements.markerLabel = document.getElementById('marker_label');
    elements.color = document.getElementById('color');
    elements.previewBtn = document.getElementById('previewBtn');
    elements.statusMessage = document.getElementById('statusMessage');
    elements.previewInfo = document.getElementById('previewInfo');
    elements.previewPoints = document.getElementById('previewPoints');
    elements.previewDistance = document.getElementById('previewDistance');
    elements.previewSuggested = document.getElementById('previewSuggested');

    // Map element
    elements.mapDiv = document.getElementById('map');

    // XML paste elements
    elements.pasteBtn = document.getElementById('pasteFromClipboardBtn');
    elements.xmlEditor = document.getElementById('xmlEditor');
    elements.xmlContent = document.getElementById('xmlContent');
    elements.parseStatus = document.getElementById('xmlParseStatus');
    elements.xmlPreview = document.getElementById('xmlPreview');
    elements.xmlTreeView = document.getElementById('xmlTreeView');
    elements.xmlRawView = document.getElementById('xmlRawView');
    elements.toggleTreeBtn = document.getElementById('toggleTreeView');
    elements.validationErrors = document.getElementById('xmlValidationErrors');
    elements.errorList = document.getElementById('errorList');
    elements.xmlActionButtons = document.getElementById('xmlActionButtons');
    elements.useXmlBtn = document.getElementById('useXmlDataBtn');
    elements.clearXmlBtn = document.getElementById('clearXmlBtn');
    elements.formatBtn = document.getElementById('formatXmlBtn');
    elements.xmlLoading = document.getElementById('xmlLoading');
}

/**
 * Initialize default values
 */
function initializeDefaultValues() {
    // Set initial offset display
    elements.offsetValue.textContent = elements.offset.value;
    currentOffset = parseFloat(elements.offset.value);
    currentInterval = parseFloat(elements.interval.value);

    // Initialize color dataset for KML conversion
    const initialColor = window.getComputedStyle(elements.color).value.replace('#', '');
    elements.color.dataset.kmlColor = hexToKmlColor(initialColor);
}

/**
 * Initialize Leaflet map
 */
function initMap() {
    map = L.map('map').setView([0, 0], 2);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
}

/**
 * Setup all event listeners
 */
function setupEventListeners() {
    // Color picker
    elements.color.addEventListener('change', function() {
        this.dataset.kmlColor = hexToKmlColor(this.value);
    });

    // Offset slider
    elements.offsetSlider.addEventListener('input', () => {
        const value = parseFloat(elements.offsetSlider.value);
        elements.offset.value = value;
        elements.offsetValue.textContent = value;
        currentOffset = value;
        updateMarkers();
    });

    // Offset number input
    elements.offset.addEventListener('change', () => {
        let value = parseFloat(elements.offset.value);
        // Clamp to slider range for display
        value = Math.max(-1000, Math.min(1000, value));
        elements.offsetSlider.value = Math.max(-100, Math.min(100, value));
        elements.offsetValue.textContent = value;
        currentOffset = value;
        updateMarkers();
    });

    // Interval input
    elements.interval.addEventListener('change', () => {
        currentInterval = parseFloat(elements.interval.value);
        if (uploadedCoords) {
            updateMarkers();
        }
    });

    // File upload
    elements.kmlFile.addEventListener('change', handleFileUpload);

    // Preview button
    elements.previewBtn.addEventListener('click', () => {
        if (!uploadedCoords) {
            showStatus('Please upload a KML file first', 'error');
            return;
        }
        showStatus('Path is displayed on the map', 'success');
    });

    // Form submission (Generate KML)
    elements.kmlForm.addEventListener('submit', handleFormSubmit);

    // Drag and drop
    setupDragAndDrop();

    // XML paste component
    setupXmlPasteComponent();
}

/**
 * Setup drag and drop functionality
 */
function setupDragAndDrop() {
    const form = elements.kmlForm;
    const fileInput = elements.kmlFile;

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        form.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    ['dragenter', 'dragover'].forEach(eventName => {
        form.addEventListener(eventName, () => form.classList.add('highlight'), false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        form.addEventListener(eventName, () => form.classList.remove('highlight'), false);
    });

    form.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files.length > 0) {
            fileInput.files = files;
            fileInput.dispatchEvent(new Event('change'));
        }
    }, false);
}

/**
 * Handle file upload
 */
async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    // Clear any pasted XML data when file is uploaded
    parsedKmlData = null;
    clearXmlBtn.click();

    try {
        const text = await file.text();
        uploadedCoords = extractLineStringCoordinates(text);
        displayPath(uploadedCoords);

        // Update preview info
        const stats = calculatePathStats(uploadedCoords);
        elements.previewPoints.textContent = stats.numPoints;
        elements.previewDistance.textContent = stats.totalDistanceMeters.toLocaleString();
        elements.previewSuggested.textContent = stats.suggestedMarkers;
        elements.previewInfo.style.display = 'block';

        // Initial marker generation
        currentInterval = parseFloat(elements.interval.value);
        currentOffset = parseFloat(elements.offset.value);
        updateMarkers();

        showStatus('KML file loaded successfully', 'success');
    } catch (error) {
        showStatus('Error loading KML: ' + error.message, 'error');
        console.error('File upload error:', error);
    }
}

/**
 * Update markers on the map based on current offset and interval
 */
function updateMarkers() {
    if (!uploadedCoords || uploadedCoords.length === 0) return;

    // Clear existing markers
    markerLayers.forEach(layer => map.removeLayer(layer));
    markerLayers = [];

    try {
        // Calculate marker positions using client-side processing
        const points = calculatePathPoints(uploadedCoords, currentInterval, currentOffset);

        // Add markers to map
        points.forEach(([lat, lon], i) => {
            const marker = L.circleMarker([lat, lon], {
                radius: 6,
                fillColor: 'red',
                color: 'darkred',
                weight: 1,
                opacity: 1,
                fillOpacity: 0.8
            }).addTo(map);

            marker.bindPopup(`Marker ${i + 1}<br>Lat: ${lat.toFixed(6)}<br>Lon: ${lon.toFixed(6)}`);
            markerLayers.push(marker);
        });
    } catch (error) {
        console.error('Error calculating markers:', error);
        showStatus('Error updating markers: ' + error.message, 'error');
    }
}

/**
 * Handle form submission - Generate and download KML
 */
async function handleFormSubmit(e) {
    e.preventDefault();

    if (!uploadedCoords && !(parsedKmlData && parsedKmlData.valid)) {
        showStatus('Please upload a KML file or paste XML data', 'error');
        return;
    }

    try {
        showStatus('Generating KML...', 'success');

        // Calculate markers
        const interval = parseFloat(elements.interval.value);
        const offset = parseFloat(elements.offset.value);
        const markerLabel = elements.markerLabel.value;
        const color = elements.color.dataset.kmlColor || hexToKmlColor(elements.color.value);

        // Generate marker points
        const points = calculatePathPoints(uploadedCoords || parsedKmlData.coords, interval, offset);

        // Create KML content
        const kmlContent = createKmlContent(points, markerLabel, color);

        // Download the file
        downloadKml(kmlContent, 'markers.kml');

        showStatus('KML file generated and downloaded!', 'success');
    } catch (error) {
        showStatus('Error generating KML: ' + error.message, 'error');
        console.error('Form submit error:', error);
    }
}

/**
 * Download KML file
 * @param {string} content - KML file content
 * @param {string} filename - Download filename
 */
function downloadKml(content, filename) {
    const blob = new Blob([content], { type: 'application/vnd.google-earth.kml+xml' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
}

/**
 * Display path on the map
 * @param {Array<[number, number, number]>} coords - Path coordinates
 */
function displayPath(coords) {
    if (pathLayer) {
        map.removeLayer(pathLayer);
    }

    const latlngs = coords.map(([lat, lon]) => [lat, lon]);
    pathLayer = L.polyline(latlngs, { color: 'blue', weight: 3 }).addTo(map);
    map.fitBounds(pathLayer.getBounds(), { padding: [50, 50] });
}

/**
 * Show status message
 * @param {string} message - Message text
 * @param {string} type - 'success' or 'error'
 */
function showStatus(message, type) {
    elements.statusMessage.textContent = message;
    elements.statusMessage.className = 'status-message ' + type;
    elements.statusMessage.style.display = 'block';

    setTimeout(() => {
        elements.statusMessage.style.display = 'none';
    }, 5000);
}

/**
 * Setup XML paste component functionality
 */
function setupXmlPasteComponent() {
    // Paste from clipboard
    elements.pasteBtn.addEventListener('click', async () => {
        showXmlLoading(true);

        try {
            const text = await navigator.clipboard.readText();
            if (!text.trim()) {
                throw new Error('Clipboard is empty');
            }

            elements.xmlContent.value = text;
            elements.xmlEditor.style.display = 'block';

            // Auto-parse after paste
            await parseAndValidateXml(text);
        } catch (err) {
            let errorMsg = 'Failed to access clipboard: ';
            if (err.name === 'NotAllowedError') {
                errorMsg = 'Clipboard access denied. Please enable clipboard permissions or paste manually using Ctrl+V.';
            } else if (err.name === 'NotFoundError') {
                errorMsg = 'No clipboard content found. Copy some KML/XML data first.';
            } else {
                errorMsg += err.message;
            }
            showParseStatus(errorMsg, 'error');
            hidePreview();
        } finally {
            showXmlLoading(false);
        }
    });

    // Format XML button
    elements.formatBtn.addEventListener('click', () => {
        const text = elements.xmlContent.value.trim();
        if (!text) return;

        try {
            const parser = new DOMParser();
            const xml = parser.parseFromString(text, 'text/xml');
            const serializer = new XMLSerializer();
            const formatted = formatXmlString(serializer.serializeToString(xml));
            elements.xmlContent.value = formatted;
            showParseStatus('XML formatted successfully', 'success');
        } catch (err) {
            showParseStatus('Failed to format XML: ' + err.message, 'error');
        }
    });

    // Toggle tree/raw view
    elements.toggleTreeBtn.addEventListener('click', () => {
        isTreeView = !isTreeView;
        if (isTreeView) {
            elements.xmlTreeView.style.display = 'block';
            elements.xmlRawView.style.display = 'none';
            elements.toggleTreeBtn.textContent = 'Toggle View';
        } else {
            elements.xmlTreeView.style.display = 'none';
            elements.xmlRawView.style.display = 'block';
            elements.toggleTreeBtn.textContent = 'Show Tree';
        }
    });

    // Clear button
    elements.clearXmlBtn.addEventListener('click', () => {
        elements.xmlContent.value = '';
        elements.xmlEditor.style.display = 'none';
        hidePreview();
        hideValidationErrors();
        elements.xmlActionButtons.style.display = 'none';
        parsedKmlData = null;
    });

    // Use XML data button
    elements.useXmlBtn.addEventListener('click', () => {
        if (!parsedKmlData || !parsedKmlData.valid) {
            showStatus('Cannot use invalid XML data', 'error');
            return;
        }

        // Clear file input to avoid confusion
        elements.kmlFile.value = '';
        uploadedCoords = null;

        // Load the coordinates into the application
        uploadedCoords = parsedKmlData.coords;
        displayPath(uploadedCoords);

        // Update preview info
        elements.previewPoints.textContent = parsedKmlData.num_points;
        elements.previewDistance.textContent = parsedKmlData.total_distance_meters.toLocaleString();
        elements.previewSuggested.textContent = parsedKmlData.suggested_markers;
        elements.previewInfo.style.display = 'block';

        // Calculate initial markers
        currentInterval = parseFloat(elements.interval.value);
        currentOffset = parseFloat(elements.offset.value);
        updateMarkers();

        showStatus('KML data loaded from clipboard successfully', 'success');
    });

    // Auto-paste on Ctrl+V in textarea
    elements.xmlContent.addEventListener('paste', (e) => {
        setTimeout(() => {
            parseAndValidateXml(elements.xmlContent.value);
        }, 100);
    });
}

/**
 * Parse and validate XML from pasted content
 * @param {string} xmlText - XML text to parse
 */
async function parseAndValidateXml(xmlText) {
    hideValidationErrors();
    hidePreview();
    elements.xmlActionButtons.style.display = 'none';

    try {
        const parser = new DOMParser();
        const xml = parser.parseFromString(xmlText, 'text/xml');

        // Check for parser errors
        const parseError = xml.querySelector('parsererror');
        if (parseError) {
            throw new Error('Invalid XML: ' + parseError.textContent);
        }

        // Validate KML structure
        const validation = validateKmlStructure(xml);

        if (validation.errors.length > 0) {
            displayValidationErrors(validation.errors);
            return;
        }

        // Extract coordinates
        const coords = extractCoordinatesFromXml(xml);

        if (coords.length < 2) {
            showParseStatus('Path must have at least 2 points', 'error');
            return;
        }

        // Calculate total distance
        const stats = calculatePathStats(coords);

        // Build parsed data object
        parsedKmlData = {
            valid: true,
            coords: coords,
            num_points: stats.numPoints,
            total_distance_meters: stats.totalDistanceMeters,
            suggested_markers: stats.suggestedMarkers,
            xml: xml
        };

        // Show preview
        displayXmlPreview(xml);
        showParseStatus(`Valid KML: ${coords.length} coordinates found`, 'success');
        elements.xmlActionButtons.style.display = 'flex';

    } catch (err) {
        showParseStatus('Parse error: ' + err.message, 'error');
    }
}

/**
 * Extract coordinates from parsed XML document
 * @param {Document} xml - Parsed XML document
 * @returns {Array<[number, number, number]>} Array of [lat, lon, alt]
 */
function extractCoordinatesFromXml(xml) {
    const linestring = xml.querySelector('LineString') ||
                       xml.querySelector(`${KML_NS}LineString`);

    if (!linestring) return [];

    const coordsElem = linestring.querySelector('coordinates') ||
                       linestring.querySelector(`${KML_NS}coordinates`);

    if (!coordsElem) return [];

    const coordsText = coordsElem.textContent.trim();
    const coords = [];
    const coordStrings = coordsText.split(/\s+/);

    for (const coordStr of coordStrings) {
        const parts = coordStr.split(',');
        if (parts.length >= 2) {
            const lon = parseFloat(parts[0]);
            const lat = parseFloat(parts[1]);
            if (!isNaN(lat) && !isNaN(lon)) {
                coords.push([lat, lon, 0]);
            }
        }
    }

    return coords;
}

/**
 * Display XML preview (tree view and raw XML)
 * @param {Document} xml - Parsed XML document
 */
function displayXmlPreview(xml) {
    // Show tree view
    elements.xmlTreeView.innerHTML = '';
    const tree = buildXmlTree(xml.documentElement);
    elements.xmlTreeView.appendChild(tree);

    // Show raw formatted XML
    const serializer = new XMLSerializer();
    const rawXml = serializer.serializeToString(xml);
    const formatted = formatXmlString(rawXml);
    elements.xmlRawView.innerHTML = '<pre>' + escapeHtml(formatted) + '</pre>';

    elements.xmlPreview.style.display = 'block';
}

/**
 * Build tree view of XML structure
 * @param {Element} element - XML element
 * @returns {HTMLElement} Tree view element
 */
function buildXmlTree(element) {
    const container = document.createElement('div');
    container.className = 'xml-node';

    const elementRow = document.createElement('div');
    elementRow.className = 'xml-element-row';

    const elementName = document.createElement('span');
    elementName.className = 'xml-element';
    elementName.textContent = `<${element.tagName}>`;
    elementRow.appendChild(elementName);

    // Add attributes
    if (element.hasAttributes()) {
        for (const attr of element.attributes) {
            const attrSpan = document.createElement('span');
            attrSpan.className = 'xml-attribute';
            attrSpan.textContent = ` ${attr.name}="${escapeHtml(attr.value)}"`;
            elementRow.appendChild(attrSpan);
        }
    }

    container.appendChild(elementRow);

    // Add text content if present and short
    const text = element.textContent?.trim();
    if (text && element.children.length === 0) {
        const textSpan = document.createElement('div');
        textSpan.className = 'xml-text';
        textSpan.style.marginLeft = '20px';
        textSpan.textContent = text.length > 100 ? text.substring(0, 100) + '...' : text;
        container.appendChild(textSpan);
    }

    // Process children
    const children = Array.from(element.children).filter(child =>
        child.tagName !== '#text' || child.textContent.trim()
    );

    children.forEach((child, index) => {
        const childNode = buildXmlTree(child);
        if (index === children.length - 1) {
            childNode.classList.add('last-child');
        }
        container.appendChild(childNode);
    });

    return container;
}

/**
 * Display validation errors
 * @param {Array<string>} errors - Array of error messages
 */
function displayValidationErrors(errors) {
    elements.errorList.innerHTML = '';
    errors.forEach(error => {
        const li = document.createElement('li');
        li.textContent = error;
        elements.errorList.appendChild(li);
    });
    elements.validationErrors.style.display = 'block';
    showParseStatus('Validation failed - see details below', 'error');
}

/**
 * Hide validation errors
 */
function hideValidationErrors() {
    elements.validationErrors.style.display = 'none';
}

/**
 * Show/hide parse status
 * @param {string} message - Status message
 * @param {string} type - 'success' or 'error'
 */
function showParseStatus(message, type) {
    elements.parseStatus.textContent = message;
    elements.parseStatus.className = 'xml-parse-status ' + type;
    elements.parseStatus.style.display = 'block';
}

/**
 * Hide XML preview
 */
function hidePreview() {
    elements.xmlPreview.style.display = 'none';
}

/**
 * Show/hide XML loading indicator
 * @param {boolean} show - Show or hide
 */
function showXmlLoading(show) {
    elements.xmlLoading.style.display = show ? 'flex' : 'none';
}