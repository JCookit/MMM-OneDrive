ok let's just try some simple things first, to mix it up.

we're going to optimize for variety, and also not 'huge' movements.

my goal also is to have some point for every photo when it is completely visible (ie for zooming-out, the very end has the whole photo.  zooming-in, it's the beginning)

i expect these changes are localized to the animation.  structure this 'rule analysis' so it is easy to see what's going on and easy to make changes in the future.   use helper functions (hasFace, isLargeFace etc) so it's easy to tweak the large/small values in the future.

Rules, in order of evaluation:
- multiple faces with a bounding box that is 'most' of the picture in the same aspect as the picture (ie a 'wide' set of faces in a landscape picture)
    - no movement
- if 'large' single face OR large bounding box around multiple faces 
    - prefer constant zoom out (60% chance)
    - chance zoom in (30% chance)
    - no movement (10% chance)
- if 'small' single face OR small bounding box around multiple faces
    - zoom out, starting quickly then slow down (80% chance)
    - no movement (20% chance)
- if no faces, but >0 interesting areas, but non are 'close to the center'
    - no movement
- if no faces, but >0 interesting areas, choose the one closest to the center
    - even odds zoom in or zoom out
- at your discretion, you may create some additional rules here, but please document what you're thinking so i may tweak
- if no other rules have matched
    - then 60% chance do what you do today (linear zoom out) 
    - 40% chance no movement


also, every animation (including static) should have the fadein/fadeout lines and note these do _not_ have movement in them; the movement spans over these keyframes automatically.
        10% {
          opacity: 1;
        }
        90% {
          opacity: 1;
        }
        