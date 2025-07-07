// Supabase client for interacting with the database
class SupabaseClient {
  constructor() {
    // Initialize with null values, will be set after loading
    this.supabaseUrl = null;
    this.supabaseKey = null;
    this.client = null;
    
    console.log('SupabaseClient constructor called');
    // Load environment variables and initialize client
    this.init();
  }

  async init() {
    try {
      console.log('SupabaseClient init started');
      
      // Get environment variables from Electron main process
      const envVars = await window.electronAPI.getEnvVars();
      console.log('Environment variables received:', 
        envVars ? 'Variables object exists' : 'No variables received');
      
      // Set Supabase credentials
      this.supabaseUrl = envVars.SUPABASE_URL;
      this.supabaseKey = envVars.SUPABASE_ANON_KEY;
      
      console.log('SUPABASE_URL:', this.supabaseUrl ? 'Value exists' : 'Value is missing');
      console.log('SUPABASE_ANON_KEY:', this.supabaseKey ? 'Value exists' : 'Value is missing');
      
      if (!this.supabaseUrl || !this.supabaseKey) {
        throw new Error('Supabase credentials not found in environment variables');
      }
      
      // Load the Supabase client
      await this.loadSupabaseClient();
      
      console.log('Supabase initialized with environment variables');
    } catch (error) {
      console.error('Failed to initialize Supabase with environment variables:', error);
      alert('Error: Failed to load Supabase credentials. Please check your .env file and restart the application.');
    }
  }

  async loadSupabaseClient() {
    try {
      console.log('Loading Supabase client with URL:', this.supabaseUrl);
      
      // Method 1: Try to load via ESM import first (more reliable)
      try {
        console.log('Attempting to load Supabase via ESM...');
        const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
        this.client = createClient(this.supabaseUrl, this.supabaseKey);
        console.log('Supabase client initialized via ESM');
        return;
      } catch (esmError) {
        console.warn('ESM loading failed, trying alternative methods:', esmError);
      }
      
      // Method 2: Check if Supabase is loaded via UMD/script tag
      if (typeof window.supabase !== 'undefined' && window.supabase.createClient) {
        console.log('Attempting to load Supabase via global object...');
        this.client = window.supabase.createClient(this.supabaseUrl, this.supabaseKey);
        console.log('Supabase client initialized via global object');
        return;
      }
      
      // Method 3: Check for different global variable names
      const possibleGlobals = ['supabase', 'Supabase', 'SUPABASE'];
      for (const globalName of possibleGlobals) {
        if (typeof window[globalName] !== 'undefined') {
          console.log(`Found global ${globalName}, checking for createClient...`);
          
          // Check if it has createClient method
          if (window[globalName].createClient) {
            this.client = window[globalName].createClient(this.supabaseUrl, this.supabaseKey);
            console.log(`Supabase client initialized via global ${globalName}`);
            return;
          }
          
          // Check if it's a nested object
          if (window[globalName].supabase && window[globalName].supabase.createClient) {
            this.client = window[globalName].supabase.createClient(this.supabaseUrl, this.supabaseKey);
            console.log(`Supabase client initialized via global ${globalName}.supabase`);
            return;
          }
        }
      }
      
      // Method 4: Try dynamic script loading as last resort
      console.log('Attempting dynamic script loading...');
      await this.loadSupabaseScript();
      
    } catch (error) {
      console.error('Failed to initialize Supabase client:', error);
      throw error;
    }
  }

  async loadSupabaseScript() {
    return new Promise((resolve, reject) => {
      // Remove any existing Supabase script
      const existingScript = document.querySelector('script[src*="supabase"]');
      if (existingScript) {
        existingScript.remove();
      }

      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
      script.onload = () => {
        console.log('Supabase script loaded dynamically');
        
        // Try different ways to access the library
        let createClient = null;
        
        if (window.supabase && window.supabase.createClient) {
          createClient = window.supabase.createClient;
        } else if (window.Supabase && window.Supabase.createClient) {
          createClient = window.Supabase.createClient;
        } else if (typeof createClient === 'undefined' && window.supabaseCreateClient) {
          createClient = window.supabaseCreateClient;
        }
        
        if (createClient) {
          try {
            this.client = createClient(this.supabaseUrl, this.supabaseKey);
            console.log('Supabase client initialized via dynamic script loading');
            resolve();
          } catch (err) {
            console.error('Error creating client with dynamic script:', err);
            reject(err);
          }
        } else {
          console.error('createClient function not found after dynamic loading');
          console.log('Available globals:', Object.keys(window).filter(key => key.toLowerCase().includes('supabase')));
          reject(new Error('createClient function not available'));
        }
      };
      
      script.onerror = (error) => {
        console.error('Failed to load Supabase script dynamically:', error);
        reject(error);
      };
      
      document.head.appendChild(script);
    });
  }

  // Add a method to check if client is ready
  isClientReady() {
    return this.client !== null;
  }

  // Add a method to wait for client to be ready
  async waitForClient(timeout = 10000) {
    const startTime = Date.now();
    while (!this.isClientReady() && (Date.now() - startTime) < timeout) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    if (!this.isClientReady()) {
      throw new Error('Supabase client failed to initialize within timeout period');
    }
    
    return this.client;
  }

  // Test the connection
  async testConnection() {
    if (!this.client) {
      return { connected: false, error: 'Client not initialized' };
    }

    try {
      // Try a simple query to test the connection
      const { data, error } = await this.client
        .from('organizations')
        .select('id')
        .limit(1);

      if (error) {
        return { connected: false, error: error.message };
      }

      return { connected: true, data };
    } catch (error) {
      return { connected: false, error: error.message };
    }
  }

  async getOrganizationDetails(orgId) {
    if (!this.client) {
      console.error('Supabase client not initialized');
      return null;
    }

    try {
      const { data, error } = await this.client
        .from('organizations')
        .select('*')
        .eq('id', orgId)
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error fetching organization details:', error);
      return null;
    }
  }

  async getVehicleDetails(vehicleId) {
    if (!this.client) {
      console.error('Supabase client not initialized');
      return null;
    }

    try {
      const { data, error } = await this.client
        .from('vehicles')
        .select('*, vehicle_stats(*)')
        .eq('id', vehicleId)
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error fetching vehicle details:', error);
      return null;
    }
  }

  async getVehicleLocation(vehicleId) {
    if (!this.client) {
      console.error('Supabase client not initialized');
      return null;
    }

    try {
      const { data, error } = await this.client
        .from('location_data')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error fetching vehicle location:', error);
      return null;
    }
  }

  async getOrganizationPickupPoints(orgId, vehicleId) {
    if (!this.client) {
      console.error('Supabase client not initialized');
      return [];
    }

    try {
      // Use the existing function that works
      const { data, error } = await this.client
        .rpc('get_organization_pickup_points', {
          p_org_id: orgId,
          p_vehicle_id: vehicleId
        });

      if (error) throw error;
      
      // If we have data and user_id fields, enrich with user details
      if (data && data.length > 0) {
        // Check if any pickup points have user_id field
        const hasUserIds = data.some(point => point.user_id);
        
        if (hasUserIds) {
          // Get unique user IDs
          const userIds = [...new Set(data.filter(point => point.user_id).map(point => point.user_id))];
          
          // Fetch user details for each user ID
          const userDetails = {};
          await Promise.all(userIds.map(async (userId) => {
            try {
              const userData = await this.getUserDetails(userId);
              if (userData) {
                userDetails[userId] = userData;
              }
            } catch (err) {
              console.warn(`Could not fetch details for user ${userId}:`, err);
            }
          }));
          
          // Enrich pickup points with user details
          return data.map(point => {
            if (point.user_id && userDetails[point.user_id]) {
              const user = userDetails[point.user_id];
              return {
                ...point,
                user_name: user.name || user.full_name || user.display_name,
                user_email: user.email,
                user_phone: user.phone
              };
            }
            return point;
          });
        }
      }
      
      return data || [];
    } catch (error) {
      console.error('Error fetching pickup points:', error);
      return [];
    }
  }

  // Subscribe to real-time changes in the vehicle's location
  subscribeToLocationUpdates(vehicleId, callback) {
    if (!this.client) {
      console.error('Supabase client not initialized');
      return null;
    }

    console.log(`Setting up location subscription for vehicle ${vehicleId}`);
    
    const channel = this.client
      .channel(`location_updates:${vehicleId}`)
      .on(
        'postgres_changes',
        {
          event: '*', // Listen for all events (INSERT, UPDATE, DELETE)
          schema: 'public',
          table: 'location_data',
          filter: `vehicle_id=eq.${vehicleId}`
        },
        (payload) => {
          console.log('Location data received via subscription:', payload);
          callback(payload.new || payload.old, payload.eventType);
        }
      )
      .subscribe((status) => {
        console.log(`Location subscription status: ${status}`);
      });
    
    return channel;
  }
  
  // Subscribe to real-time changes in vehicle status
  subscribeToVehicleUpdates(vehicleId, callback) {
    if (!this.client) {
      console.error('Supabase client not initialized');
      return null;
    }

    console.log(`Setting up vehicle subscription for vehicle ${vehicleId}`);
    
    const channel = this.client
      .channel(`vehicle_updates:${vehicleId}`)
      .on(
        'postgres_changes',
        {
          event: '*', // Listen for all events (INSERT, UPDATE, DELETE)
          schema: 'public',
          table: 'vehicles',
          filter: `id=eq.${vehicleId}`
        },
        (payload) => {
          console.log('Vehicle data received via subscription:', payload);
          callback(payload.new || payload.old, payload.eventType);
        }
      )
      .subscribe((status) => {
        console.log(`Vehicle subscription status: ${status}`);
      });
    
    return channel;
  }
  
  // Subscribe to real-time changes in pickup points for an organization
  subscribeToPickupPointUpdates(orgId, callback) {
    if (!this.client) {
      console.error('Supabase client not initialized');
      return null;
    }

    console.log(`Setting up pickup point subscription for organization ${orgId}`);
    
    const channel = this.client
      .channel(`pickup_point_updates:${orgId}`)
      .on(
        'postgres_changes',
        {
          event: '*', // Listen for all events (INSERT, UPDATE, DELETE)
          schema: 'public',
          table: 'pickup_points'
          // Note: We can't filter by org_id directly since pickup_points doesn't have that field
          // The filtering will be done in the callback based on the organization's vehicles
        },
        async (payload) => {
          console.log('Pickup point data received via subscription:', payload);
          
          // If this is a new or updated pickup point, enrich with user details
          let pickupPoint = payload.new || payload.old;
          
          if (pickupPoint && pickupPoint.user_id && payload.eventType !== 'DELETE') {
            try {
              const userData = await this.getUserDetails(pickupPoint.user_id);
              if (userData) {
                pickupPoint = {
                  ...pickupPoint,
                  user_name: userData.name || userData.full_name || userData.display_name,
                  user_email: userData.email,
                  user_phone: userData.phone
                };
              }
            } catch (err) {
              console.warn(`Could not fetch details for user ${pickupPoint.user_id}:`, err);
            }
          }
          
          callback(pickupPoint, payload.eventType);
        }
      )
      .subscribe((status) => {
        console.log(`Pickup point subscription status: ${status}`);
      });
    
    return channel;
  }
  
  // Get user details by user ID
  async getUserDetails(userId) {
    if (!this.client) {
      console.error('Supabase client not initialized');
      return null;
    }

    try {
      const { data, error } = await this.client
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error fetching user details:', error);
      return null;
    }
  }
  
  // Get organization settings
  async getOrganizationSettings(orgId) {
    if (!this.client) {
      console.error('Supabase client not initialized');
      return null;
    }

    try {
      const { data, error } = await this.client
        .from('organization_settings')
        .select('*')
        .eq('organization_id', orgId)
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error fetching organization settings:', error);
      return null;
    }
  }
  
  // Check if facial recognition is enabled for an organization
  async isFacialRecognitionEnabled(orgId) {
    try {
      const settings = await this.getOrganizationSettings(orgId);
      return settings ? settings.facial_recognition_enabled : false;
    } catch (error) {
      console.error('Error checking facial recognition status:', error);
      return false;
    }
  }

  // Get user images by organization and vehicle
  async getUserImagesByOrgAndVehicle(orgId, vehicleId) {
    if (!this.client) {
      console.error('Supabase client not initialized');
      return [];
    }

    try {
      const { data, error } = await this.client
        .rpc('get_user_images_by_org_and_vehicle', {
          input_org_id: orgId,
          input_vehicle_id: vehicleId
        });

      if (error) throw error;
      
      // Log the data structure to help with debugging
      console.log('User images data:', data);
      
      return data || [];
    } catch (error) {
      console.error('Error fetching user images:', error);
      return [];
    }
  }

  // Start route for a vehicle
  async startRoute(vehicleId) {
    if (!this.client) {
      console.error('Supabase client not initialized');
      return { success: false, error: 'Database not connected' };
    }

    try {
      const { data, error } = await this.client
        .from('vehicles')
        .update({ route_started: true })
        .eq('id', vehicleId)
        .select();

      if (error) throw error;
      
      console.log('Route started for vehicle:', vehicleId);
      return { success: true, data: data };
    } catch (error) {
      console.error('Error starting route:', error);
      return { success: false, error: error.message };
    }
  }

  // Stop route for a vehicle
  async stopRoute(vehicleId) {
    if (!this.client) {
      console.error('Supabase client not initialized');
      return { success: false, error: 'Database not connected' };
    }

    try {
      const { data, error } = await this.client
        .from('vehicles')
        .update({ route_started: false })
        .eq('id', vehicleId)
        .select();

      if (error) throw error;
      
      console.log('Route stopped for vehicle:', vehicleId);
      return { success: true, data: data };
    } catch (error) {
      console.error('Error stopping route:', error);
      return { success: false, error: error.message };
    }
  }

  // Send emergency alert
  async sendEmergencyAlert(vehicleId, organizationId, emergencyType) {
    try {
      const response = await fetch('https://knmhbgyxtpecuftjuheq.supabase.co/functions/v1/emergency-alert', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer amen',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          vehicleId: vehicleId,
          organizationId: organizationId,
          emergencyType: emergencyType
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log('Emergency alert sent successfully:', data);
      return { success: true, data };
    } catch (error) {
      console.error('Error sending emergency alert:', error);
      return { success: false, error: error.message };
    }
  }

  // User Verification API Methods
  
  // Create or update user verification record (UPDATED FOR NEW SCHEMA)
  async createUserVerification(verificationData) {
    if (!this.client) {
      console.error('Supabase client not initialized');
      return { success: false, error: 'Database not connected' };
    }

    try {
      const username = verificationData.verificationData?.person_name;
      console.log('🟣 Processing verification for:', username);
      
      // Step 1: Check if verification already exists by username
      const { data: existingVerification, error: checkError } = await this.client
        .from('user_verification')
        .select('*')
        .eq('username', username)
        .eq('org_id', verificationData.organizationId)
        .eq('vehicle_id', verificationData.vehicleId)
        .limit(1);
      
      let result;
      
      if (existingVerification && existingVerification.length > 0) {
        // Update existing verification
        console.log('🟣 Updating existing verification for:', username);
        const { data, error } = await this.client
          .from('user_verification')
          .update({
            is_verified: true,
            verified_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', existingVerification[0].id)
          .select()
          .single();
          
        if (error) throw error;
        result = data;
        console.log('🟣 Updated verification record');
      } else {
        // Create new verification
        console.log('🟣 Creating new verification for:', username);
        const { data, error } = await this.client
          .from('user_verification')
          .insert({
            username: username,
            org_id: verificationData.organizationId,
            vehicle_id: verificationData.vehicleId,
            is_verified: true,
            verified_at: new Date().toISOString()
          })
          .select()
          .single();
          
        if (error) throw error;
        result = data;
        console.log('🟣 Created new verification record');
      }

      return { success: true, data: result };
    } catch (error) {
      console.error('🔴 Error in createUserVerification:', error);
      return { success: false, error: error.message };
    }
  }

  // Check if a user is already verified for a specific organization/vehicle
  async getUserVerificationStatus(username, organizationId, vehicleId) {
    if (!this.client) {
      console.error('Supabase client not initialized');
      return { success: false, error: 'Database not connected' };
    }

    try {
      const { data, error } = await this.client
        .from('user_verification')
        .select('*')
        .eq('username', username)
        .eq('org_id', organizationId)
        .eq('vehicle_id', vehicleId)
        .eq('is_verified', true)
        .order('verified_at', { ascending: false })
        .limit(1);

      if (error) throw error;

      const isVerified = data && data.length > 0;
      const verificationRecord = isVerified ? data[0] : null;

      return { 
        success: true, 
        isVerified,
        verificationRecord,
        data: verificationRecord
      };
    } catch (error) {
      console.error('Error checking user verification status:', error);
      return { success: false, error: error.message };
    }
  }

  // Get all verification records for users in an organization
  async getOrganizationVerifications(organizationId, vehicleId = null) {
    if (!this.client) {
      console.error('Supabase client not initialized');
      return { success: false, error: 'Database not connected' };
    }

    try {
      let query = this.client
        .from('user_verification')
        .select('*')
        .eq('org_id', organizationId)
        .eq('is_verified', true);

      // If vehicle is specified, filter by it
      if (vehicleId) {
        query = query.eq('vehicle_id', vehicleId);
      }

      const { data, error } = await query
        .order('verified_at', { ascending: false });

      if (error) throw error;

      console.log('Organization verification records:', data);
      return { success: true, data: data || [] };
    } catch (error) {
      console.error('Error fetching organization verifications:', error);
      return { success: false, error: error.message };
    }
  }

  // Get user ID by username
  async getUserIdByUsername(username) {
    if (!this.client) {
      console.error('Supabase client not initialized');
      return { success: false, error: 'Database not connected' };
    }

    try {
      const { data, error } = await this.client
        .from('users')
        .select('id')
        .eq('username', username)
        .single();

      if (error) {
        // If user not found, try searching by name field
        const { data: nameData, error: nameError } = await this.client
          .from('users')
          .select('id')
          .ilike('name', username)
          .limit(1)
          .single();

        if (nameError) {
          console.log(`User not found for username: ${username}`);
          return { success: false, error: 'User not found' };
        }

        return { success: true, data: nameData.id };
      }

      return { success: true, data: data.id };
    } catch (error) {
      console.error('Error getting user ID by username:', error);
      return { success: false, error: error.message };
    }
  }

  // Call user verification edge function
  async callUserVerificationEdgeFunction(userId) {
    try {
      const response = await fetch('https://knmhbgyxtpecuftjuheq.supabase.co/functions/v1/user-verification', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer amen',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: userId
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log('User verification edge function called successfully:', data);
      return { success: true, data };
    } catch (error) {
      console.error('Error calling user verification edge function:', error);
      return { success: false, error: error.message };
    }
  }
}

// Export a singleton instance
const supabaseClient = new SupabaseClient();

// Make it available globally
window.supabase = supabaseClient;