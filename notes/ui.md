# UI notes

- UI elements render into a canvas maintained by a Root element; the "host" (scene2, scene3 or
  something else) then renders that canvas image data via its GPU accelerated method of choice

- The host passes input events (along with the rendering origin of the root) to the Root so that it
  can manage interactivity

- The host updates the Root every frame so that it can process animations and perform
  re-validation/layout/rendering as needed

## TODO

- Differentiate between invalidation (size may change, relayout and rerendering needed) and
  dirtying (no size change, no relayout, yes rerendering)
  - invalid implies dirty
  - animated style transitions will often dirty but not invalidate

- Manage dirty regions on invalidation/dirtying so that we don't repaint everything every time
  anything changes

- Do we want hover? (Doesn't really work on touch, so maybe not worth it for mouse/desktop?)

- Unfocus all roots if we click outside any root?
