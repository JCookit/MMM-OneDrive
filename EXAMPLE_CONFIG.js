// ==================== EXAMPLE CONFIG FOR KEN BURNS + LEFT MARGIN ==================== 
// Add this to your MagicMirror config.js

{
  module: "MMM-OneDrive",
  position: "fullscreen_below", // Adjust to your actual position
  config: {
    // ... your existing OneDrive config (albums, updateInterval, etc.) ...
    
    // ==================== NEW OPTIONS ====================
    leftMargin: "calc(25vw + 60px)",  // Replaces your custom CSS left positioning
    kenBurnsEffect: true,             // Enable Ken Burns crop-and-zoom effect
    
    // Example of your other settings:
    albums: ["YourAlbumName"],
    updateInterval: 30000,
    sort: "random",
    condition: {
      minWidth: 1920,
      minHeight: 1080,
    },
    showWidth: 1920,
    showHeight: 1080,
    timeFormat: "YYYY/MM/DD HH:mm",
    autoInfoPosition: false,
  }
},

// ==================== WHAT TO CHANGE IN YOUR CUSTOM.CSS ====================
// 
// REMOVE these lines from your custom.css:
// #ONEDRIVE_PHOTO_CURRENT {
//   position: absolute;
//   left: calc(25vw + 60px);
//   width: calc(75vw - 60px);
//   height: calc(100vh - 30px);
//   background-position: left center;
//   background-size: contain;
//   background-repeat: no-repeat;
// }
//
// REPLACE with (optional fine-tuning):
// #ONEDRIVE_PHOTO_CURRENT {
//   background-position: left center !important;
//   background-size: contain !important;
//   height: calc(100vh - 30px) !important;
// }
//
// KEEP all your other custom.css rules unchanged (regions, other modules, etc.)

// ==================== HOW IT WORKS ====================
// 1. leftMargin: Module handles positioning via JavaScript (no CSS conflicts)
// 2. kenBurnsEffect: true = crop-and-zoom animation enabled
// 3. kenBurnsEffect: false = standard fade-in only (if you want to disable)
// 4. Your !important CSS rules work as final fallback after animation
