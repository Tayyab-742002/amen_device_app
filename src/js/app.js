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
  const downloadImagesBtn = document.getElementById('download-images');
  const verifyUserBtn = document.getElementById('verify-user');
  const startRouteBtn = document.getElementById('start-route');

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

      // Test the connection
      console.log('Testing Supabase connection...');
      const connectionTest = await window.supabase.testConnection();
      if (!connectionTest.connected) {
        console.error('Supabase connection test failed:', connectionTest.error);
        throw new Error(`Database connection failed: ${connectionTest.error}`);
      }
      console.log('Supabase connection test passed');

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
      console.log('Setting up real-time subscriptions...');
      
      // Clean up existing subscriptions first
      cleanupSubscriptions();
      
      // Subscribe to location updates
      console.log(`Subscribing to location updates for vehicle ${config.vehicleId}`);
      locationSubscription = window.supabase.subscribeToLocationUpdates(
        config.vehicleId,
        handleLocationUpdate
      );
      
      // Subscribe to vehicle status updates
      console.log(`Subscribing to vehicle updates for vehicle ${config.vehicleId}`);
      vehicleSubscription = window.supabase.subscribeToVehicleUpdates(
        config.vehicleId,
        handleVehicleUpdate
      );
      
      // Subscribe to pickup point updates
      console.log(`Subscribing to pickup point updates for organization ${config.organizationId}`);
      pickupPointSubscription = window.supabase.subscribeToPickupPointUpdates(
        config.organizationId,
        handlePickupPointUpdate
      );
      
      // Check subscription status
      if (locationSubscription && vehicleSubscription && pickupPointSubscription) {
        console.log('All subscriptions set up successfully');
        setConnectionStatus('connecting', 'Connecting to vehicle...');
        
        // Set up periodic connection check
        setupConnectionCheck();
      } else {
        console.error('Failed to set up one or more subscriptions');
        setConnectionStatus('offline', 'Failed to connect');
      }
    } catch (error) {
      console.error('Error setting up real-time subscriptions:', error);
      setConnectionStatus('offline', 'Disconnected');
    }
  }

  // Handle location update
  function handleLocationUpdate(locationData, eventType) {
    console.log('Location update received:', locationData, eventType);
    
    if (!locationData || eventType === 'DELETE') return;
    
    // Update coordinates display
    latitudeEl.textContent = locationData.latitude.toFixed(6);
    longitudeEl.textContent = locationData.longitude.toFixed(6);
    speedEl.textContent = locationData.speed ? locationData.speed.toFixed(1) : '0.0';
    
    // Update vehicle marker on map
    mapHandler.updateVehiclePosition(locationData.longitude, locationData.latitude);
    
    // Only update routes if location has changed significantly (more than 10 meters)
    const currentLocation = { lat: locationData.latitude, lng: locationData.longitude };
    if (shouldUpdateRoutes(currentLocation)) {
      // Debounce route updates to prevent excessive API calls
      clearTimeout(window.routeUpdateTimeout);
      window.routeUpdateTimeout = setTimeout(() => {
        mapHandler.updateRoutesSmooth();
      }, 2000); // Wait 2 seconds before updating routes
    }
    
    // Update last location update time
    window.lastLocationUpdate = Date.now();
  }
  
  // Handle vehicle update
  function handleVehicleUpdate(vehicleData, eventType) {
    console.log('Vehicle update received:', vehicleData, eventType);
    
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
    
    // Update start route button based on route_started status
    updateStartRouteButton(vehicleData.route_started);
    
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
    
    // Update last vehicle update time
    window.lastVehicleUpdate = Date.now();
  }
  
  // Handle pickup point update
  function handlePickupPointUpdate(pickupPointData, eventType) {
    console.log('Pickup point update received:', pickupPointData, eventType);
    
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
    
    // Debounce route updates for pickup point changes
    clearTimeout(window.pickupRouteUpdateTimeout);
    window.pickupRouteUpdateTimeout = setTimeout(() => {
      mapHandler.updateRoutesSmooth();
    }, 1000); // Wait 1 second before updating routes
    
    // Update last pickup point update time
    window.lastPickupPointUpdate = Date.now();
  }

  // Set up periodic connection check
  function setupConnectionCheck() {
    // Initialize update timestamps
    window.lastLocationUpdate = Date.now();
    window.lastVehicleUpdate = Date.now();
    window.lastPickupPointUpdate = Date.now();
    
    // Check connection every 30 seconds
    setInterval(() => {
      const now = Date.now();
      const locationAge = now - (window.lastLocationUpdate || 0);
      const vehicleAge = now - (window.lastVehicleUpdate || 0);
      
      // If we haven't received updates for more than 2 minutes, try to reconnect
      if (locationAge > 120000 || vehicleAge > 120000) {
        console.log('Connection seems stale, attempting to reconnect...');
        reconnectRealTime();
      }
    }, 30000);
  }

  // Reconnect real-time subscriptions
  function reconnectRealTime() {
    console.log('Reconnecting real-time subscriptions...');
    setConnectionStatus('connecting', 'Reconnecting...');
    
    // Clean up existing subscriptions
    cleanupSubscriptions();
    
    // Wait a moment then reconnect
    setTimeout(() => {
      setupRealTimeSubscriptions();
    }, 1000);
  }

  // Check if routes should be updated based on location change
  function shouldUpdateRoutes(newLocation) {
    if (!window.lastKnownLocation) {
      window.lastKnownLocation = newLocation;
      return true;
    }
    
    // Calculate distance moved since last route update
    const distance = calculateDistance(
      window.lastKnownLocation.lat, 
      window.lastKnownLocation.lng,
      newLocation.lat, 
      newLocation.lng
    );
    
    // Only update if moved more than 10 meters
    if (distance > 0.01) { // 0.01 km = 10 meters
      window.lastKnownLocation = newLocation;
      return true;
    }
    
    return false;
  }

  // Calculate distance between two points (in km)
  function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radius of the earth in km
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * 
      Math.sin(dLon/2) * Math.sin(dLon/2); 
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
    const d = R * c; // Distance in km
    return d;
  }

  function deg2rad(deg) {
    return deg * (Math.PI/180);
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
        
        // Update start route button based on route_started status
        updateStartRouteButton(vehicleData.route_started);
        
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
    // Reset configuration
    resetConfigBtn.addEventListener('click', async () => {
      if (confirm('Are you sure you want to reset the device configuration? This will log you out.')) {
        await window.electronAPI.resetConfig();
        window.electronAPI.restartApp();
      }
    });
    
    // Show all routes details
    showAllRouteDetailsBtn.addEventListener('click', async () => {
      console.log('Refreshing routes and location...');
      
      // Force refresh location data
      try {
        const locationData = await window.supabase.getVehicleLocation(config.vehicleId);
        if (locationData) {
          handleLocationUpdate(locationData, 'UPDATE');
        }
      } catch (error) {
        console.error('Error refreshing location:', error);
      }
      
      // Force refresh vehicle data
      try {
        const vehicleData = await window.supabase.getVehicleDetails(config.vehicleId);
        if (vehicleData) {
          handleVehicleUpdate(vehicleData, 'UPDATE');
        }
      } catch (error) {
        console.error('Error refreshing vehicle data:', error);
      }
      
      // Force refresh pickup points
      try {
        const newPickupPoints = await window.supabase.getOrganizationPickupPoints(
          config.organizationId,
          config.vehicleId
        );
        if (newPickupPoints) {
          pickupPoints = newPickupPoints;
          mapHandler.addPickupPoints(pickupPoints);
          pickupPointsCountEl.textContent = `${pickupPoints.length} pickup points available`;
        }
      } catch (error) {
        console.error('Error refreshing pickup points:', error);
      }
      
      // Update routes smoothly
      mapHandler.updateRoutesSmooth();
      
      showNotification('Routes and location refreshed', 'success');
    });
    
    // Refresh images
    refreshImagesBtn.addEventListener('click', () => {
      loadUserImages();
    });
    
    // Download images
    downloadImagesBtn.addEventListener('click', () => {
      downloadUserImages();
    });
    
    // Verify user
    verifyUserBtn.addEventListener('click', async () => {
      try {
        // Disable the button during verification
        verifyUserBtn.disabled = true;
        verifyUserBtn.textContent = 'Verifying...';
        
        // Show a notification that verification is starting
        showNotification('Starting face verification...', 'info');
        
        // Run the face verification process
        const result = await window.electronAPI.runFaceVerification();
        
        if (result && result.success) {
          // Update UI to show verified user
          showNotification(`User verified: ${result.person_name} (${result.confidence.toFixed(1)}%)`, 'success');
          
          // Mark the user as verified in the UI
          markUserAsVerified(result.person_name);
        } else {
          // Show error notification
          showNotification(result.error || 'Verification failed or was cancelled', 'error');
        }
      } catch (error) {
        console.error('Error during face verification:', error);
        showNotification(`Error: ${error.message}`, 'error');
      } finally {
        // Re-enable the button
        verifyUserBtn.disabled = false;
        verifyUserBtn.textContent = 'User Verification';
      }
    });
    
    // Start/Stop route toggle
    startRouteBtn.addEventListener('click', async () => {
      try {
        // Check current button state to determine action
        const isRouteActive = startRouteBtn.classList.contains('btn-success');
        
        // Disable the button during the operation
        startRouteBtn.disabled = true;
        
        if (isRouteActive) {
          // Stop the route
          startRouteBtn.textContent = 'Stopping...';
          showNotification('Stopping route...', 'info');
          
          const result = await window.supabase.stopRoute(config.vehicleId);
          
          if (result && result.success) {
            showNotification('Route stopped successfully!', 'success');
            // The updateStartRouteButton function will be called via real-time update
          } else {
            showNotification(result.error || 'Failed to stop route', 'error');
            startRouteBtn.disabled = false;
            startRouteBtn.textContent = 'Stop Route';
          }
        } else {
          // Start the route
          startRouteBtn.textContent = 'Starting...';
          showNotification('Starting route...', 'info');
          
          const result = await window.supabase.startRoute(config.vehicleId);
          
          if (result && result.success) {
            showNotification('Route started successfully!', 'success');
            // The updateStartRouteButton function will be called via real-time update
          } else {
            showNotification(result.error || 'Failed to start route', 'error');
            startRouteBtn.disabled = false;
            startRouteBtn.textContent = 'Start Route';
          }
        }
      } catch (error) {
        console.error('Error toggling route:', error);
        showNotification(`Error: ${error.message}`, 'error');
        startRouteBtn.disabled = false;
        
        // Reset button text based on current state
        const isRouteActive = startRouteBtn.classList.contains('btn-success');
        startRouteBtn.textContent = isRouteActive ? 'Stop Route' : 'Start Route';
      }
    });
    
    // Emergency alert button
    const emergencyBtn = document.getElementById('emergency-alert');
    const emergencyModal = document.getElementById('emergency-modal');
    const closeModal = document.querySelector('.close-modal');
    const emergencyButtons = document.querySelectorAll('.emergency-btn');
    
    // Open emergency modal
    emergencyBtn.addEventListener('click', () => {
      emergencyModal.style.display = 'block';
    });
    
    // Close emergency modal
    closeModal.addEventListener('click', () => {
      emergencyModal.style.display = 'none';
    });
    
    // Close modal when clicking outside
    emergencyModal.addEventListener('click', (e) => {
      if (e.target === emergencyModal) {
        emergencyModal.style.display = 'none';
      }
    });
    
    // Handle emergency button clicks
    emergencyButtons.forEach(button => {
      button.addEventListener('click', async () => {
        const emergencyType = button.getAttribute('data-type');
        
        try {
          // Disable all emergency buttons during the operation
          emergencyButtons.forEach(btn => {
            btn.disabled = true;
            btn.classList.add('loading');
          });
          
          showNotification(`Sending ${emergencyType} alert...`, 'info');
          
          // Send emergency alert via Supabase
          const result = await window.supabase.sendEmergencyAlert(
            config.vehicleId,
            config.organizationId,
            emergencyType
          );
          
          if (result && result.success) {
            showNotification(`${emergencyType.charAt(0).toUpperCase() + emergencyType.slice(1)} alert sent successfully!`, 'success');
            
            // Close the modal after successful alert
            emergencyModal.style.display = 'none';
          } else {
            showNotification(result.error || 'Failed to send emergency alert', 'error');
          }
        } catch (error) {
          console.error('Error sending emergency alert:', error);
          showNotification(`Error: ${error.message}`, 'error');
        } finally {
          // Re-enable all emergency buttons
          emergencyButtons.forEach(btn => {
            btn.disabled = false;
            btn.classList.remove('loading');
          });
        }
      });
    });

    // Clean up subscriptions when the window is closed
    window.addEventListener('beforeunload', () => {
      cleanupSubscriptions();
    });
  }
  
  // Download user images
  async function downloadUserImages() {
    if (!userImages || userImages.length === 0) {
      alert('No user images available to download.');
      return;
    }
    
    try {
      downloadImagesBtn.disabled = true;
      downloadImagesBtn.textContent = 'Downloading...';
      
      // Create status element for feedback
      const statusEl = document.createElement('div');
      statusEl.className = 'download-status';
      statusEl.textContent = 'Preparing to download images...';
      userImagesContainerEl.parentNode.insertBefore(statusEl, userImagesContainerEl.nextSibling);
      
      // Track progress
      let downloaded = 0;
      let failed = 0;
      const total = userImages.length;
      let folderPath = '';
      
      // Process each image
      for (const userImage of userImages) {
        if (!userImage.image_url || !userImage.username) {
          failed++;
          continue;
        }
        
        try {
          // Update status
          statusEl.textContent = `Downloading image ${downloaded + failed + 1} of ${total}...`;
          
          // Determine file extension from URL
          let fileExtension = '.jpg'; // Default extension
          if (userImage.image_url.includes('.')) {
            const urlParts = userImage.image_url.split('.');
            const extension = urlParts[urlParts.length - 1].split('?')[0].toLowerCase();
            if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(extension)) {
              fileExtension = '.' + extension;
            }
          }
          
          // Create a safe filename from username (remove invalid characters)
          const safeUsername = userImage.username.replace(/[^\w\s.-]/gi, '_');
          
          // Use IPC to download the image to the Reference_images folder
          const result = await window.electronAPI.downloadImage({
            url: userImage.image_url,
            username: safeUsername,
            extension: fileExtension
          });
          
          if (result.success) {
            downloaded++;
            statusEl.textContent = `Downloaded ${downloaded} of ${total} images...`;
            
            // Save the folder path for display
            if (!folderPath && result.folderPath) {
              folderPath = result.folderPath;
            }
          } else {
            throw new Error(result.error || 'Failed to download image');
          }
          
        } catch (imageError) {
          console.error(`Failed to download image for ${userImage.username}:`, imageError);
          failed++;
          statusEl.textContent = `Error downloading image for ${userImage.username}...`;
        }
      }
      
      // Final status update
      if (failed > 0) {
        statusEl.textContent = `Completed: Downloaded ${downloaded} images to Reference_images folder. ${failed} images failed.`;
        statusEl.style.color = 'var(--warning-color)';
      } else {
        statusEl.textContent = `Successfully downloaded all ${downloaded} images to Reference_images folder!`;
        statusEl.style.color = 'var(--success-color)';
      }
      
      // Show the path where images were saved
      if (folderPath) {
        const pathEl = document.createElement('div');
        pathEl.className = 'download-path';
        pathEl.textContent = `Images saved to: ${folderPath}`;
        statusEl.parentNode.insertBefore(pathEl, statusEl.nextSibling);
        
        // Remove path element after a delay
        setTimeout(() => {
          if (pathEl.parentNode) {
            pathEl.parentNode.removeChild(pathEl);
          }
        }, 10000);
      }
      
      // Remove status element after a delay
      setTimeout(() => {
        if (statusEl.parentNode) {
          statusEl.parentNode.removeChild(statusEl);
        }
      }, 5000);
      
    } catch (error) {
      console.error('Error downloading user images:', error);
      alert('Failed to download user images. See console for details.');
    } finally {
      downloadImagesBtn.disabled = false;
      downloadImagesBtn.textContent = 'Download Images';
    }
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

  // Update start route button based on route status
  function updateStartRouteButton(routeStarted) {
    if (!startRouteBtn) return;
    
    if (routeStarted) {
      startRouteBtn.textContent = 'Stop Route';
      startRouteBtn.classList.remove('btn-primary');
      startRouteBtn.classList.add('btn-success');
      startRouteBtn.disabled = false;
      startRouteBtn.title = 'Click to stop the current route';
    } else {
      startRouteBtn.textContent = 'Start Route';
      startRouteBtn.classList.remove('btn-success');
      startRouteBtn.classList.add('btn-primary');
      startRouteBtn.disabled = false;
      startRouteBtn.title = 'Click to start a new route';
    }
  }

  // Show a notification to the user
  function showNotification(message, type = 'info') {
    // Create notification element if it doesn't exist
    let notificationEl = document.getElementById('notification');
    if (!notificationEl) {
      notificationEl = document.createElement('div');
      notificationEl.id = 'notification';
      document.body.appendChild(notificationEl);
    }
    
    // Set notification content and type
    notificationEl.textContent = message;
    notificationEl.className = `notification ${type}`;
    
    // Show notification
    notificationEl.style.display = 'block';
    
    // Hide after 5 seconds
    setTimeout(() => {
      notificationEl.style.display = 'none';
    }, 5000);
  }
  
  // Mark a user as verified in the UI
  function markUserAsVerified(username) {
    // Find the user image element
    const userImages = document.querySelectorAll('.user-image-item');
    
    userImages.forEach(userImage => {
      const usernameEl = userImage.querySelector('.user-image-username');
      if (usernameEl && usernameEl.textContent.includes(username)) {
        // Add verified class to the user image
        userImage.classList.add('verified');
        
        // Add verified badge if it doesn't exist
        if (!userImage.querySelector('.verified-badge')) {
          const badge = document.createElement('div');
          badge.className = 'verified-badge';
          badge.innerHTML = '✓';
          userImage.appendChild(badge);
        }
      }
    });
  }

  // Initialize the application
  initApp();
});