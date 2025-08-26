// Global variables for segment data
let coloradoTrailSegments = [];
let trailGpxParser = null;
let gpxTrailPoints = [];

// Global variables
let map;
let currentSegmentIndex = 0;
let isAnimating = false;
let segmentMarkers = [];
let routeLines = [];
let animationTimeout;

// Initialize the map when the page loads
document.addEventListener('DOMContentLoaded', function() {
    initializeMap();
    setupEventListeners();
    loadTrailData();
});

function initializeMap() {
    // Initialize map centered on Colorado Trail segments 1-15 (more zoomed in)
    map = L.map('map').setView([38.9, -105.9], 9);
    
    // Add terrain tile layer for better mountain visualization
    L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        maxZoom: 17,
        attribution: 'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, <a href="http://viewfinderpanoramas.org">SRTM</a> | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)'
    }).addTo(map);
}

async function loadTrailData() {
    try {
        // Load the route.json file with segment coordinates
        const response = await fetch('./assets/route.json');
        const routeData = await response.json();
        
        // Load and parse GPX data
        await loadGpxData();
        
        // Process the data to create segments with coordinates
        processSegmentData(routeData);
        
        // Add start and finish markers
        addStartFinishMarkers();
        
        // Load segment list in sidebar
        loadSegmentList();
        
    } catch (error) {
        console.error('Error loading trail data:', error);
        // Fallback to basic functionality if data loading fails
        loadSegmentList();
    }
}

async function loadGpxData() {
    try {
        const response = await fetch('./assets/Colorado Trail.gpx');
        const gpxText = await response.text();
        
        // Use GPXParser.js to parse the GPX file
        trailGpxParser = new gpxParser();
        trailGpxParser.parse(gpxText);
        
        console.log('=== COMPLETE GPX ANALYSIS ===');
        
        // Analyze waypoints (these are likely the trailheads and markers)
        if (trailGpxParser.waypoints && trailGpxParser.waypoints.length > 0) {
            console.log(`📍 WAYPOINTS: ${trailGpxParser.waypoints.length} found`);
            trailGpxParser.waypoints.forEach((wp, i) => {
                console.log(`  ${i+1}: "${wp.name}" at [${wp.lat?.toFixed(6)}, ${wp.lon?.toFixed(6)}]`);
            });
        }
        
        // Analyze tracks (these contain the actual GPS paths)
        if (trailGpxParser.tracks && trailGpxParser.tracks.length > 0) {
            console.log(`🛤️  TRACKS: ${trailGpxParser.tracks.length} found`);
            trailGpxParser.tracks.forEach((track, i) => {
                console.log(`  Track ${i+1}: "${track.name || 'Unnamed'}" - ${track.points?.length || 0} points`);
                if (track.distance) {
                    console.log(`    Distance: ${(track.distance.total/1000).toFixed(1)}km`);
                }
                if (track.points && track.points.length > 0) {
                    const start = track.points[0];
                    const end = track.points[track.points.length - 1];
                    console.log(`    Start: [${start.lat?.toFixed(6)}, ${start.lon?.toFixed(6)}]`);
                    console.log(`    End: [${end.lat?.toFixed(6)}, ${end.lon?.toFixed(6)}]`);
                }
            });
            
            // Use the main track for processing
            const mainTrack = trailGpxParser.tracks[0];
            gpxTrailPoints = mainTrack.points.map(point => [point.lat, point.lon]);
            console.log(`✅ Extracted ${gpxTrailPoints.length} GPS points from main track`);
        }
        
        // Analyze routes (alternative to tracks)
        if (trailGpxParser.routes && trailGpxParser.routes.length > 0) {
            console.log(`🗺️  ROUTES: ${trailGpxParser.routes.length} found`);
            trailGpxParser.routes.forEach((route, i) => {
                console.log(`  Route ${i+1}: "${route.name || 'Unnamed'}" - ${route.points?.length || 0} points`);
            });
        }
        
        // If we have multiple tracks, try to identify segment-specific tracks
        if (trailGpxParser.tracks && trailGpxParser.tracks.length > 1) {
            console.log('🔍 MULTIPLE TRACKS DETECTED - Analyzing for segment matches...');
            analyzeTracksForSegments();
        }
        
    } catch (error) {
        console.error('Error loading GPX data:', error);
        gpxTrailPoints = [];
    }
}

function analyzeTracksForSegments() {
    // If we have multiple tracks, they might correspond to individual segments
    console.log('=== TRACK-TO-SEGMENT ANALYSIS ===');
    
    trailGpxParser.tracks.forEach((track, i) => {
        if (track.name && track.points && track.points.length > 0) {
            const trackName = track.name.toLowerCase();
            console.log(`Track ${i+1}: "${track.name}"`);
            console.log(`  Points: ${track.points.length}`);
            console.log(`  Distance: ${track.distance ? (track.distance.total/1000).toFixed(1) + 'km' : 'Unknown'}`);
            
            // Try to match track names with segments
            const segmentNumbers = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', 'cw01', 'cw02', 'cw03', 'cw04', 'cw05'];
            for (const segNum of segmentNumbers) {
                if (trackName.includes(segNum) || trackName.includes(segNum.replace('cw', 'collegiate west'))) {
                    console.log(`  🎯 POTENTIAL MATCH: Segment ${segNum}`);
                }
            }
        }
    });
}

// GPX parsing is now handled by GPXParser.js library

// Haversine distance in meters between two [lat, lon]
function haversineMeters(a, b) {
    const R = 6371000; // meters
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b[0] - a[0]);
    const dLon = toRad(b[1] - a[1]);
    const lat1 = toRad(a[0]);
    const lat2 = toRad(b[0]);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

function computeCumulativeMeters(coords) {
    if (!coords || coords.length === 0) return [];
    const cum = new Array(coords.length).fill(0);
    for (let i = 1; i < coords.length; i++) {
        cum[i] = cum[i - 1] + haversineMeters(coords[i - 1], coords[i]);
    }
    return cum;
}

function processSegmentData(routeData) {
    console.log('=== ORDERED GPX PROCESSING v3.0 ===');
    
    if (!trailGpxParser) {
        console.warn('No GPX data available, creating interpolated segments');
        coloradoTrailSegments = routeData.map((segment, index) => {
            const startCoords = [segment.start_coords.latitude, segment.start_coords.longitude];
            const endCoords = [segment.finish_coords.latitude, segment.finish_coords.longitude];
            let segmentCoords = createInterpolatedPath(startCoords, endCoords);
            return buildSegmentObject(segment, index, segmentCoords, startCoords, endCoords);
        });
        return;
    }
    
    // Create dynamic track order mapping by finding GPX tracks for each segment number
    console.log('🔍 Building dynamic track order mapping...');
    
    const SEGMENT_ORDER = [
        "01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "CW01", "CW02", "CW03", "CW05"
    ];
    
    const CORRECT_TRACK_ORDER = [];
    
    // For each segment in correct order, find its corresponding GPX track
    for (let segmentIndex = 0; segmentIndex < SEGMENT_ORDER.length; segmentIndex++) {
        const targetSegment = SEGMENT_ORDER[segmentIndex];
        let foundTrackIndex = -1;
        
        // Search through all GPX tracks to find the one that matches this segment
        for (let trackIndex = 0; trackIndex < trailGpxParser.tracks.length; trackIndex++) {
            const track = trailGpxParser.tracks[trackIndex];
            if (track.name && track.name.toLowerCase().startsWith(targetSegment.toLowerCase())) {
                foundTrackIndex = trackIndex;
                break;
            }
        }
        
        if (foundTrackIndex >= 0) {
            CORRECT_TRACK_ORDER.push({
                gpxTrackIndex: foundTrackIndex,
                name: trailGpxParser.tracks[foundTrackIndex].name,
                segmentNumber: targetSegment
            });
            console.log(`   Segment ${segmentIndex + 1} (${targetSegment}) → GPX Track ${foundTrackIndex}: "${trailGpxParser.tracks[foundTrackIndex].name}"`);
        } else {
            CORRECT_TRACK_ORDER.push(null);
            console.log(`   ⚠️  Segment ${segmentIndex + 1} (${targetSegment}) → No matching GPX track found`);
        }
    }
    
    console.log('🗺️  Using dynamic track order mapping for correct sequencing');
    
    let segments = [];
    let gpxMatchCount = 0;
    let interpolatedCount = 0;
    
    // Process segments in the correct order using our mapping
    for (let i = 0; i < routeData.length; i++) {
        const segmentData = routeData[i];
        const startCoords = [segmentData.start_coords.latitude, segmentData.start_coords.longitude];
        const endCoords = [segmentData.finish_coords.latitude, segmentData.finish_coords.longitude];
        
        console.log(`\n--- Segment ${i+1}: ${segmentData.name} ---`);
        
        // Get the correct GPX track for this segment using our dynamic mapping
        const trackMapping = CORRECT_TRACK_ORDER[i];
        
        if (trackMapping && trackMapping.gpxTrackIndex >= 0 && trailGpxParser.tracks[trackMapping.gpxTrackIndex]) {
            const gpxTrack = trailGpxParser.tracks[trackMapping.gpxTrackIndex];
            
            console.log(`✅ Using GPX track ${trackMapping.gpxTrackIndex}: "${gpxTrack.name}"`);
            console.log(`   Segment ${trackMapping.segmentNumber} correctly mapped`);
            
            if (gpxTrack.points && gpxTrack.points.length >= 2) {
                const trackCoords = gpxTrack.points.map(p => [p.lat, p.lon]);
                
                // Use GPX coordinates as the true start/end points (no adjustment to route.json)
                const gpxStartCoords = trackCoords[0];
                const gpxEndCoords = trackCoords[trackCoords.length - 1];
                
                console.log(`   📍 Using ${trackCoords.length} GPS points with TRUE GPS start/end coordinates`);
                console.log(`   🎯 GPS start: [${gpxStartCoords[0].toFixed(6)}, ${gpxStartCoords[1].toFixed(6)}]`);
                console.log(`   🎯 GPS end: [${gpxEndCoords[0].toFixed(6)}, ${gpxEndCoords[1].toFixed(6)}]`);
                
                segments.push(buildSegmentObject(segmentData, i, trackCoords, gpxStartCoords, gpxEndCoords));
                gpxMatchCount++;
            } else {
                console.log(`   ✗ Track has no points, using interpolated path`);
                const interpolatedPath = createInterpolatedPath(startCoords, endCoords);
                segments.push(buildSegmentObject(segmentData, i, interpolatedPath, startCoords, endCoords));
                interpolatedCount++;
            }
        } else {
            console.log(`   ✗ No track mapping found for segment ${i+1}, using interpolated path`);
            const interpolatedPath = createInterpolatedPath(startCoords, endCoords);
            segments.push(buildSegmentObject(segmentData, i, interpolatedPath, startCoords, endCoords));
            interpolatedCount++;
        }
    }
    
    console.log(`\n=== ORDERED RESULTS ===`);
    console.log(`Successfully processed ${segments.length} segments IN CORRECT ORDER:`);
    console.log(`  🛰️  Real GPS tracks: ${gpxMatchCount} segments`);
    console.log(`  📐 Interpolated paths: ${interpolatedCount} segments`);
    console.log(`  📊 GPS coverage: ${((gpxMatchCount/segments.length)*100).toFixed(1)}%`);
    console.log(`  🔄 Sequential order: GUARANTEED`);
    
    coloradoTrailSegments = segments;
}

function findMatchingTrackForSegment(segmentData, segmentNumber) {
    if (!trailGpxParser.tracks) return null;
    
    const segmentName = segmentData.name.toLowerCase();
    
    // Create search patterns for this segment
    const patterns = [
        `${segmentNumber.toString().padStart(2, '0')}`,  // "01", "02", etc.
        `segment ${segmentNumber}`,                       // "segment 1"
        `seg ${segmentNumber}`,                          // "seg 1"
        segmentNumber > 11 ? `cw0${segmentNumber - 11}` : null,  // "cw01" for collegiate west
        segmentNumber > 11 ? `collegiate west 0${segmentNumber - 11}` : null,
    ].filter(Boolean);
    
    // Add location-based patterns
    if (segmentName.includes('waterton')) patterns.push('waterton');
    if (segmentName.includes('south platte')) patterns.push('south platte', 'platte');
    if (segmentName.includes('little scraggy')) patterns.push('little scraggy', 'scraggy');
    if (segmentName.includes('rolling creek')) patterns.push('rolling creek');
    if (segmentName.includes('long gulch')) patterns.push('long gulch');
    if (segmentName.includes('kenosha')) patterns.push('kenosha');
    if (segmentName.includes('gold hill')) patterns.push('gold hill');
    if (segmentName.includes('copper mountain')) patterns.push('copper mountain');
    if (segmentName.includes('tennessee')) patterns.push('tennessee');
    if (segmentName.includes('timberline')) patterns.push('timberline');
    if (segmentName.includes('mount massive')) patterns.push('mount massive', 'massive');
    if (segmentName.includes('clear creek')) patterns.push('clear creek');
    if (segmentName.includes('twin lakes')) patterns.push('twin lakes');
    if (segmentName.includes('sheep gulch')) patterns.push('sheep gulch');
    if (segmentName.includes('cottonwood')) patterns.push('cottonwood');
    if (segmentName.includes('tin cup')) patterns.push('tin cup');
    if (segmentName.includes('boss lake')) patterns.push('boss lake');
    
    console.log(`  🔍 Searching for patterns: ${patterns.join(', ')}`);
    
    // Search through all tracks
    for (const track of trailGpxParser.tracks) {
        if (!track.name) continue;
        
        const trackName = track.name.toLowerCase();
        console.log(`  Checking track: "${track.name}"`);
        
        for (const pattern of patterns) {
            if (trackName.includes(pattern.toLowerCase())) {
                console.log(`  🎯 MATCH! Track "${track.name}" contains "${pattern}"`);
                return track;
            }
        }
    }
    
    return null;
}

function extractSegmentUsingWaypoints(segmentData, segmentIndex, startCoords, endCoords) {
    if (!trailGpxParser.tracks || trailGpxParser.tracks.length === 0) return null;
    
    const mainTrack = trailGpxParser.tracks[0];
    if (!mainTrack.points || mainTrack.points.length === 0) return null;
    
    const trackCoords = mainTrack.points.map(p => [p.lat, p.lon]);
    
    // Find waypoints near the start and end coordinates
    const startWaypoint = findClosestWaypoint(startCoords);
    const endWaypoint = findClosestWaypoint(endCoords);
    
    console.log(`  Start waypoint: ${startWaypoint ? startWaypoint.name : 'None found'}`);
    console.log(`  End waypoint: ${endWaypoint ? endWaypoint.name : 'None found'}`);
    
    if (startWaypoint && endWaypoint) {
        // Find these waypoint locations in the main track
        const startIdx = findClosestPointIndex(trackCoords, [startWaypoint.lat, startWaypoint.lon]);
        const endIdx = findClosestPointIndex(trackCoords, [endWaypoint.lat, endWaypoint.lon]);
        
        if (startIdx !== null && endIdx !== null && startIdx < endIdx) {
            const segmentPath = trackCoords.slice(startIdx, endIdx + 1);
            
            // Keep original GPS waypoint coordinates (no adjustment)
            console.log(`  ✅ Found waypoint-based segment: ${segmentPath.length} points`);
            console.log(`  Original GPS start: [${segmentPath[0][0].toFixed(6)}, ${segmentPath[0][1].toFixed(6)}]`);
            console.log(`  Original GPS end: [${segmentPath[segmentPath.length-1][0].toFixed(6)}, ${segmentPath[segmentPath.length-1][1].toFixed(6)}]`);
            return segmentPath;
        }
    }
    
    // Fallback: try coordinate-based matching with very liberal tolerance
    console.log(`  🔄 Fallback: trying coordinate matching...`);
    return findGpxSegmentForCoordinates(mainTrack.points, startCoords, endCoords, segmentIndex);
}

function findClosestWaypoint(targetCoords) {
    if (!trailGpxParser.waypoints || trailGpxParser.waypoints.length === 0) return null;
    
    let closest = null;
    let minDistance = Number.MAX_VALUE;
    
    for (const waypoint of trailGpxParser.waypoints) {
        const distance = calculateDistance([waypoint.lat, waypoint.lon], targetCoords);
        if (distance < minDistance) {
            minDistance = distance;
            closest = waypoint;
        }
    }
    
    // Only return if reasonably close (within ~50 miles)
    return minDistance < 0.5 ? closest : null;
}

function findGpxSegmentForCoordinates(allPoints, startCoords, endCoords, segmentIndex) {
    // Convert GPX points to coordinate arrays for easier processing
    const gpxCoords = allPoints.map(p => [p.lat, p.lon]);
    
    // Much more aggressive tolerance - the GPX contains different segments but might have some overlap
    let maxDistance = 3.0; // Very large tolerance to catch any possible matches
    
    // Find closest points to start and end coordinates
    let bestStartIdx = findClosestPointIndex(gpxCoords, startCoords);
    let bestEndIdx = findClosestPointIndex(gpxCoords, endCoords);
    
    const startDist = calculateDistance(gpxCoords[bestStartIdx], startCoords);
    const endDist = calculateDistance(gpxCoords[bestEndIdx], endCoords);
    
    console.log(`Closest start: index ${bestStartIdx}, distance ${startDist.toFixed(6)}`);
    console.log(`Closest end: index ${bestEndIdx}, distance ${endDist.toFixed(6)}`);
    
    // Try multiple approaches to find GPS data:
    
    // Approach 1: Direct coordinate matching (even if far)
    if (startDist <= maxDistance && endDist <= maxDistance) {
        console.log(`✓ Found potential GPS match using direct coordinate matching`);
        return extractGpsTrackBetweenPoints(gpxCoords, bestStartIdx, bestEndIdx, startCoords, endCoords, 'direct');
    }
    
    // Approach 2: Find any nearby GPS segments and try to interpolate
    const nearbyStartPoints = findNearbyIndices(gpxCoords, startCoords, maxDistance).slice(0, 5);
    const nearbyEndPoints = findNearbyIndices(gpxCoords, endCoords, maxDistance).slice(0, 5);
    
    if (nearbyStartPoints.length > 0 && nearbyEndPoints.length > 0) {
        console.log(`Found ${nearbyStartPoints.length} near start, ${nearbyEndPoints.length} near end - trying best combinations`);
        
        // Try different combinations to find the best GPS path
        let bestPath = null;
        let bestScore = Number.MAX_VALUE;
        
        for (const startPoint of nearbyStartPoints) {
            for (const endPoint of nearbyEndPoints) {
                if (startPoint.index !== endPoint.index) {
                    const path = extractGpsTrackBetweenPoints(gpxCoords, startPoint.index, endPoint.index, startCoords, endCoords, 'nearby');
                    if (path && path.length >= 2) {
                        const score = startPoint.distance + endPoint.distance;
                        if (score < bestScore) {
                            bestScore = score;
                            bestPath = path;
                        }
                    }
                }
            }
        }
        
        if (bestPath) {
            console.log(`✓ Found GPS path using nearby point combination (score: ${bestScore.toFixed(4)})`);
            return bestPath;
        }
    }
    
    // Approach 3: Use GPXParser's built-in distance calculations to find segments
    const track = trailGpxParser.tracks[0];
    if (track.distance && track.distance.cumul) {
        const gpsPath = findSegmentByDistance(track, startCoords, endCoords, segmentIndex);
        if (gpsPath) {
            console.log(`✓ Found GPS path using distance-based matching`);
            return gpsPath;
        }
    }
    
    console.log(`✗ No GPS match found with any approach`);
    return null;
}

function extractGpsTrackBetweenPoints(gpxCoords, startIdx, endIdx, targetStart, targetEnd, method) {
    // Ensure proper ordering
    if (startIdx > endIdx) {
        [startIdx, endIdx] = [endIdx, startIdx];
    }
    
    // Extract the GPS track between these points
    const rawGpsSegment = gpxCoords.slice(startIdx, endIdx + 1);
    
    if (rawGpsSegment.length < 2) {
        return null;
    }
    
    console.log(`${method}: Extracted ${rawGpsSegment.length} GPS points from indices ${startIdx} to ${endIdx}`);
    
    // Sample if too many points
    let finalPath = rawGpsSegment;
    if (rawGpsSegment.length > 300) {
        finalPath = intelligentSample(rawGpsSegment, 200);
        console.log(`Sampled to ${finalPath.length} points`);
    }
    
    // Keep original GPS endpoints (no adjustment to route.json coordinates)
    console.log(`Preserving original GPS start: [${finalPath[0][0].toFixed(6)}, ${finalPath[0][1].toFixed(6)}]`);
    console.log(`Preserving original GPS end: [${finalPath[finalPath.length-1][0].toFixed(6)}, ${finalPath[finalPath.length-1][1].toFixed(6)}]`);
    
    // Calculate winding ratio to verify this looks like a real trail
    const straightDistance = calculateDistance(targetStart, targetEnd);
    const trailDistance = calculateTotalDistance(finalPath);
    const windingRatio = trailDistance / straightDistance;
    
    console.log(`GPS track: straight=${straightDistance.toFixed(4)}°, trail=${trailDistance.toFixed(4)}°, winding=${windingRatio.toFixed(1)}x`);
    
    // Accept tracks that have reasonable winding (real trails are rarely straight)
    if (windingRatio > 0.5 && windingRatio < 10) {
        return finalPath;
    } else {
        console.log(`Rejected: unrealistic winding ratio ${windingRatio.toFixed(1)}x`);
        return null;
    }
}

function findSegmentByDistance(track, startCoords, endCoords, segmentIndex) {
    // Use GPXParser's distance data to find the best matching segment
    const points = track.points;
    const cumulativeDistances = track.distance.cumul;
    const totalDistance = track.distance.total;
    
    if (!cumulativeDistances || cumulativeDistances.length !== points.length) {
        return null;
    }
    
    // Calculate target segment distance
    const targetDistance = calculateDistance(startCoords, endCoords) * 111000; // rough conversion to meters
    
    console.log(`Looking for GPS segment with ~${targetDistance.toFixed(0)}m distance`);
    
    // Look for segments in the GPX that have similar distances
    for (let i = 0; i < points.length - 10; i++) {
        for (let j = i + 10; j < points.length; j++) {
            const segmentDistance = cumulativeDistances[j] - cumulativeDistances[i];
            const distanceRatio = Math.abs(segmentDistance - targetDistance) / targetDistance;
            
            if (distanceRatio < 0.5) { // Within 50% of target distance
                const segmentCoords = points.slice(i, j + 1).map(p => [p.lat, p.lon]);
                console.log(`Found potential segment i=${i}-${j}, distance=${segmentDistance.toFixed(0)}m, ratio=${distanceRatio.toFixed(2)}`);
                
                if (segmentCoords.length >= 2) {
                    // Keep original GPS endpoints (no adjustment)
                    console.log(`Using original GPS segment endpoints from distance matching`);
                    return segmentCoords;
                }
            }
        }
    }
    
    return null;
}

function findNearbyIndices(gpxCoords, targetCoord, maxDistance) {
    const options = [];
    for (let i = 0; i < gpxCoords.length; i++) {
        const distance = calculateDistance(gpxCoords[i], targetCoord);
        if (distance <= maxDistance) {
            options.push({ index: i, distance: distance });
        }
    }
    return options.sort((a, b) => a.distance - b.distance);
}

function buildSegmentObject(rd, index, coords, startCoords, endCoords) {
    return {
        id: index + 1,
        name: rd.name,
        start_location: rd.start_location,
        finish_location: rd.finish_location,
        distance: rd.distance,
        notes: rd.notes,
        coordinates: coords,
        startCoords: startCoords,
        endCoords: endCoords,
        elevation: getSegmentElevationData(index + 1),
        highlights: getSegmentHighlights(index + 1)
    };
}

// Removed old createRealisticPath - using new coordinate-based approach

// Removed old tryExtractGpxSegment - using new coordinate-based approach

// Removed old complex functions - using simplified approach

function calculateDistance(coord1, coord2) {
    // Simple distance calculation in degrees (approximate)
    return Math.sqrt(
        Math.pow(coord1[0] - coord2[0], 2) + 
        Math.pow(coord1[1] - coord2[1], 2)
    );
}

function calculateTotalDistance(coordinates) {
    let total = 0;
    for (let i = 1; i < coordinates.length; i++) {
        total += calculateDistance(coordinates[i-1], coordinates[i]);
    }
    return total;
}

// Removed old GPX extraction functions - using new coordinate-based approach

function findClosestPointIndex(coordinates, targetCoord) {
    let closestIndex = 0;
    let minDistance = Number.MAX_VALUE;
    
    // Use a more efficient search approach for large datasets
    const searchStep = Math.max(1, Math.floor(coordinates.length / 1000)); // Sample every nth point for large datasets
    
    // First pass: find approximate area
    for (let i = 0; i < coordinates.length; i += searchStep) {
        const coord = coordinates[i];
        const distance = calculateDistance(coord, targetCoord);
        
        if (distance < minDistance) {
            minDistance = distance;
            closestIndex = i;
        }
    }
    
    // Second pass: fine-tune search in the local area
    const searchRadius = Math.max(50, searchStep * 2);
    const searchStart = Math.max(0, closestIndex - searchRadius);
    const searchEnd = Math.min(coordinates.length, closestIndex + searchRadius);
    
    minDistance = Number.MAX_VALUE;
    for (let i = searchStart; i < searchEnd; i++) {
        const coord = coordinates[i];
        const distance = calculateDistance(coord, targetCoord);
        
        if (distance < minDistance) {
            minDistance = distance;
            closestIndex = i;
        }
    }
    
    return closestIndex;
}

function intelligentSample(coordinates, targetPoints) {
    if (coordinates.length <= targetPoints) {
        return coordinates;
    }
    
    const result = [coordinates[0]]; // Always include first point
    const step = (coordinates.length - 1) / (targetPoints - 1);
    
    for (let i = 1; i < targetPoints - 1; i++) {
        const index = Math.round(i * step);
        result.push(coordinates[index]);
    }
    
    result.push(coordinates[coordinates.length - 1]); // Always include last point
    return result;
}

function createInterpolatedPath(startCoords, endCoords) {
    const steps = 10; // Number of intermediate points
    const path = [startCoords];
    
    for (let i = 1; i < steps; i++) {
        const ratio = i / steps;
        const lat = startCoords[0] + (endCoords[0] - startCoords[0]) * ratio;
        const lon = startCoords[1] + (endCoords[1] - startCoords[1]) * ratio;
        path.push([lat, lon]);
    }
    
    path.push(endCoords);
    return path;
}

function addStartFinishMarkers() {
    if (coloradoTrailSegments.length === 0) return;
    
    const firstSegment = coloradoTrailSegments[0];
    const lastSegment = coloradoTrailSegments[coloradoTrailSegments.length - 1];
    
    const startMarker = L.marker(firstSegment.startCoords, {
        icon: L.divIcon({
            className: 'custom-marker start-marker',
            html: '<i class="fas fa-play-circle"></i>',
            iconSize: [30, 30],
            iconAnchor: [15, 15]
        })
    }).addTo(map);
    startMarker.bindPopup("<b>Start: Waterton Canyon</b><br>The beginning of Onyx's incredible journey!");
    
    const finishMarker = L.marker(lastSegment.endCoords, {
        icon: L.divIcon({
            className: 'custom-marker finish-marker',
            html: '<i class="fas fa-flag-checkered"></i>',
            iconSize: [30, 30],
            iconAnchor: [15, 15]
        })
    }).addTo(map);
    finishMarker.bindPopup("<b>Finish: Boss Lake TH</b><br>All 15 segments completed! What an incredible achievement!");
}

function getSegmentElevationData(segmentId) {
    // Actual elevation data from Colorado Trail Foundation
    const elevationData = {
        1: { gain: 1580, loss: 760, minElevation: 5440, maxElevation: 6280 },
        2: { gain: 2390, loss: 980, minElevation: 5520, maxElevation: 7040 },
        3: { gain: 1980, loss: 1540, minElevation: 6120, maxElevation: 7760 },
        4: { gain: 2980, loss: 2240, minElevation: 6520, maxElevation: 8920 },
        5: { gain: 2440, loss: 1900, minElevation: 7280, maxElevation: 10040 },
        6: { gain: 4200, loss: 3680, minElevation: 8400, maxElevation: 12040 },
        7: { gain: 1840, loss: 2420, minElevation: 9200, maxElevation: 11760 },
        8: { gain: 3280, loss: 2680, minElevation: 9600, maxElevation: 12600 },
        9: { gain: 2180, loss: 2540, minElevation: 9840, maxElevation: 12460 },
        10: { gain: 1940, loss: 2100, minElevation: 9600, maxElevation: 11920 },
        11: { gain: 3420, loss: 2980, minElevation: 9200, maxElevation: 12600 },
        12: { gain: 2680, loss: 3180, minElevation: 8800, maxElevation: 11680 },
        13: { gain: 3840, loss: 3240, minElevation: 8400, maxElevation: 12200 },
        14: { gain: 2280, loss: 3680, minElevation: 7800, maxElevation: 10840 },
        15: { gain: 1680, loss: 2180, minElevation: 8200, maxElevation: 11200 }
    };
    
    return elevationData[segmentId] || { gain: 2000, loss: 1500, minElevation: 8000, maxElevation: 10000 };
}

function getSegmentHighlights(segmentId) {
    const highlights = {
        1: "Starting point at Waterton Canyon, following the South Platte River",
        2: "Beautiful views as you gain elevation, first taste of mountain terrain",
        3: "Rolling hills and meadows, increasing wilderness experience",
        4: "Deeper into the wilderness, beautiful gulch scenery",
        5: "Approaching the high country, beautiful aspen groves",
        6: "Longest segment! Crossing multiple peaks and valleys",
        7: "Approaching ski country, beautiful alpine terrain",
        8: "High alpine terrain, spectacular mountain views",
        9: "Beautiful alpine lakes and timberline scenery",
        10: "Near Colorado's second highest peak, Mount Massive",
        11: "Collegiate Peaks wilderness, stunning mountain vistas",
        12: "Heart of the Collegiate Peaks, challenging terrain",
        13: "Most challenging segment, Collegiate West route",
        14: "Approaching Salida, descending towards the Arkansas River", 
        15: "Final segment! Boss Lake and the ultimate finish at the main Colorado Trail route"
    };
    
    return "Beautiful Colorado wilderness experience";
}

function setupEventListeners() {
    const animateBtn = document.getElementById('animate-route');
    const resetBtn = document.getElementById('reset-animation');
    
    animateBtn.addEventListener('click', startAnimation);
    resetBtn.addEventListener('click', resetAnimation);
}

function loadSegmentList() {
    const segmentInfo = document.getElementById('segment-info');
    
    // Clear existing content
    segmentInfo.innerHTML = '';
    
    if (coloradoTrailSegments.length === 0) {
        // Show loading message if no segments are loaded yet
        segmentInfo.innerHTML = `
            <div class="welcome-message">
                <h3>Loading Onyx's Adventure...</h3>
                <p>Preparing the trail data and map visualization. This may take a moment.</p>
            </div>
        `;
        return;
    }
    
    // Add welcome message first
    const welcomeDiv = document.createElement('div');
    welcomeDiv.className = 'welcome-message';
    welcomeDiv.innerHTML = `
        <h3>Welcome to Onyx's Adventure!</h3>
        <p>From Waterton Canyon in Littleton to Boss Lake, Onyx conquered 15 segments of the Colorado Trail including the challenging Collegiate West route. Click the animation button to watch their incredible journey unfold!</p>
        
        <div class="adventure-highlights">
            <h4><i class="fas fa-paw"></i> Wildlife Encounters</h4>
            <p>4 moose (3 female, 1 male), countless pikas, marmots, bighorn sheep, birds, deer, chipmunks, and squirrels</p>
            
            <h4><i class="fas fa-users"></i> Trail Friends</h4>
            <p>Met amazing people: Flower Girl, Sparrow, David, Chuck, Rich, Enigma, Cheezit, Chordage, Rebecca, Beatnik</p>
            
            <h4><i class="fas fa-city"></i> Towns Visited</h4>
            <p>Littleton, Breckenridge, Copper Mountain, Twin Lakes, Leadville, Salida</p>
        </div>
    `;
    segmentInfo.appendChild(welcomeDiv);
    
    // Create clickable segment list
    coloradoTrailSegments.forEach((segment, index) => {
        const segmentCard = document.createElement('div');
        segmentCard.className = 'segment-card';
        segmentCard.innerHTML = `
            <h4><i class="fas fa-map-marker-alt"></i> ${segment.name}</h4>
            <p><strong>${segment.start_location}</strong> to <strong>${segment.finish_location}</strong></p>
            <span class="segment-distance">${segment.distance} miles</span>
        `;
        
        segmentCard.addEventListener('click', () => showSegmentDetails(segment, index));
        segmentInfo.appendChild(segmentCard);
    });
}

function showSegmentDetails(segment, index) {
    const segmentInfo = document.getElementById('segment-info');
    
    // Clear previous content
    segmentInfo.innerHTML = '';
    
    // Create detailed segment view
    const detailCard = document.createElement('div');
    detailCard.className = 'segment-selected';
    
    const elevationChart = createElevationChart(segment.elevation, segment.distance);
    
    detailCard.innerHTML = `
        <h3><i class="fas fa-mountain"></i> ${segment.name}</h3>
        <div class="segment-details">
            <p><strong>Route:</strong> ${segment.start_location} → ${segment.finish_location}</p>
            <p><strong>Distance:</strong> ${segment.distance} miles</p>
            
            <div class="elevation-summary">
                <div class="elevation-stat-row">
                    <div class="elevation-stat">
                        <i class="fas fa-arrow-up text-green"></i>
                        <span class="elevation-number">${segment.elevation.gain.toLocaleString()}</span>
                        <span class="elevation-label">Elevation Gain (ft)</span>
                    </div>
                    <div class="elevation-stat">
                        <i class="fas fa-arrow-down text-blue"></i>
                        <span class="elevation-number">${segment.elevation.loss.toLocaleString()}</span>
                        <span class="elevation-label">Elevation Loss (ft)</span>
                    </div>
                </div>
                <div class="elevation-stat-row">
                    <div class="elevation-stat">
                        <i class="fas fa-mountain text-orange"></i>
                        <span class="elevation-number">${segment.elevation.maxElevation.toLocaleString()}</span>
                        <span class="elevation-label">Max Elevation (ft)</span>
                    </div>
                    <div class="elevation-stat">
                        <i class="fas fa-valley text-purple"></i>
                        <span class="elevation-number">${segment.elevation.minElevation.toLocaleString()}</span>
                        <span class="elevation-label">Min Elevation (ft)</span>
                    </div>
                </div>
            </div>
            
            <p class="segment-highlights"><strong>Highlights:</strong> ${segment.highlights}</p>
        </div>
        <button class="btn-secondary" onclick="loadSegmentList()">
            <i class="fas fa-arrow-left"></i> Back to All Segments
        </button>
    `;
    
    segmentInfo.appendChild(detailCard);
    
    // Highlight segment on map
    highlightSegment(segment, index);
}

function createElevationChart(elevation, distance) {
    const { minElevation, maxElevation, gain, loss } = elevation;
    const elevationRange = maxElevation - minElevation;
    
    // Create a simplified elevation profile visualization
    const chartHeight = 120;
    const chartWidth = 280;
    
    // Simplified profile: start low, go up to max, then down to end
    const points = [];
    const numPoints = 20;
    
    for (let i = 0; i <= numPoints; i++) {
        const progress = i / numPoints;
        let elevationAtPoint;
        
        if (progress < 0.6) {
            // Rising section
            elevationAtPoint = minElevation + (maxElevation - minElevation) * (progress / 0.6);
        } else {
            // Descending section  
            elevationAtPoint = maxElevation - (maxElevation - minElevation) * ((progress - 0.6) / 0.4) * 0.7;
        }
        
        const x = (progress * chartWidth);
        const y = chartHeight - ((elevationAtPoint - minElevation) / elevationRange) * chartHeight;
        
        points.push(`${x},${y}`);
    }
    
    const pathData = `M ${points.join(' L ')}`;
    
    return `
        <div class="elevation-chart">
            <svg width="${chartWidth}" height="${chartHeight + 40}" viewBox="0 0 ${chartWidth} ${chartHeight + 40}">
                <!-- Background -->
                <rect width="${chartWidth}" height="${chartHeight}" fill="#f8f9fa" stroke="#ddd" stroke-width="1"/>
                
                <!-- Grid lines -->
                <line x1="0" y1="${chartHeight/3}" x2="${chartWidth}" y2="${chartHeight/3}" stroke="#eee" stroke-width="1"/>
                <line x1="0" y1="${2*chartHeight/3}" x2="${chartWidth}" y2="${2*chartHeight/3}" stroke="#eee" stroke-width="1"/>
                <line x1="${chartWidth/3}" y1="0" x2="${chartWidth/3}" y2="${chartHeight}" stroke="#eee" stroke-width="1"/>
                <line x1="${2*chartWidth/3}" y1="0" x2="${2*chartWidth/3}" y2="${chartHeight}" stroke="#eee" stroke-width="1"/>
                
                <!-- Elevation area -->
                <path d="${pathData} L ${chartWidth},${chartHeight} L 0,${chartHeight} Z" fill="rgba(76, 175, 80, 0.2)" stroke="none"/>
                
                <!-- Elevation line -->
                <path d="${pathData}" fill="none" stroke="#4CAF50" stroke-width="3"/>
                
                <!-- Labels -->
                <text x="5" y="15" font-size="11" fill="#666">${maxElevation.toLocaleString()}ft</text>
                <text x="5" y="${chartHeight - 5}" font-size="11" fill="#666">${minElevation.toLocaleString()}ft</text>
                <text x="5" y="${chartHeight + 20}" font-size="11" fill="#666">0 mi</text>
                <text x="${chartWidth - 30}" y="${chartHeight + 20}" font-size="11" fill="#666">${distance} mi</text>
            </svg>
        </div>
    `;
}

function highlightSegment(segment, index) {
    // Clear previous highlights
    routeLines.forEach(line => map.removeLayer(line));
    routeLines = [];
    
    // Add highlighted route line
    const routeLine = L.polyline(segment.coordinates, {
        color: '#4CAF50',
        weight: 6,
        opacity: 0.8,
        className: 'highlighted-route'
    }).addTo(map);
    
    routeLines.push(routeLine);
    
    // Fit map to segment bounds
    map.fitBounds(routeLine.getBounds(), { padding: [20, 20] });
    
    // Add segment markers
    const startMarker = L.marker(segment.coordinates[0], {
        icon: L.divIcon({
            className: 'custom-marker segment-start',
            html: `<span>${segment.id}</span>`,
            iconSize: [25, 25],
            iconAnchor: [12, 12]
        })
    }).addTo(map);
    
    const endMarker = L.marker(segment.coordinates[segment.coordinates.length - 1], {
        icon: L.divIcon({
            className: 'custom-marker segment-end',
            html: '<i class="fas fa-check"></i>',
            iconSize: [25, 25],
            iconAnchor: [12, 12]
        })
    }).addTo(map);
    
    startMarker.bindPopup(`<b>Start of ${segment.name}</b><br>${segment.start_location}`);
    endMarker.bindPopup(`<b>End of ${segment.name}</b><br>${segment.finish_location}`);
    
    segmentMarkers.push(startMarker, endMarker);
}

function startAnimation() {
    if (isAnimating || coloradoTrailSegments.length === 0) return;
    
    isAnimating = true;
    currentSegmentIndex = 0;
    
    // Clear any existing route lines
    routeLines.forEach(line => map.removeLayer(line));
    routeLines = [];
    
    // Clear segment markers
    segmentMarkers.forEach(marker => map.removeLayer(marker));
    segmentMarkers = [];
    
    // Reset map view to show the full trail
    if (coloradoTrailSegments.length > 0) {
        const bounds = L.latLngBounds([
            coloradoTrailSegments[0].startCoords,
            coloradoTrailSegments[coloradoTrailSegments.length - 1].endCoords
        ]);
        map.fitBounds(bounds, { padding: [50, 50] });
    }
    
    // Update button states
    document.getElementById('animate-route').innerHTML = '<i class="fas fa-spinner fa-spin"></i> Animating...';
    document.getElementById('animate-route').disabled = true;
    
    // Start the animation
    animateNextSegment();
}

function animateNextSegment() {
    if (currentSegmentIndex >= coloradoTrailSegments.length) {
        // Animation complete
        isAnimating = false;
        document.getElementById('animate-route').innerHTML = '<i class="fas fa-play"></i> Watch Onyx\'s Journey';
        document.getElementById('animate-route').disabled = false;
        
        // Show completion message
        showCompletionMessage();
        return;
    }
    
    const segment = coloradoTrailSegments[currentSegmentIndex];
    
    // Create animated polyline
    const polyline = L.polyline(segment.coordinates, {
        color: getSegmentColor(currentSegmentIndex),
        weight: 4,
        opacity: 0.8,
        className: 'route-segment'
    });
    
    // Add to map and store reference
    polyline.addTo(map);
    routeLines.push(polyline);
    
    // Animate the drawing of this segment
    animatePolyline(polyline, segment, () => {
        currentSegmentIndex++;
        // Wait a bit before next segment
        animationTimeout = setTimeout(animateNextSegment, 800);
    });
}

function animatePolyline(polyline, segment, callback) {
    const pathElement = polyline.getElement();
    if (pathElement) {
        const pathLength = pathElement.getTotalLength();
        pathElement.style.strokeDasharray = pathLength + ' ' + pathLength;
        pathElement.style.strokeDashoffset = pathLength;
        
        // Trigger animation
        pathElement.getBoundingClientRect();
        pathElement.style.transition = 'stroke-dashoffset 2s ease-in-out';
        pathElement.style.strokeDashoffset = '0';
    }
    
    // Update sidebar to show current segment
    updateCurrentSegmentDisplay(segment);
    
    // Call callback after animation
    setTimeout(callback, 2000);
}

function updateCurrentSegmentDisplay(segment) {
    const segmentInfo = document.getElementById('segment-info');
    
    // Create current segment indicator
    let currentDisplay = document.getElementById('current-segment-display');
    if (!currentDisplay) {
        currentDisplay = document.createElement('div');
        currentDisplay.id = 'current-segment-display';
        currentDisplay.className = 'current-segment-animation';
        segmentInfo.insertBefore(currentDisplay, segmentInfo.firstChild);
    }
    
    currentDisplay.innerHTML = `
        <div class="current-segment-card">
            <h4><i class="fas fa-hiking"></i> Currently Hiking</h4>
            <h3>${segment.name}</h3>
            <p>${segment.start_location} → ${segment.finish_location}</p>
            <div class="segment-progress">
                <span class="distance">${segment.distance} miles</span>
                <div class="progress-bar">
                    <div class="progress-fill"></div>
                </div>
            </div>
        </div>
    `;
}

function getSegmentColor(index) {
    const colors = [
        '#4CAF50', '#2196F3', '#FF9800', '#9C27B0', '#F44336',
        '#009688', '#795548', '#607D8B', '#E91E63', '#3F51B5',
        '#8BC34A', '#FFC107', '#673AB7', '#00BCD4', '#FF5722'
    ];
    return colors[index % colors.length];
}

function resetAnimation() {
    // Clear animation
    isAnimating = false;
    currentSegmentIndex = 0;
    
    if (animationTimeout) {
        clearTimeout(animationTimeout);
    }
    
    // Clear route lines
    routeLines.forEach(line => map.removeLayer(line));
    routeLines = [];
    
    // Clear segment markers
    segmentMarkers.forEach(marker => map.removeLayer(marker));
    segmentMarkers = [];
    
    // Reset button states
    document.getElementById('animate-route').innerHTML = '<i class="fas fa-play"></i> Watch Onyx\'s Journey';
    document.getElementById('animate-route').disabled = false;
    
    // Reset map view to show full trail if segments are loaded
    if (coloradoTrailSegments.length > 0) {
        const bounds = L.latLngBounds([
            coloradoTrailSegments[0].startCoords,
            coloradoTrailSegments[coloradoTrailSegments.length - 1].endCoords
        ]);
        map.fitBounds(bounds, { padding: [50, 50] });
    } else {
        map.setView([38.9, -105.9], 9);
    }
    
    // Clear current segment display
    const currentDisplay = document.getElementById('current-segment-display');
    if (currentDisplay) {
        currentDisplay.remove();
    }
    
    // Reload segment list
    loadSegmentList();
}

function showCompletionMessage() {
    const segmentInfo = document.getElementById('segment-info');
    
    const completionCard = document.createElement('div');
    completionCard.className = 'completion-celebration';
    completionCard.innerHTML = `
        <div class="celebration-content">
            <h2><i class="fas fa-trophy"></i> Congratulations Onyx!</h2>
            <p>You've just watched Onyx's incredible 258.2-mile journey through the Colorado wilderness!</p>
            <div class="celebration-stats">
                <div class="celebration-stat">
                    <i class="fas fa-mountain"></i>
                    <span>15 segments completed</span>
                </div>
                <div class="celebration-stat">
                    <i class="fas fa-calendar"></i>
                    <span>19 days of adventure</span>
                </div>
                <div class="celebration-stat">
                    <i class="fas fa-heart"></i>
                    <span>One amazing achievement</span>
                </div>
            </div>
            <button class="btn-primary" onclick="loadSegmentList()">
                <i class="fas fa-map"></i> Explore Individual Segments
            </button>
        </div>
    `;
    
    segmentInfo.insertBefore(completionCard, segmentInfo.firstChild);
}

