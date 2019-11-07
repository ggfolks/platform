# UI notes

- UI elements render into a canvas maintained by a Root element; the "host" (scene2, scene3 or
  something else) then renders that canvas image data via its GPU accelerated method of choice

- The host passes input events (along with the rendering origin of the root) to the Root so that it
  can manage interactivity

- The host updates the Root every frame so that it can process animations and perform
  re-validation/layout/rendering as needed
