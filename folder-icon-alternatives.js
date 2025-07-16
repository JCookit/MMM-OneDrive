/**
 * Alternative folder icon implementations for MagicMirror compatibility
 * Use these if the CSS folder icon doesn't display properly
 */

// Alternative 1: Simple letter-based icon
function setFolderIconSimple(sourceIcon) {
  sourceIcon.innerHTML = "F";
  sourceIcon.style.fontWeight = "bold";
  sourceIcon.style.fontSize = "32px";
}

// Alternative 2: Unicode symbol that should work in most fonts
function setFolderIconUnicode(sourceIcon) {
  sourceIcon.innerHTML = "▼"; // Triangle pointing down
  // or use: "●" (filled circle), "◆" (diamond), "■" (square)
}

// Alternative 3: Text-based indicator
function setFolderIconText(sourceIcon) {
  sourceIcon.innerHTML = "[DIR]";
  sourceIcon.style.fontSize = "16px";
  sourceIcon.style.fontWeight = "bold";
}

// Alternative 4: Keep it minimal - just different background color
function setFolderIconMinimal(sourceIcon) {
  sourceIcon.innerHTML = "";
  sourceIcon.style.backgroundColor = "rgba(100, 150, 255, 0.3)"; // Blue tint for folders
  sourceIcon.style.border = "2px solid #66f";
}

/**
 * To use any of these alternatives, replace the folder icon creation in main.ts:
 * 
 * if (isFromFolder) {
 *   sourceIcon = document.createElement("div");
 *   sourceIcon.classList.add("folderIcon");
 *   setFolderIconSimple(sourceIcon); // or use any other alternative
 *   
 *   sourceTitle = document.createElement("div");
 *   sourceTitle.classList.add("folderTitle");
 *   sourceTitle.innerHTML = album.name;
 * }
 */
