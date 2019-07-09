import {
  CullFaceNone,
  GridHelper,
  Mesh,
  PerspectiveCamera,
  Scene,
  SphereBufferGeometry,
  WebGLRenderer,
} from "three"

import {Clock} from "tfw/core/clock"
import {Value} from "tfw/core/react"
import {Renderer} from "tfw/scene2/gl"

export function spaceDemo (renderer :Renderer) {
  const {canvas, glc} = renderer
  const scene = new Scene()
  scene.add(new GridHelper(100, 100))
  const rendererSize = renderer.size.current
  const camera = new PerspectiveCamera(50, rendererSize[0] / rendererSize[1])
  camera.position.y = 3
  const sphere = new Mesh(new SphereBufferGeometry())
  scene.add(sphere)
  sphere.position.set(0, 3, -10)
  const webglRenderer = new WebGLRenderer({canvas, context: glc})
  // containing renderer handles color clear
  webglRenderer.autoClearColor = false
  return Value.constant((clock: Clock) => {
    webglRenderer.render(scene, camera)
    // scene2 expects back face culling to be disabled
    webglRenderer.state.setCullFace(CullFaceNone)
  })
}
