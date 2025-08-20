# Web Animations API Implementation

## Purpose
Replace CSS-based Ken Burns animations with Web Animations API to potentially resolve Pi memory crashes and SIGSEGV errors.

## Key Changes

### Configuration Toggle
```typescript
const USE_WEB_ANIMATIONS_API = true;  // Set to false to revert to CSS approach
```

### Animation Methods
- **`applyWebAnimationsKenBurns()`**: New Web Animations API implementation
- **`applyCSSAnimationKenBurns()`**: Original CSS-based approach (preserved as fallback)
- **`applyKenBurnsAnimation()`**: Router method that chooses implementation based on toggle

### Benefits of Web Animations API
1. **Explicit Memory Control**: Animation objects can be explicitly canceled and cleaned up
2. **Better Performance Monitoring**: Direct access to animation state and lifecycle
3. **Reduced CSS Manipulation**: Less DOM style manipulation that could cause memory fragmentation
4. **Immediate Cleanup**: `animation.cancel()` and `delete element.kenBurnsAnimation` for explicit cleanup

### Implementation Details
- Uses `Element.animate()` with keyframes instead of CSS transitions
- Stores animation reference on HTMLElement for explicit cleanup
- Maintains same visual effects (zoom, pan, focal point integration)
- Includes proper cleanup on animation finish/cancel

### Testing Plan
1. Deploy with `USE_WEB_ANIMATIONS_API = true` on Pi
2. Monitor for SIGSEGV crashes and memory usage
3. If issues persist, toggle to `false` for immediate fallback to CSS approach
4. Compare stability between both approaches

### Memory Management Strategy
- Cancel existing animations before starting new ones
- Delete animation references from DOM elements
- Explicit cleanup in finish/cancel event handlers
- Maintains same garbage collection hints as before
