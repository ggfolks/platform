import {
  BoxBufferGeometry,
  CullFaceNone,
  BufferGeometry,
  GridHelper,
  Math as ThreeMath,
  PerspectiveCamera,
  Scene,
  SphereBufferGeometry,
  Vector3,
  WebGLRenderer,
} from "three"

import {Clock} from "tfw/core/clock"
import {Value} from "tfw/core/react"
import {DenseValueComponent, Domain} from "tfw/entity/entity"
import {Renderer} from "tfw/scene2/gl"
import {TransformComponent} from "tfw/space/entity"
import {MeshSystem} from "tfw/scene3/entity"

export function spaceDemo (renderer :Renderer) {
  const {canvas, glc} = renderer
  const scene = new Scene()
  scene.add(new GridHelper(100, 100))
  const camera = new PerspectiveCamera()
  renderer.size.onValue(size => {
    camera.aspect = size[0] / size[1]
    camera.updateProjectionMatrix()
  })
  camera.position.y = 3
  const webglRenderer = new WebGLRenderer({canvas, context: glc})
  // containing renderer handles color clear
  webglRenderer.autoClearColor = false

  const trans = new TransformComponent("trans")
  const sphere = new SphereBufferGeometry()
  const geom = new DenseValueComponent<BufferGeometry>("geom", sphere)
  const domain = new Domain({}, {trans, geom})
  const meshsys = new MeshSystem(domain, trans, geom)
  scene.add(meshsys.group)

  const econfig = {
    components: {trans: {}, geom: {}}
  }

  const box = new BoxBufferGeometry()

  const origin = new Vector3(0, 3, -10)
  const position = new Vector3()
  for (let ii = 0; ii < 10; ii++) {
    const id = domain.add(econfig)
    geom.update(id, ii & 1 ? sphere : box)
    position.set(
      origin.x + ThreeMath.randFloat(-2, 2),
      origin.y + ThreeMath.randFloat(-2, 2),
      origin.z + ThreeMath.randFloat(-2, 2),
    )
    trans.updatePosition(id, position)
  }

  return Value.constant((clock: Clock) => {
    meshsys.update()
    webglRenderer.render(scene, camera)
    // scene2 expects back face culling to be disabled
    webglRenderer.state.setCullFace(CullFaceNone)
  })
}
