// Main application functionality
document.addEventListener('DOMContentLoaded', async () => {
  // Elements
  const organizationInfoEl = document.getElementById('organization-info');
  const vehicleInfoEl = document.getElementById('vehicle-info');
  const connectionStatusEl = document.getElementById('connection-status');
  const statusIconEl = document.getElementById('status-icon');
  const latitudeEl = document.getElementById('latitude');
  const longitudeEl = document.getElementById('longitude');
  const speedEl = document.getElementById('speed');
  const pickupPointsCountEl = document.getElementById('pickup-points-count');
  const resetConfigBtn = document.getElementById('reset-config');
  const routeInfoEl = document.getElementById('route-info');
  const routeDetailsEl = document.getElementById('route-details');
  const showAllRouteDetailsBtn = document.getElementById('show-all-routes-details');
  const userImagesContainerEl = document.getElementById('user-images-container');
  const refreshImagesBtn = document.getElementById('refresh-images');

  let config;
  let pickupPoints = [];
  let locationSubscription;
  let vehicleSubscription;
  let pickupPointSubscription;
  let routeInfo;
  let userImages = [];

  // Initialize the application
  async function initApp() {
    try {
      // Get configuration from main process
      config = await window.electronAPI.getConfig();
      
      if (!config || !config.organizationId || !config.vehicleId) {
        console.error('Invalid configuration');
        return;
      }

      // Wait for Supabase client to be initialized
      if (!window.supabase?.client) {
        let attempts = 0;
        while (!window.supabase?.client && attempts < 10) {
          await new Promise(resolve => setTimeout(resolve, 500));
          attempts++;
        }
        
        if (!window.supabase?.client) {
          throw new Error('Could not connect to Supabase');
        }
      }

      // Initialize map
      const initialLocation = await window.supabase.getVehicleLocation(config.vehicleId);
      await mapHandler.initializeMap(initialLocation);

      // Load organization data
      loadOrganizationData();
      
      // Load vehicle data
      loadVehicleData();
      
      // Load pickup points
      loadPickupPoints();
      
      // Load user images
      loadUserImages();
      
      // Subscribe to real-time updates
      setupRealTimeSubscriptions();
      
      // Setup event listeners
      setupEventListeners();
      
      // Handle window resize
      window.addEventListener('resize', () => {
        mapHandler.resizeMap();
      });
    } catch (error) {
      console.error('Error initializing app:', error);
      setConnectionStatus('error', 'Error initializing application');
    }
  }

  // Subscribe to real-time updates
  function setupRealTimeSubscriptions() {
    try {
      // Subscribe to location updates
      locationSubscription = window.supabase.subscribeToLocationUpdates(
        config.vehicleId,
        handleLocationUpdate
      );
      
      // Subscribe to vehicle status updates
      vehicleSubscription = window.supabase.subscribeToVehicleUpdates(
        config.vehicleId,
        handleVehicleUpdate
      );
      
      // Subscribe to pickup point updates
      pickupPointSubscription = window.supabase.subscribeToPickupPointUpdates(
        config.organizationId,
        handlePickupPointUpdate
      );
      
      // Initially set status to connecting until we get a vehicle update
      setConnectionStatus('connecting', 'Connecting to vehicle...');
    } catch (error) {
      console.error('Error setting up real-time subscriptions:', error);
      setConnectionStatus('offline', 'Disconnected');
    }
  }

  // Handle location update
  function handleLocationUpdate(locationData, eventType) {
    if (!locationData || eventType === 'DELETE') return;
    
    // Update coordinates display
    latitudeEl.textContent = locationData.latitude.toFixed(6);
    longitudeEl.textContent = locationData.longitude.toFixed(6);
    speedEl.textContent = locationData.speed ? locationData.speed.toFixed(1) : '0.0';
    
    // Update vehicle marker on map
    mapHandler.updateVehiclePosition(locationData.longitude, locationData.latitude);
  }
  
  // Handle vehicle update
  function handleVehicleUpdate(vehicleData, eventType) {
    if (!vehicleData || eventType === 'DELETE') return;
    
    // Update vehicle info in the sidebar
    const stats = vehicleData.vehicle_stats || {};
    
    vehicleInfoEl.innerHTML = `
      <div class="info-item">
        <span class="info-label">Name:</span> ${vehicleData.name || 'Vehicle ' + vehicleData.id}
      </div>
      <div class="info-item">
        <span class="info-label">Status:</span> ${vehicleData.status || 'Unknown'}
      </div>
      ${stats ? `
      <div class="info-item">
        <span class="info-label">Uptime:</span> ${stats.uptime_percentage || 0}%
      </div>
      <div class="info-item">
        <span class="info-label">Battery:</span> ${stats.battery_health || 0}%
      </div>
      ` : ''}
    `;
    
    // Update connection status based on vehicle status
    const status = vehicleData.status ? vehicleData.status.toLowerCase() : 'unknown';
    
    if (status === 'online' || status === 'active') {
      setConnectionStatus('online', 'Connected');
    } else if (status === 'offline' || status === 'inactive' || status === 'error') {
      setConnectionStatus('offline', `Vehicle ${status}`);
    } else if (status === 'idle' || status === 'standby') {
      setConnectionStatus('idle', `Vehicle ${status}`);
    } else if (status === 'maintenance') {
      setConnectionStatus('maintenance', 'In maintenance');
    } else {
      setConnectionStatus('connecting', `Vehicle status: ${vehicleData.status || 'unknown'}`);
    }
  }
  
  // Handle pickup point update
  function handlePickupPointUpdate(pickupPointData, eventType) {
    if (!pickupPointData) return;
    
    if (eventType === 'INSERT' || eventType === 'UPDATE') {
      // Check if this pickup point is already in our list
      const existingIndex = pickupPoints.findIndex(p => p.id === pickupPointData.id);
      
      if (existingIndex >= 0) {
        // Update existing pickup point
        pickupPoints[existingIndex] = pickupPointData;
      } else {
        // Add new pickup point
        pickupPoints.push(pickupPointData);
      }
    } else if (eventType === 'DELETE') {
      // Remove the pickup point
      pickupPoints = pickupPoints.filter(p => p.id !== pickupPointData.id);
    }
    
    // Update pickup points on the map
    mapHandler.addPickupPoints(pickupPoints);
    
    // Update pickup point count
    pickupPointsCountEl.textContent = `${pickupPoints.length} pickup points available`;
    
    // Update routes if we have a vehicle position
    mapHandler.showAllRoutes();
  }

  // Load organization details
  async function loadOrganizationData() {
    try {
      const orgData = await window.supabase.getOrganizationDetails(config.organizationId);
      
      if (orgData) {
        organizationInfoEl.innerHTML = `
          <div class="info-item">
            <span class="info-label">Name:</span> ${orgData.name}
          </div>
          <div class="info-item">
            <span class="info-label">ID:</span> ${orgData.id}
          </div>
        `;
      } else {
        organizationInfoEl.innerHTML = '<div class="error">Organization not found</div>';
      }
    } catch (error) {
      console.error('Error loading organization data:', error);
      organizationInfoEl.innerHTML = '<div class="error">Failed to load organization data</div>';
    }
  }

  // Load vehicle details
  async function loadVehicleData() {
    try {
      const vehicleData = await window.supabase.getVehicleDetails(config.vehicleId);
      
      if (vehicleData) {
        const stats = vehicleData.vehicle_stats || {};
        
        vehicleInfoEl.innerHTML = `
          <div class="info-item">
            <span class="info-label">Name:</span> ${vehicleData.name || 'Vehicle ' + vehicleData.id}
          </div>
          <div class="info-item">
            <span class="info-label">Status:</span> ${vehicleData.status || 'Unknown'}
          </div>
          ${stats ? `
          <div class="info-item">
            <span class="info-label">Uptime:</span> ${stats.uptime_percentage || 0}%
          </div>
          <div class="info-item">
            <span class="info-label">Battery:</span> ${stats.battery_health || 0}%
          </div>
          ` : ''}
        `;
        
        // Set initial connection status based on vehicle status
        const status = vehicleData.status ? vehicleData.status.toLowerCase() : 'unknown';
        
        if (status === 'online' || status === 'active') {
          setConnectionStatus('online', 'Connected');
        } else if (status === 'offline' || status === 'inactive' || status === 'error') {
          setConnectionStatus('offline', `Vehicle ${status}`);
        } else if (status === 'idle' || status === 'standby') {
          setConnectionStatus('idle', `Vehicle ${status}`);
        } else if (status === 'maintenance') {
          setConnectionStatus('maintenance', 'In maintenance');
        } else {
          setConnectionStatus('connecting', `Vehicle status: ${vehicleData.status || 'unknown'}`);
        }
      } else {
        vehicleInfoEl.innerHTML = '<div class="error">Vehicle not found</div>';
        setConnectionStatus('offline', 'Vehicle not found');
      }
    } catch (error) {
      console.error('Error loading vehicle data:', error);
      vehicleInfoEl.innerHTML = '<div class="error">Failed to load vehicle data</div>';
      setConnectionStatus('offline', 'Connection error');
    }
  }

  // Load pickup points
  async function loadPickupPoints() {
    try {
      pickupPoints = await window.supabase.getOrganizationPickupPoints(
        config.organizationId,
        config.vehicleId
      );
      
      // Add pickup points to map
      mapHandler.addPickupPoints(pickupPoints);
      
      // Update pickup point count
      pickupPointsCountEl.textContent = `${pickupPoints.length} pickup points available`;
      
      // Display initial route information
      try {
        const initialRouteInfo = await mapHandler.showAllRoutes();
        if (initialRouteInfo) {
          routeInfo = initialRouteInfo;
          displayRouteInfo();
        } else {
          routeInfoEl.innerHTML = '<div class="error">Could not load route information</div>';
        }
      } catch (routeError) {
        console.error('Error showing routes:', routeError);
        routeInfoEl.innerHTML = '<div class="error">Error loading route information</div>';
      }
      
    } catch (error) {
      console.error('Error loading pickup points:', error);
      pickupPointsCountEl.innerHTML = '<div class="error">Failed to load pickup points</div>';
    }
  }

  // Load user images
  async function loadUserImages() {
    try {
      userImagesContainerEl.innerHTML = '<div class="loading">Loading user images...</div>';
      
      userImages = await window.supabase.getUserImagesByOrgAndVehicle(
        config.organizationId,
        config.vehicleId
      );
      
      displayUserImages();
    } catch (error) {
      console.error('Error loading user images:', error);
      userImagesContainerEl.innerHTML = '<div class="error">Failed to load user images</div>';
    }
  }
  
  // Display user images in the grid
  function displayUserImages() {
    if (!userImagesContainerEl) return;
    
    if (!userImages || userImages.length === 0) {
      userImagesContainerEl.innerHTML = `
        <div class="user-image-item empty">
          No user images available
        </div>
      `;
      return;
    }
    
    let imagesHtml = '';
    
    userImages.forEach((imageData, index) => {
      const imageUrl = imageData.image_url;
      // Check if username is available in the data
      const username = imageData.username || imageData.user_name || `User ${index + 1}`;
      
      if (!imageUrl) return;
      
      imagesHtml += `
        <div class="user-image-item" data-index="${index}">
          <div class="user-image-container">
            <img src="${imageUrl}" alt="${username}" loading="lazy" />
          </div>
          <div class="user-image-username">${username}</div>
        </div>
      `;
    });
    
    userImagesContainerEl.innerHTML = imagesHtml || `
      <div class="user-image-item empty">
        No valid user images available
      </div>
    `;
    
    // No click event handlers for images
  }

  // Display route information
  function displayRouteInfo() {
    if (!routeInfoEl) return;
    
    // Get all route details from map handler
    const allRouteDetails = mapHandler.getAllRouteDetails();
    
    if (!allRouteDetails || !allRouteDetails.closest) {
      routeInfoEl.innerHTML = '<div class="error">No route data available</div>';
      return;
    }
    
    // Get the closest and second closest route details
    const closestRoute = allRouteDetails.closest;
    const secondRoute = allRouteDetails.second;
    const sortedPickupPoints = allRouteDetails.sortedPickupPoints;
    
    let routesHtml = '';
    
    // Add closest route info (green)
    if (closestRoute) {
      const closestPoint = sortedPickupPoints && sortedPickupPoints.length > 0 ? 
        sortedPickupPoints[0].point : null;
      
      routesHtml += `
        <div class="route-card closest-route">
          <div class="route-header">
            <span class="route-indicator" style="background-color: #2ecc71;"></span>
            <h3>Closest Route</h3>
          </div>
          <div class="route-body">
            <div class="route-info-item">
              <span class="info-label">Distance:</span> 
              <span class="info-value">${(closestRoute.distance / 1000).toFixed(2)} km</span>
            </div>
            <div class="route-info-item">
              <span class="info-label">Duration:</span> 
              <span class="info-value">${Math.floor(closestRoute.duration / 60)} minutes</span>
            </div>
            ${closestRoute.averageSpeed ? `
            <div class="route-info-item">
              <span class="info-label">Avg Speed:</span> 
              <span class="info-value">${Math.round(closestRoute.averageSpeed)} km/h</span>
            </div>` : ''}
            ${closestRoute.maxspeedInfo ? `
            <div class="route-info-item">
              <span class="info-label">Speed Limit:</span> 
              <span class="info-value">${closestRoute.maxspeedInfo.highest} ${closestRoute.maxspeedInfo.units}</span>
            </div>` : ''}
            ${closestPoint && closestPoint.name ? `
            <div class="route-info-item">
              <span class="info-label">Destination:</span> 
              <span class="info-value">${closestPoint.name}</span>
            </div>` : ''}
          </div>
          ${closestPoint && (closestPoint.user_name || closestPoint.user_email || closestPoint.user_phone) ? `
          <div class="route-user-info">
            <h4>Pickup Point Owner</h4>
            ${closestPoint.user_name ? `<p><strong>Name:</strong> ${closestPoint.user_name}</p>` : ''}
            ${closestPoint.user_email ? `<p><strong>Email:</strong> ${closestPoint.user_email}</p>` : ''}
            ${closestPoint.user_phone ? `<p><strong>Phone:</strong> ${closestPoint.user_phone}</p>` : ''}
          </div>` : ''}
        </div>
      `;
    }
    
    // Add second closest route info (yellow)
    if (secondRoute) {
      const secondPoint = sortedPickupPoints && sortedPickupPoints.length > 1 ? 
        sortedPickupPoints[1].point : null;
      
      routesHtml += `
        <div class="route-card second-route">
          <div class="route-header">
            <span class="route-indicator" style="background-color: #f1c40f;"></span>
            <h3>Second Closest Route</h3>
          </div>
          <div class="route-body">
            <div class="route-info-item">
              <span class="info-label">Distance:</span> 
              <span class="info-value">${(secondRoute.distance / 1000).toFixed(2)} km</span>
            </div>
            <div class="route-info-item">
              <span class="info-label">Duration:</span> 
              <span class="info-value">${Math.floor(secondRoute.duration / 60)} minutes</span>
            </div>
            ${secondPoint && secondPoint.name ? `
            <div class="route-info-item">
              <span class="info-label">Destination:</span> 
              <span class="info-value">${secondPoint.name}</span>
            </div>` : ''}
          </div>
          ${secondPoint && (secondPoint.user_name || secondPoint.user_email || secondPoint.user_phone) ? `
          <div class="route-user-info">
            <h4>Pickup Point Owner</h4>
            ${secondPoint.user_name ? `<p><strong>Name:</strong> ${secondPoint.user_name}</p>` : ''}
            ${secondPoint.user_email ? `<p><strong>Email:</strong> ${secondPoint.user_email}</p>` : ''}
            ${secondPoint.user_phone ? `<p><strong>Phone:</strong> ${secondPoint.user_phone}</p>` : ''}
          </div>` : ''}
        </div>
      `;
    }
    
    // Display other pickup points count
    const otherPointsCount = sortedPickupPoints ? Math.max(0, sortedPickupPoints.length - 2) : 0;
    if (otherPointsCount > 0) {
      routesHtml += `
        <div class="other-routes-info">
          <span class="route-indicator" style="background-color: #95a5a6;"></span>
          <span>${otherPointsCount} other pickup points</span>
        </div>
      `;
    }
    
    routeInfoEl.innerHTML = routesHtml;
  }

  // Setup event listeners
  function setupEventListeners() {
    // Show route details button
    if (showAllRouteDetailsBtn) {
      showAllRouteDetailsBtn.addEventListener('click', () => {
        displayRouteInfo();
      });
    }
    
    // Refresh images button
    if (refreshImagesBtn) {
      refreshImagesBtn.addEventListener('click', () => {
        loadUserImages();
      });
    }
    
    // Reset configuration button
    resetConfigBtn.addEventListener('click', async () => {
      if (confirm('Are you sure you want to reset the device configuration? This will restart the application.')) {
        try {
          await window.electronAPI.resetConfig();
          // Send message to main process to restart the app
          window.electronAPI.restartApp();
        } catch (error) {
          console.error('Error resetting configuration:', error);
          alert('Failed to reset configuration');
        }
      }
    });
    
    // Handle window unload to clean up subscriptions
    window.addEventListener('beforeunload', () => {
      cleanupSubscriptions();
    });
  }
  
  // Clean up subscriptions
  function cleanupSubscriptions() {
    try {
      if (locationSubscription) {
        locationSubscription.unsubscribe();
      }
      
      if (vehicleSubscription) {
        vehicleSubscription.unsubscribe();
      }
      
      if (pickupPointSubscription) {
        pickupPointSubscription.unsubscribe();
      }
      
      console.log('Unsubscribed from all real-time channels');
    } catch (error) {
      console.error('Error cleaning up subscriptions:', error);
    }
  }

  // Set connection status
  function setConnectionStatus(status, message) {
    connectionStatusEl.textContent = message;
    
    // Remove all status classes
    statusIconEl.classList.remove('status-online', 'status-offline', 'status-connecting', 'status-idle', 'status-maintenance');

    let logoText = document.getElementById('logo-text');
    
    
    // Add the appropriate class
    switch (status) {
      case 'online':
        statusIconEl.classList.add('status-online');
        logoText.style.color = 'var(--terminal-green)';
        break;
      case 'offline':
        statusIconEl.classList.add('status-offline');
        logoText.style.color = 'red';
        break;
      case 'idle':
        statusIconEl.classList.add('status-idle');
        logoText.style.color = 'yellow';
        break;
      case 'maintenance':
        statusIconEl.classList.add('status-maintenance');
        logoText.style.color = 'purple';
        break;
      default:
        statusIconEl.classList.add('status-connecting');
    }
  }

  // Initialize the application
  initApp();
});