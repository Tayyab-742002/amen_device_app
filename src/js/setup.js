// Setup page functionality
document.addEventListener('DOMContentLoaded', () => {
  const setupForm = document.getElementById('setup-form');
  const submitButton = setupForm.querySelector('button[type="submit"]');
  const validationMessage = document.getElementById('validation-message');
  
  // Load Supabase script dynamically
  const supabaseScript = document.createElement('script');
  supabaseScript.src = "js/supabase.js";
  document.head.appendChild(supabaseScript);
  
  // Show validation message
  function showMessage(message, type = 'error') {
    validationMessage.textContent = message;
    validationMessage.className = `validation-message ${type}`;
    
    // Auto-hide success messages after 3 seconds
    if (type === 'success') {
      setTimeout(() => {
        validationMessage.className = 'validation-message';
      }, 3000);
    }
  }
  
  setupForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    
    // Clear previous validation messages
    validationMessage.className = 'validation-message';
    
    const organizationId = parseInt(document.getElementById('organization-id').value);
    const vehicleId = parseInt(document.getElementById('vehicle-id').value);
    
    if (!organizationId || !vehicleId) {
      showMessage('Please enter both Organization ID and Vehicle ID');
      return;
    }
    
    try {
      // Disable the submit button and show loading state
      submitButton.disabled = true;
      submitButton.textContent = 'Validating...';
      showMessage('Connecting to Supabase...', 'info');
      
      // Wait for Supabase client to be initialized
      let attempts = 0;
      while (!window.supabase?.client && attempts < 10) {
        await new Promise(resolve => setTimeout(resolve, 500));
        attempts++;
      }
      
      if (!window.supabase?.client) {
        throw new Error('Could not connect to Supabase');
      }
      
      // Step 1: Validate organization exists
      showMessage('Validating organization...', 'info');
      const orgData = await window.supabase.getOrganizationDetails(organizationId);
      if (!orgData) {
        throw new Error('Organization not found. Please check the ID and try again.');
      }
      
      // Step 2: Validate vehicle exists and belongs to this organization
      showMessage('Validating vehicle...', 'info');
      const vehicleData = await window.supabase.getVehicleDetails(vehicleId);
      if (!vehicleData) {
        throw new Error('Vehicle not found. Please check the ID and try again.');
      }
      
      if (vehicleData.org_id !== organizationId) {
        throw new Error('This vehicle does not belong to the specified organization.');
      }
      
      // Save the configuration using the Electron API
      showMessage('Saving configuration...', 'info');
      const result = await window.electronAPI.saveConfig({ 
        organizationId, 
        vehicleId 
      });
      
      if (result.success) {
        showMessage('Configuration saved successfully! Redirecting...', 'success');
        // The main process will handle the navigation to the main screen
      } else {
        throw new Error('Failed to save configuration');
      }
    } catch (error) {
      console.error('Validation error:', error);
      showMessage(error.message || 'Failed to save configuration. Please try again.');
    } finally {
      // Re-enable the submit button
      submitButton.disabled = false;
      submitButton.textContent = 'Save Configuration';
    }
  });
}); 