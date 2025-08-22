ok this is a big one.

let's go ahead and implement the opencv code as its own child process.

i may not fully understand all the steps, but i can outline some -- do all these and tell me what i missed and do those as well.

because of this being a large refactor, it has the potential to significantly destabilize.  try to do things step by step as outlined below, and in such a way they are easily reversible, or at least easy to compare to the way it was before.

important ideas:
1. turn the code in the /vision subdir into a standalone process.  i'm guessing it needs some kind of event or main loop, so it continues to run forever and listen for messages.  we'll call this the 'cv process'
   - i think the findInterestingRectangle function in node_helper.js should also be pushed into this process and be the main entry point (more on this below)
   - this should not change the logic flow under findInterestingRectangle or the steps used to call opencv or any of that
2. the cv process doesn't need the debug-drawing (debugUtils.js).   In fact, the idea of creating burned-in rectangles is no longer needed.  remove that; it only complicates things
3. the cv process will get the Mat-analysis stuff; remove this from the main process.  the main process should have no dependency on opencv code or types (or sharp or anything else that was needed); remove all opencv imports to make sure
4. the lifecycle of the cv process will be completely handled by the main process
   - the cv process will be spawned on demand.  there should be easy-to-change params in code for anything important in the spawning like memory
   - when the cv process is needed to work (ie after fetching a new photo and faceDetection is true), a check should be made to see if it is still running (is this by process name?) and respawned if not
   - the cv process should die when the main process does (but NOT vice versa).  can this be automatic in linux?  do best effort here
   - my use case here is that the parent will never be calling this for more than one photo at a time, so we do not have to worry about multiple simultaneous processes -- keep it simple
   - put all code that deals with the cv process together in node_helper.js
   - add logging so it's clear what the parent process is trying to do
5. interfaces - i believe there are limited messages required ---
   - startup (the module can receive config information - probably just the faceDetection section in the config).  response from cv process should be success/failure.  
   - DoDetection (this is the main entry point, the equivalent of findInterestingRectangle).  Input into this function is an image (potentially some image-specific params), and the output is an object with an overall rectangle and the method chosen for that overall rectangle (and any status information).   We'll put all the bounding-box and fallback logic into the cv process
   - shutdown --- not sure this has to be explicitly called or not but if needed add it
6. memory marshaling.  i like the idea of shared memory for the picture.   can we use that and some form of inter-process communication to trigger and send other parameters back & forth?  we can take advantage of the fact we are only ever doing one at a time.    i am not aware of nodejs best practices here so tell me
7. all IPC calls need a code-configurable timeout, and then assume the process is hung (and kill it, unless shutting down).  in my experience on the pi, i have seen it take 10s for a picture, which is ok.
   - for the purposes of the slide show, if the parent process times out on DoDetection, it should just kill the process and abandon the attempt and not animate the current photo.  The next photo should (per the above) attempt to start the process again
8. the cv process should log as you suggested via pipes back to the main process, so all logs appear together (although distinguish the cv process)
9. if the cv process can be started from the commandline independently, then make a script that can do this, so its functionality can be tested (ideally have the test harness accept the filename of a photo and have it output the result.  i realize this is a different invoke mechanism that the IPC method, but see if possible)
10. the yolo models should be moved to alongside the process code
11. bonus:  can the _main process_ be augmented to draw rectangles _on top of the photo_ in debug mode using html/css?  if so, do this
12. create a readme describing what was done
