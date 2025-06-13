// Supabase client for interacting with the database
class SupabaseClient {
  constructor() {
    // Supabase project URL and anon key - these should be replaced with your actual values
    this.supabaseUrl = 'https://knmhbgyxtpecuftjuheq.supabase.co';
    this.supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtubWhiZ3l4dHBlY3VmdGp1aGVxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDEyMDI5NDUsImV4cCI6MjA1Njc3ODk0NX0.033Si351z1WxyiPUDBUaM_MAHGCjeqiDHGrI7LtWI_Q';
    
    // Load the Supabase JS client
    this.loadSupabaseClient();
  }

  async loadSupabaseClient() {
    try {
      // Check if Supabase is already loaded from UMD
      if (typeof supabase !== 'undefined') {
        this.client = supabase.createClient(this.supabaseUrl, this.supabaseKey);
        console.log('Supabase client initialized via UMD');
        return;
      }
      
      // Otherwise try to load it as ESM
      try {
        const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
        this.client = createClient(this.supabaseUrl, this.supabaseKey);
        console.log('Supabase client initialized via ESM');
      } catch (esmError) {
        console.error('Failed to load Supabase client via ESM:', esmError);
        throw esmError;
      }
    } catch (error) {
      console.error('Failed to initialize Supabase client:', error);
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

    return this.client
      .channel(`location_updates:${vehicleId}`)
      .on(
        'postgres_changes',
        {
          event: '*', // Listen for all events (INSERT, UPDATE, DELETE)
          schema: 'public',
          table: 'location_data',
          filter: `vehicle_id=eq.${vehicleId}`
        },
        (payload) => callback(payload.new || payload.old, payload.eventType)
      )
      .subscribe();
  }
  
  // Subscribe to real-time changes in vehicle status
  subscribeToVehicleUpdates(vehicleId, callback) {
    if (!this.client) {
      console.error('Supabase client not initialized');
      return null;
    }

    return this.client
      .channel(`vehicle_updates:${vehicleId}`)
      .on(
        'postgres_changes',
        {
          event: '*', // Listen for all events (INSERT, UPDATE, DELETE)
          schema: 'public',
          table: 'vehicles',
          filter: `id=eq.${vehicleId}`
        },
        (payload) => callback(payload.new || payload.old, payload.eventType)
      )
      .subscribe();
  }
  
  // Subscribe to real-time changes in pickup points for an organization
  subscribeToPickupPointUpdates(orgId, callback) {
    if (!this.client) {
      console.error('Supabase client not initialized');
      return null;
    }

    return this.client
      .channel(`pickup_point_updates:${orgId}`)
      .on(
        'postgres_changes',
        {
          event: '*', // Listen for all events (INSERT, UPDATE, DELETE)
          schema: 'public',
          table: 'pickup_points',
          filter: `org_id=eq.${orgId}`
        },
        async (payload) => {
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
      .subscribe();
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
}

// Export a singleton instance
const supabaseClient = new SupabaseClient();

// Make it available globally
window.supabase = supabaseClient; 