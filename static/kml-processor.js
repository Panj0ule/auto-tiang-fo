/**
 * KML Processor - JavaScript version of kml_processor.py
 * Handles KML parsing, path calculation, offset application, and KML generation
 */

const KML_NS = 'http://www.opengis.net/kml/2.2';

/**
 * Calculate the great circle distance between two points on Earth in meters.
 * @param {number} lat1 - Latitude of point 1 in degrees
 * @param {number} lon1 - Longitude of point 1 in degrees
 * @param {number} lat2 - Latitude of point 2 in degrees
 * @param {number} lon2 - Longitude of point 2 in degrees
 * @returns {number} Distance in meters
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth radius in meters

    const lat1Rad = toRad(lat1);
    const lat2Rad = toRad(lat2);
    const deltaLat = toRad(lat2 - lat1);
    const deltaLon = toRad(lon2 - lon1);

    const a = Math.sin(deltaLat / 2) ** 2 +
              Math.cos(lat1Rad) * Math.cos(lat2Rad) *
              Math.sin(deltaLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

/**
 * Convert degrees to radians
 * @param {number} deg - Angle in degrees
 * @returns {number} Angle in radians
 */
function toRad(deg) {
    return deg * (Math.PI / 180);
}

/**
 * Convert radians to degrees
 * @param {number} rad - Angle in radians
 * @returns {number} Angle in degrees
 */
function toDeg(rad) {
    return rad * (180 / Math.PI);
}

/**
 * Linearly interpolate between two coordinates
 * @param {number} lat1 - Starting latitude
 * @param {number} lon1 - Starting longitude
 * @param {number} lat2 - Ending latitude
 * @param {number} lon2 - Ending longitude
 * @param {number} fraction - Interpolation fraction (0-1)
 * @returns {[number, number]} Interpolated [lat, lon]
 */
function interpolatePoint(lat1, lon1, lat2, lon2, fraction) {
    return [
        lat1 + fraction * (lat2 - lat1),
        lon1 + fraction * (lon2 - lon1)
    ];
}

/**
 * Calculate the bearing from point 1 to point 2 in degrees
 * @param {number} lat1 - Starting latitude
 * @param {number} lon1 - Starting longitude
 * @param {number} lat2 - Ending latitude
 * @param {number} lon2 - Ending longitude
 * @returns {number} Bearing in degrees (0-360, clockwise from north)
 */
function calculateBearing(lat1, lon1, lat2, lon2) {
    const lat1Rad = toRad(lat1);
    const lat2Rad = toRad(lat2);
    const deltaLonRad = toRad(lon2 - lon1);

    const y = Math.sin(deltaLonRad) * Math.cos(lat2Rad);
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) -
              Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(deltaLonRad);

    let bearing = Math.atan2(y, x);
    bearing = toDeg(bearing);
    bearing = (bearing + 360) % 360;

    return bearing;
}

/**
 * Apply perpendicular offset to a point given the path bearing
 * @param {number} lat - Original latitude in degrees
 * @param {number} lon - Original longitude in degrees
 * @param {number} offsetMeters - Offset distance in meters (positive = right, negative = left)
 * @param {number} pathBearingDeg - Bearing of the path at this point in degrees
 * @returns {[number, number]} Offset coordinates [lat, lon]
 */
function applyOffsetWithBearing(lat, lon, offsetMeters, pathBearingDeg) {
    if (offsetMeters === 0) {
        return [lat, lon];
    }

    // Perpendicular bearing: right side = bearing + 90, left = bearing - 90
    let perpBearing = (pathBearingDeg + 90) % 360;
    let offsetAbs = Math.abs(offsetMeters);

    if (offsetMeters < 0) {
        // For left side, add 180 to reverse direction
        perpBearing = (perpBearing + 180) % 360;
    }

    // Convert offset to lat/lon delta
    const R = 6371000; // Earth radius in meters
    const perpBearingRad = toRad(perpBearing);

    // Calculate delta in radians
    const deltaLatRad = (offsetAbs / R) * Math.cos(perpBearingRad);
    const deltaLonRad = (offsetAbs / R) * Math.sin(perpBearingRad) / Math.cos(toRad(lat));

    const newLat = lat + toDeg(deltaLatRad);
    const newLon = lon + toDeg(deltaLonRad);

    return [newLat, newLon];
}

/**
 * Extract coordinates from a KML file content (as text)
 * @param {string} kmlText - KML file content as string
 * @returns {Array<[number, number, number]>} Array of [lat, lon, alt] tuples
 */
function extractLineStringCoordinates(kmlText) {
    const parser = new DOMParser();
    const xml = parser.parseFromString(kmlText, 'text/xml');

    // Check for parser errors
    const parseError = xml.querySelector('parsererror');
    if (parseError) {
        throw new Error('Invalid XML: ' + parseError.textContent);
    }

    // Find LineString element
    const linestring = xml.querySelector('LineString') ||
                       xml.querySelector(`${KML_NS}LineString`);

    if (!linestring) {
        throw new Error('No LineString found in KML file. Make sure the file contains a path/route.');
    }

    // Get coordinates element
    const coordsElem = linestring.querySelector('coordinates') ||
                       linestring.querySelector(`${KML_NS}coordinates`);

    if (!coordsElem || !coordsElem.textContent.trim()) {
        throw new Error('No coordinates found in LineString');
    }

    const coordsText = coordsElem.textContent.trim();
    const coords = [];
    const coordStrings = coordsText.split(/\s+/);

    for (const coordStr of coordStrings) {
        const parts = coordStr.split(',');
        if (parts.length >= 2) {
            const lon = parseFloat(parts[0]);
            const lat = parseFloat(parts[1]);
            const alt = parts.length > 2 ? parseFloat(parts[2]) : 0;

            if (!isNaN(lat) && !isNaN(lon)) {
                coords.push([lat, lon, alt]);
            }
        }
    }

    if (coords.length < 2) {
        throw new Error('Path must have at least 2 points');
    }

    return coords;
}

/**
 * Calculate marker positions along a path with optional offset
 * @param {Array<[number, number, number]>} coords - Path coordinates as [lat, lon, alt] tuples
 * @param {number} intervalMeters - Distance between markers in meters
 * @param {number} offsetMeters - Perpendicular offset in meters (positive = right, negative = left)
 * @returns {Array<[number, number, number]>} Marker positions
 */
function calculatePathPoints(coords, intervalMeters, offsetMeters = 0) {
    const points = [];
    let cumulativeDistance = 0;
    let lastPoint = coords[0];

    points.push(lastPoint); // Add the first point

    for (let i = 1; i < coords.length; i++) {
        const currentPoint = coords[i];

        // Calculate distance between last_point and current_point
        let segmentDistance = haversineDistance(
            lastPoint[0], lastPoint[1],
            currentPoint[0], currentPoint[1]
        );

        // If segment is very short, skip to next
        if (segmentDistance < 0.1) {
            lastPoint = currentPoint;
            continue;
        }

        // Calculate bearing of this segment
        let segmentBearing = calculateBearing(
            lastPoint[0], lastPoint[1],
            currentPoint[0], currentPoint[1]
        );

        // Check if we need to add points in this segment
        while (cumulativeDistance + segmentDistance >= intervalMeters) {
            // Calculate how far along this segment we need to go
            const remaining = intervalMeters - cumulativeDistance;
            const fraction = remaining / segmentDistance;

            // Interpolate the point
            let [newLat, newLon] = interpolatePoint(
                lastPoint[0], lastPoint[1],
                currentPoint[0], currentPoint[1],
                fraction
            );

            // Apply offset if specified
            if (offsetMeters !== 0) {
                [newLat, newLon] = applyOffsetWithBearing(
                    newLat, newLon, offsetMeters, segmentBearing
                );
            }

            points.push([newLat, newLon, 0]);

            // Update last_point to the new point
            lastPoint = [newLat, newLon, 0];
            cumulativeDistance = 0;

            // Recalculate remaining distance and bearing
            const remainingDistance = haversineDistance(
                lastPoint[0], lastPoint[1],
                currentPoint[0], currentPoint[1]
            );
            segmentDistance = remainingDistance;

            segmentBearing = calculateBearing(
                lastPoint[0], lastPoint[1],
                currentPoint[0], currentPoint[1]
            );
        }

        cumulativeDistance += segmentDistance;
        lastPoint = currentPoint;
    }

    return points;
}

/**
 * Create KML file content as string with placemarkers
 * @param {Array<[number, number, number]>} points - Marker positions as [lat, lon, alt]
 * @param {string} markerLabel - Prefix for marker names (e.g., 'TB')
 * @param {string} color - KML color in aabbggrr format (default: 'ff000000' for black)
 * @param {string} iconUrl - Icon URL (default: Google donut icon)
 * @returns {string} KML file content as string
 */
function createKmlContent(points, markerLabel = 'TB', color = 'ff000000', iconUrl = 'http://maps.google.com/mapfiles/kml/shapes/donut.png') {
    const kmlHeader = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Placemarkers</name>
    <Folder>
      <name>Markers</name>
      <Style id="donutStyle">
        <IconStyle>
          <Icon>
            <href>${iconUrl}</href>
          </Icon>
          <color>${color}</color>
          <scale>1.0</scale>
        </IconStyle>
        <LabelStyle>
          <color>ff000000</color>
          <scale>1.0</scale>
        </LabelStyle>
      </Style>`;

    const placemarkers = points.map(([lat, lon, alt], index) => {
        const markerNum = index + 1;
        return `
      <Placemark>
        <name>${markerLabel}${markerNum}</name>
        <description>Marker ${markerNum} at ${lat.toFixed(6)}, ${lon.toFixed(6)}</description>
        <styleUrl>#donutStyle</styleUrl>
        <Point>
          <coordinates>${lon.toFixed(6)},${lat.toFixed(6)},${alt.toFixed(2)}</coordinates>
        </Point>
      </Placemark>`;
    }).join('');

    const kmlFooter = `
    </Folder>
  </Document>
</kml>`;

    return kmlHeader + placemarkers + kmlFooter;
}

/**
 * Convert hex color to KML aabbggrr format
 * @param {string} hex - Hex color code (e.g., '#000000' or '000000')
 * @returns {string} KML color format (e.g., 'ff000000' for opaque black)
 */
function hexToKmlColor(hex) {
    hex = hex.replace('#', '');
    const r = hex.substring(0, 2);
    const g = hex.substring(2, 4);
    const b = hex.substring(4, 6);
    return 'ff' + b + g + r; // alpha + blue + green + red
}

/**
 * Reverse KML color to hex (for display purposes)
 * @param {string} kmlColor - KML color in aabbggrr format
 * @returns {string} Hex color with # prefix
 */
function kmlColorToHex(kmlColor) {
    if (kmlColor.length !== 8) {
        return '#000000';
    }
    // Extract components ignoring alpha (first 2 chars)
    const b = kmlColor.substring(2, 4);
    const g = kmlColor.substring(4, 6);
    const r = kmlColor.substring(6, 8);
    return `#${r}${g}${b}`;
}

/**
 * Calculate total path length and statistics
 * @param {Array<[number, number, number]>} coords - Path coordinates
 * @returns {Object} Statistics object
 */
function calculatePathStats(coords) {
    let totalDistance = 0;
    for (let i = 1; i < coords.length; i++) {
        totalDistance += haversineDistance(
            coords[i-1][0], coords[i-1][1],
            coords[i][0], coords[i][1]
        );
    }

    return {
        numPoints: coords.length,
        totalDistanceMeters: totalDistance,
        suggestedMarkers: Math.floor(totalDistance / 60) // based on 60m default
    };
}

/**
 * Validate KML structure
 * @param {Document} xml - Parsed XML document
 * @returns {Object} Validation result with valid boolean and errors array
 */
function validateKmlStructure(xml) {
    const errors = [];

    if (!xml.documentElement) {
        errors.push('Empty or invalid XML document');
        return { valid: false, errors };
    }

    // Check if it's KML
    const kmlElement = xml.documentElement;
    if (kmlElement.tagName !== 'kml' &&
        !kmlElement.tagName.includes('kml') &&
        kmlElement.namespaceURI !== KML_NS) {
        errors.push('Document does not appear to be a valid KML file (missing KML namespace)');
    }

    // Find Document
    const document = kmlElement.querySelector('Document') ||
                     kmlElement.querySelector(`${KML_NS}Document`);

    if (!document) {
        errors.push('KML file missing Document element');
    }

    // Find LineString
    const linestring = xml.querySelector('LineString') ||
                       xml.querySelector(`${KML_NS}LineString`);

    if (!linestring) {
        errors.push('No LineString found in KML file. Make sure the file contains a path/route.');
    } else {
        // Check coordinates element
        const coordsElem = linestring.querySelector('coordinates') ||
                          linestring.querySelector(`${KML_NS}coordinates`);

        if (!coordsElem || !coordsElem.textContent.trim()) {
            errors.push('LineString has no coordinates data');
        }
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Format an XML string for display
 * @param {string} xmlString - Raw XML string
 * @returns {string} Formatted XML with indentation
 */
function formatXmlString(xmlString) {
    let formatted = '';
    let indent = '';
    const lines = xmlString.split(/(?<=>)(?=<)/);

    for (let line of lines) {
        if (line.match(/^<\w/)) {
            // Opening tag
            formatted += indent + line + '\n';
            indent += '  ';
        } else if (line.match(/^<\/\w/)) {
            // Closing tag
            indent = indent.substring(2);
            formatted += indent + line + '\n';
        } else if (line.match(/^<\?xml/) || line.match(/^<!DOCTYPE/)) {
            // Declaration/Doctype (no indent)
            formatted += line + '\n';
        } else {
            // Content or self-closing tag
            if (line.trim().endsWith('/>')) {
                formatted += indent + line + '\n';
            } else if (line.trim().startsWith('</')) {
                indent = indent.substring(2);
                formatted += indent + line + '\n';
            } else {
                formatted += indent + line + '\n';
            }
        }
    }

    return formatted.trim();
}

/**
 * Escape HTML for safe display
 * @param {string} text - Text to escape
 * @returns {string} Escaped HTML
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Export for use in other modules (if using module system)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        haversineDistance,
        toRad,
        toDeg,
        interpolatePoint,
        calculateBearing,
        applyOffsetWithBearing,
        extractLineStringCoordinates,
        calculatePathPoints,
        createKmlContent,
        hexToKmlColor,
        kmlColorToHex,
        calculatePathStats,
        validateKmlStructure,
        formatXmlString,
        escapeHtml
    };
}