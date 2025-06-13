// Map functionality using Mapbox
class MapHandler {
  constructor() {
    this.mapboxToken = 'pk.eyJ1IjoiZXZpb3IxMiIsImEiOiJjbWJuaW42Y2IxZDdpMnNxd2kyYnpkY242In0.7ynAcBLoSviZz3sqa_gpaQ'; // Replace with your Mapbox token
    this.map = null;
    this.vehicleMarker = null;
    this.pickupMarkers = [];
    this.routeLine = null;
    this.selectedPickupPoint = null;
    this.routesDisplayed = false;
    this.routeDetails = null;
    this.lastRouteUpdateTime = null;
    this.closestRouteInfo = null;
    this.secondRouteInfo = null;
    this.sortedPickupPoints = null;
    this.userHasInteracted = false; // Track if user has manually moved the map
  }

  // Initialize the map
  async initializeMap(vehicleLocation) {
    // Default to a location in Pakistan if no vehicle location is available
    const defaultLocation = [73.0479, 33.6844]; // Islamabad coordinates
    const initialLocation = vehicleLocation 
      ? [vehicleLocation.longitude, vehicleLocation.latitude]
      : defaultLocation;

    mapboxgl.accessToken = this.mapboxToken;
    
    this.map = new mapboxgl.Map({
      container: 'map',
      style: 'mapbox://styles/mapbox/streets-v12',
      center: initialLocation,
      zoom: 13
    });

    // Wait for the map to load
    return new Promise((resolve) => {
      this.map.on('load', () => {
        // Add navigation controls
        this.map.addControl(new mapboxgl.NavigationControl(), 'top-right');
        
        // Add scale
        this.map.addControl(new mapboxgl.ScaleControl(), 'bottom-left');

        // Track when user manually interacts with the map
        this.map.on('dragstart', () => {
          this.userHasInteracted = true;
        });
        
        this.map.on('zoomstart', () => {
          this.userHasInteracted = true;
        });

        // Create vehicle marker element with image
        const vehicleElement = document.createElement('div');
        vehicleElement.className = 'vehicle-marker';
        vehicleElement.style.backgroundImage = 'url(assets/vehicle-marker.png)';
        vehicleElement.style.width = '30px';
        vehicleElement.style.height = '30px';
        vehicleElement.style.backgroundSize = 'contain';
        vehicleElement.style.backgroundRepeat = 'no-repeat';
        
        // Add vehicle marker
        if (vehicleLocation) {
          this.vehicleMarker = new mapboxgl.Marker(vehicleElement)
            .setLngLat([vehicleLocation.longitude, vehicleLocation.latitude])
            .addTo(this.map);
        }
        
        // Add route sources and layers for multiple routes
        // Main route source (closest route - green)
        this.map.addSource('route-closest', {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'LineString',
              coordinates: []
            }
          }
        });
        
        // Main route layer (closest route - green)
        this.map.addLayer({
          id: 'route-closest',
          type: 'line',
          source: 'route-closest',
          layout: {
            'line-join': 'round',
            'line-cap': 'round'
          },
          paint: {
            'line-color': '#2ecc71', // Green color for closest route
            'line-width': 6,
            'line-opacity': 0.8
          },
          // Higher z-index to render on top of other routes
          metadata: {
            zIndex: 10
          }
        });

        // Second closest route source (yellow)
        this.map.addSource('route-second', {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'LineString',
              coordinates: []
            }
          }
        });
        
        // Second closest route layer (yellow)
        this.map.addLayer({
          id: 'route-second',
          type: 'line',
          source: 'route-second',
          layout: {
            'line-join': 'round',
            'line-cap': 'round'
          },
          paint: {
            'line-color': '#f1c40f', // Yellow color for second closest
            'line-width': 5,
            'line-opacity': 0.8
          },
          // Medium z-index
          metadata: {
            zIndex: 5
          }
        });

        // Add source and layer for remaining routes (gray)
        for (let i = 0; i < 5; i++) {
          this.map.addSource(`route-other-${i}`, {
            type: 'geojson',
            data: {
              type: 'Feature',
              properties: {},
              geometry: {
                type: 'LineString',
                coordinates: []
              }
            }
          });
          
          this.map.addLayer({
            id: `route-other-${i}`,
            type: 'line',
            source: `route-other-${i}`,
            layout: {
              'line-join': 'round',
              'line-cap': 'round'
            },
            paint: {
              'line-color': '#95a5a6', // Gray color for other routes
              'line-width': 4,
              'line-opacity': 0.6,
              'line-dasharray': [2, 2]
            },
            // Lowest z-index
            metadata: {
              zIndex: 1
            }
          });
        }
        
        // Ensure the layers are in the correct order
        this.reorderLayers();
        
        resolve();
      });
    });
  }
  
  // Make sure the closest route is on top, then second closest, then others
  reorderLayers() {
    if (!this.map) return;
    
    // Get all route layer IDs
    const layers = [
      'route-closest',
      'route-second'
    ];
    
    for (let i = 0; i < 5; i++) {
      layers.push(`route-other-${i}`);
    }
    
    // Reorder layers from lowest to highest z-index
    // This ensures the closest route is visually on top when routes overlap
    for (let i = 0; i < layers.length; i++) {
      for (let j = 0; j < layers.length - 1; j++) {
        this.map.moveLayer(layers[j + 1], layers[j]);
      }
    }
  }

  // Update vehicle marker position
  updateVehiclePosition(longitude, latitude) {
    if (!this.map) return;
    
    // Create marker if it doesn't exist
    if (!this.vehicleMarker) {
      const vehicleElement = document.createElement('div');
      vehicleElement.className = 'vehicle-marker';
      vehicleElement.style.backgroundImage = 'url(assets/vehicle-marker.png)';
      vehicleElement.style.width = '30px';
      vehicleElement.style.height = '30px';
      vehicleElement.style.backgroundSize = 'contain';
      vehicleElement.style.backgroundRepeat = 'no-repeat';
      
      this.vehicleMarker = new mapboxgl.Marker(vehicleElement)
        .setLngLat([longitude, latitude])
        .addTo(this.map);
    } else {
      // Update existing marker position
      this.vehicleMarker.setLngLat([longitude, latitude]);
    }
    
    // Only pan map to new position if user hasn't manually interacted with the map
    if (!this.userHasInteracted) {
      this.map.panTo([longitude, latitude], {
        duration: 1000,
        animate: true
      });
    }
    
    // Update routes if we have pickup points and vehicle position changed
    if (this.pickupMarkers.length > 0) {
      // Only update routes every few position changes to avoid too many API calls
      if (!this.routesDisplayed || !this.lastRouteUpdateTime || 
          (Date.now() - this.lastRouteUpdateTime > 10000)) { // Update routes at most every 10 seconds
        this.showAllRoutes();
        this.lastRouteUpdateTime = Date.now();
      }
    }
  }

  // Add pickup points to the map
  addPickupPoints(pickupPoints) {
    // Clear existing markers
    this.clearPickupMarkers();
    
    // Add new markers
    pickupPoints.forEach(point => {
      // Skip if missing required coordinates
      if (typeof point.longitude === 'undefined' || typeof point.latitude === 'undefined') {
        console.warn('Pickup point missing coordinates:', point);
        return;
      }
      
      const el = document.createElement('div');
      el.className = 'pickup-marker';
      el.style.backgroundImage = 'url(assets/pickup-marker.png)';
      el.style.width = '25px';
      el.style.height = '25px';
      el.style.backgroundSize = 'contain';
      el.style.backgroundRepeat = 'no-repeat';
      
      // Create popup content with user details if available
      let popupContent = `<h3>${point.name || 'Pickup Point'}</h3>`;
      
      if (point.address) {
        popupContent += `<p><strong>Address:</strong> ${point.address}</p>`;
      }
      
      // Add user details if available
      if (point.user_id || point.user_name || point.user_email || point.user_phone) {
        popupContent += `<div class="pickup-user-details">
          <h4>Pickup Point Owner</h4>
          ${point.user_name ? `<p><strong>Name:</strong> ${point.user_name}</p>` : ''}
          ${point.user_email ? `<p><strong>Email:</strong> ${point.user_email}</p>` : ''}
          ${point.user_phone ? `<p><strong>Phone:</strong> ${point.user_phone}</p>` : ''}
          ${point.user_id && !point.user_name ? `<p><strong>User ID:</strong> ${point.user_id}</p>` : ''}
        </div>`;
      }
      
      const marker = new mapboxgl.Marker(el)
        .setLngLat([point.longitude, point.latitude])
        .setPopup(
          new mapboxgl.Popup({ offset: 25 })
            .setHTML(popupContent)
        )
        .addTo(this.map);
      
      this.pickupMarkers.push({
        marker,
        point
      });
    });
    
    // If we have pickup points and a vehicle marker, show routes between all points
    if (this.pickupMarkers.length > 0 && this.vehicleMarker) {
      this.showAllRoutes();
    }
  }

  // Clear pickup markers
  clearPickupMarkers() {
    this.pickupMarkers.forEach(markerObj => markerObj.marker.remove());
    this.pickupMarkers = [];
    this.routesDisplayed = false;
  }

  // Show routes between all pickup points
  async showAllRoutes() {
    if (!this.map || !this.vehicleMarker || this.pickupMarkers.length === 0) return;
    this.routesDisplayed = true;

    try {
      // Start with the vehicle location
      const vehiclePosition = this.vehicleMarker.getLngLat();
      
      // Create an array of coordinates starting with the vehicle position
      const waypoints = [
        `${vehiclePosition.lng},${vehiclePosition.lat}`
      ];
      
      // Add all pickup points as waypoints
      this.pickupMarkers.forEach(markerObj => {
        const point = markerObj.point;
        waypoints.push(`${point.longitude},${point.latitude}`);
      });
      
      // If we have more than 25 waypoints, Mapbox API will reject the request
      // so we'll limit to the first 24 pickup points plus the vehicle
      const limitedWaypoints = waypoints.slice(0, 25);
      
      // Create the API URL with semicolon-separated waypoints
      const waypointsStr = limitedWaypoints.join(';');
      
      const response = await fetch(
        `https://api.mapbox.com/directions/v5/mapbox/driving/${waypointsStr}` +
        `?alternatives=true&annotations=distance,duration,speed,congestion,congestion_numeric,maxspeed,closure` +
        `&geometries=geojson&language=en&overview=full&steps=true` +
        `&access_token=${mapboxgl.accessToken}`
      );
      
      const data = await response.json();
      
      if (data.code !== 'Ok') {
        throw new Error('Error fetching directions');
      }
      
      // Save all route details
      this.routeDetails = data;
      
      // Sort pickup points by distance from vehicle
      const pickupPointsWithDistance = this.pickupMarkers.map((markerObj, index) => {
        // Calculate distance from vehicle to pickup point
        const distance = this.calculateDistance(
          vehiclePosition.lat, vehiclePosition.lng,
          markerObj.point.latitude, markerObj.point.longitude
        );
        
        return {
          index: index,
          point: markerObj.point,
          distance: distance
        };
      });
      
      // Sort by distance
      pickupPointsWithDistance.sort((a, b) => a.distance - b.distance);
      
      // Store the sorted pickup points for route details display
      this.sortedPickupPoints = pickupPointsWithDistance;
      
      // Clear all routes first
      this.clearAllRoutes();
      
      // Display routes with color coding
      if (pickupPointsWithDistance.length >= 1) {
        // Get the closest pickup point
        const closestPoint = pickupPointsWithDistance[0].point;
        
        // Get route to closest pickup point
        const closestRoute = await this.getRouteData(vehiclePosition, closestPoint);
        
        if (closestRoute) {
          // Update the closest route (green)
          this.map.getSource('route-closest').setData({
            type: 'Feature',
            properties: {},
            geometry: closestRoute.geometry
          });
          
          // Store the closest route details
          this.closestRouteInfo = this.processRouteDetails(closestRoute);
        }
      }
      
      if (pickupPointsWithDistance.length >= 2) {
        // Get the second closest pickup point
        const secondClosestPoint = pickupPointsWithDistance[1].point;
        
        // Get route to second closest pickup point
        const secondRoute = await this.getRouteData(vehiclePosition, secondClosestPoint);
        
        if (secondRoute) {
          // Update the second closest route (yellow)
          this.map.getSource('route-second').setData({
            type: 'Feature',
            properties: {},
            geometry: secondRoute.geometry
          });
          
          // Store the second closest route details
          this.secondRouteInfo = this.processRouteDetails(secondRoute);
        }
      }
      
      // Display remaining routes in gray
      const remainingPoints = pickupPointsWithDistance.slice(2, 7); // Limit to 5 more routes
      
      for (let i = 0; i < remainingPoints.length; i++) {
        const point = remainingPoints[i].point;
        const routeData = await this.getRouteData(vehiclePosition, point);
        
        if (routeData) {
          this.map.getSource(`route-other-${i}`).setData({
            type: 'Feature',
            properties: {},
            geometry: routeData.geometry
          });
        }
      }
      
      // Make sure the closest route layer is on top
      this.reorderLayers();
      
      // Only fit the map to routes if this is the first time showing routes
      // and the user hasn't manually interacted with the map
      if (!this.userHasInteracted) {
        this.fitMapToRoutes();
      }
      
      // Return the closest route info for display in the sidebar
      return this.closestRouteInfo;
    } catch (error) {
      console.error('Error showing all routes:', error);
      this.routesDisplayed = false;
      return null;
    }
  }
  
  // Calculate distance between two points using Haversine formula
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radius of the earth in km
    const dLat = this.deg2rad(lat2 - lat1);
    const dLon = this.deg2rad(lon2 - lon1);
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(this.deg2rad(lat1)) * Math.cos(this.deg2rad(lat2)) * 
      Math.sin(dLon/2) * Math.sin(dLon/2); 
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
    const d = R * c; // Distance in km
    return d;
  }
  
  deg2rad(deg) {
    return deg * (Math.PI/180);
  }
  
  // Get route data for a specific pickup point
  async getRouteData(vehiclePosition, pickupPoint) {
    try {
      const response = await fetch(
        `https://api.mapbox.com/directions/v5/mapbox/driving/` +
        `${vehiclePosition.lng},${vehiclePosition.lat};${pickupPoint.longitude},${pickupPoint.latitude}` +
        `?alternatives=false&annotations=distance,duration,speed,congestion,congestion_numeric,maxspeed,closure` +
        `&geometries=geojson&language=en&overview=full&steps=true` +
        `&access_token=${mapboxgl.accessToken}`
      );
      
      const data = await response.json();
      
      if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
        return null;
      }
      
      return data.routes[0];
    } catch (error) {
      console.error('Error getting route data:', error);
      return null;
    }
  }
  
  // Clear all routes from the map
  clearAllRoutes() {
    if (!this.map) return;
    
    // Clear closest route
    this.map.getSource('route-closest').setData({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: []
      }
    });
    
    // Clear second closest route
    this.map.getSource('route-second').setData({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: []
      }
    });
    
    // Clear other routes
    for (let i = 0; i < 5; i++) {
      this.map.getSource(`route-other-${i}`).setData({
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: []
        }
      });
    }
  }
  
  // Fit map to include all visible routes and markers
  fitMapToRoutes() {
    if (!this.map || !this.vehicleMarker) return;
    
    const bounds = new mapboxgl.LngLatBounds();
    
    // Include the vehicle position
    const vehiclePosition = this.vehicleMarker.getLngLat();
    bounds.extend([vehiclePosition.lng, vehiclePosition.lat]);
    
    // Include all pickup points
    this.pickupMarkers.forEach(markerObj => {
      const point = markerObj.point;
      bounds.extend([point.longitude, point.latitude]);
    });
    
    // Fit the map to the bounds
    this.map.fitBounds(bounds, {
      padding: 80,
      maxZoom: 14
    });
  }

  // Get all route details for display
  getAllRouteDetails() {
    return {
      closest: this.closestRouteInfo,
      second: this.secondRouteInfo,
      sortedPickupPoints: this.sortedPickupPoints
    };
  }

  // Get route from vehicle to pickup point
  async getRoute(pickupPoint) {
    if (!this.map || !this.vehicleMarker) return;
    
    this.selectedPickupPoint = pickupPoint;
    const vehiclePosition = this.vehicleMarker.getLngLat();
    
    try {
      const response = await fetch(
        `https://api.mapbox.com/directions/v5/mapbox/driving/` +
        `${vehiclePosition.lng},${vehiclePosition.lat};${pickupPoint.longitude},${pickupPoint.latitude}` +
        `?alternatives=true&annotations=distance,duration,speed,congestion,congestion_numeric,maxspeed,closure` +
        `&geometries=geojson&language=en&overview=full&steps=true` +
        `&access_token=${mapboxgl.accessToken}`
      );
      
      const data = await response.json();
      
      if (data.code !== 'Ok') {
        throw new Error('Error fetching directions');
      }
      
      const route = data.routes[0];
      const routeGeometry = route.geometry;
      
      // Update the route line
      this.map.getSource('route').setData({
        type: 'Feature',
        properties: {},
        geometry: routeGeometry
      });
      
      // Clear alternative routes
      for (let i = 0; i < 3; i++) {
        this.map.getSource(`route-alternative-${i}`).setData({
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: []
          }
        });
      }
      
      // Add alternative routes if available
      if (data.routes.length > 1) {
        for (let i = 0; i < Math.min(data.routes.length - 1, 3); i++) {
          const alternativeRoute = data.routes[i + 1];
          this.map.getSource(`route-alternative-${i}`).setData({
            type: 'Feature',
            properties: {},
            geometry: alternativeRoute.geometry
          });
        }
      }
      
      // Only fit map to the route if user hasn't manually interacted with the map
      if (!this.userHasInteracted) {
        const bounds = new mapboxgl.LngLatBounds();
        routeGeometry.coordinates.forEach(point => bounds.extend(point));
        
        this.map.fitBounds(bounds, {
          padding: 80,
          maxZoom: 15
        });
      }
      
      return {
        distance: route.distance,
        duration: route.duration
      };
      
    } catch (error) {
      console.error('Error getting route:', error);
      return null;
    }
  }

  // Clear the route from the map
  clearRoute() {
    if (!this.map) return;
    
    // Clear main route
    this.map.getSource('route').setData({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: []
      }
    });
    
    // Clear alternative routes
    for (let i = 0; i < 3; i++) {
      this.map.getSource(`route-alternative-${i}`).setData({
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: []
        }
      });
    }
    
    this.selectedPickupPoint = null;
    this.routesDisplayed = false;
  }

  // Resize map if container size changes
  resizeMap() {
    if (this.map) {
      this.map.resize();
    }
  }
  
  // Process route details to extract all available information
  processRouteDetails(route) {
    if (!route) return null;
    
    const routeInfo = {
      // Basic route information
      distance: route.distance,
      duration: route.duration,
      
      // Step by step instructions
      steps: route.legs.flatMap(leg => 
        leg.steps.map(step => ({
          instruction: step.maneuver.instruction,
          distance: step.distance,
          duration: step.duration,
          name: step.name,
          type: step.maneuver.type,
          modifier: step.maneuver.modifier
        }))
      ),
      
      // Additional annotations if available
      annotations: {}
    };
    
    // Extract any available annotations
    if (route.legs && route.legs.length > 0) {
      const leg = route.legs[0];
      
      if (leg.annotation) {
        // Add all available annotations to our route info
        routeInfo.annotations = leg.annotation;
        
        // Process speed data
        if (leg.annotation.speed) {
          // Calculate average speed (excluding zeros)
          const speeds = leg.annotation.speed.filter(s => s > 0);
          routeInfo.averageSpeed = speeds.length > 0 
            ? speeds.reduce((sum, s) => sum + s, 0) / speeds.length 
            : 0;
        }
        
        // Process congestion data
        if (leg.annotation.congestion) {
          // Count occurrences of each congestion level
          routeInfo.congestionLevels = {};
          leg.annotation.congestion.forEach(c => {
            if (!routeInfo.congestionLevels[c]) {
              routeInfo.congestionLevels[c] = 0;
            }
            routeInfo.congestionLevels[c]++;
          });
        }
        
        // Process maxspeed data
        if (leg.annotation.maxspeed) {
          routeInfo.maxspeedInfo = {
            highest: Math.max(...leg.annotation.maxspeed.map(ms => {
              // Check if ms is a string before calling split
              if (typeof ms === 'string' && ms) {
                return parseInt(ms.split(' ')[0]) || 0;
              }
              return 0;
            })),
            units: leg.annotation.maxspeed.find(ms => typeof ms === 'string' && ms)?.split(' ')[1] || 'km/h'
          };
        }
      }
    }
    
    // Waypoint information
    routeInfo.waypoints = this.routeDetails.waypoints.map(waypoint => ({
      name: waypoint.name,
      location: waypoint.location
    }));
    
    // Add alternative routes count
    routeInfo.alternativeRoutesCount = this.routeDetails.routes.length - 1;
    
    // Original route data if needed for reference
    routeInfo.rawData = route;
    
    return routeInfo;
  }
  
  // Get the full route details object
  getRouteDetails() {
    if (!this.routeDetails) {
      console.error('No route details available');
      return null;
    }
    
    try {
      return this.routeDetails;
    } catch (error) {
      console.error('Error accessing route details:', error);
      return null;
    }
  }
}

// Create map handler instance
const mapHandler = new MapHandler(); 