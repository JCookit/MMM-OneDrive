/* ==================== REPLACEMENT FOR CUSTOM.CSS OVERRIDES ==================== */
/* Use this instead of your current #ONEDRIVE_PHOTO_CURRENT overrides */
/* This version is Ken Burns compatible and uses the module's new leftMargin option */

/* 
   STEP 1: Remove these lines from your custom.css:
   
   #ONEDRIVE_PHOTO_CURRENT {
     position: absolute;
     left: calc(25vw + 60px);
     width: calc(75vw - 60px);
     height: calc(100vh - 30px);
     background-position: left center;
     background-size: contain;
     background-repeat: no-repeat;
   }
   
   STEP 2: Add this to your MMM-OneDrive config in config.js:
   
   {
     module: "MMM-OneDrive",
     position: "fullscreen_below", // or wherever you have it
     config: {
       // ... your existing config ...
       leftMargin: "calc(25vw + 60px)",  // Replaces your left: calc(25vw + 60px)
       kenBurnsEffect: true,  // Enable Ken Burns effect (default: true)
       // ... rest of your config ...
     }
   }
   
   STEP 3: Optionally add these custom overrides to custom.css for fine-tuning:
*/

/* Fine-tune the positioning if needed (Ken Burns compatible) */
#ONEDRIVE_PHOTO_CURRENT {
  /* Use left center instead of center for your layout preference */
  /* This works with Ken Burns by only affecting the FINAL position */
  background-position: left center !important;
  background-size: contain !important;
  height: calc(100vh - 30px) !important;
}

/* 
   WHY THIS WORKS WITH KEN BURNS:
   - The module's leftMargin option handles positioning via JavaScript
   - Ken Burns animations override background-size and background-position during animation
   - Your !important rules only apply to the final resting state
   - The animation still runs smoothly from crop to final position
*/

/* Keep your other existing custom.css rules unchanged */
