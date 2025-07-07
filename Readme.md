# Amen Device App for drivers

## Features

### Real-time Pickup Point Management
- **Active/Inactive Status**: Pickup points are automatically filtered based on their `is_active` status
- **Real-time Updates**: Changes to pickup point status are immediately reflected in the device app
- **Visual Feedback**: 
  - Active pickup points are shown normally on the map
  - Inactive pickup points are automatically hidden from the map
  - Status changes trigger notifications to the driver
- **Status Counter**: The UI shows both active and inactive pickup point counts

### Testing Real-time Updates
To test the real-time pickup point filtering:

1. **Database Update**: Change the `is_active` field in the `pickup_points` table:
   ```sql
   -- To deactivate a pickup point
   UPDATE pickup_points SET is_active = false WHERE id = [pickup_point_id];
   
   -- To reactivate a pickup point
   UPDATE pickup_points SET is_active = true WHERE id = [pickup_point_id];
   ```

2. **Expected Behavior**:
   - When `is_active` is set to `false`: 
     - The pickup point immediately disappears from the map
     - **All routes to that pickup point are immediately cleared**
     - Yellow notification: "Pickup point [name] has been deactivated"
     - Routes are recalculated excluding the inactive point
   - When `is_active` is set to `true`: 
     - The pickup point immediately appears on the map
     - Green notification: "Pickup point [name] has been activated"
     - Routes are recalculated including the new active point
   - The pickup point counter updates to reflect active vs inactive counts
   - **If all pickup points become inactive, all routes are cleared from the map**

3. **Edge Case Testing**:
   - **Multiple Pickup Points**: Test disabling pickup points one by one
   - **Last Pickup Point**: When disabling the very last active pickup point, all routes should disappear completely
   - **Reactivation**: After all points are inactive, reactivating any point should show routes again
   - **Console Logs**: Check browser console for detailed debugging information

### Technical Implementation
- **Real-time Subscriptions**: Uses Supabase real-time subscriptions to `pickup_points` table
- **Filtering Logic**: Client-side filtering ensures only active pickup points are displayed
- **Route Updates**: Inactive pickup points are excluded from route calculations
- **Notification System**: Visual feedback for status changes with auto-dismiss notifications

## Setup Instructions

1. Clone the repository
2. Install dependencies: `npm install`
3. Set up environment variables in `.env` file
4. Run the application: `npm start`

## Database Schema

The application uses a comprehensive PostgreSQL database with the following key tables:
- `pickup_points`: Location waypoints with `is_active` status field
- `vehicles`: Fleet vehicles with real-time tracking
- `location_data`: GPS tracking data
- `notification_history`: Alert and notification management
- `organizations`: Multi-tenant organization structure

<div id="container">
  <div id="left-sidebar">...</div>
  <div id="map"></div>
  <div id="right-sidebar">...</div>
</div>
<div id="bottom-bar">...</div>