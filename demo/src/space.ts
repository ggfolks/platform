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

import {Body, Box, Plane, Quaternion, Shape, Sphere, Vec3} from "cannon"

import {Clock} from "tfw/core/clock"
import {Value} from "tfw/core/react"
import {DenseValueComponent, Domain, Float32Component} from "tfw/entity/entity"
import {Renderer} from "tfw/scene2/gl"
import {TransformComponent} from "tfw/space/entity"
import {MeshSystem} from "tfw/scene3/entity"
import {PhysicsSystem} from "tfw/physics3/entity"

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

  const trans = new TransformComponent("trans")
  const geom = new DenseValueComponent<BufferGeometry>("geom", new BufferGeometry())
  const shapes = new DenseValueComponent<Shape[]>("shapes", [])
  const mass = new Float32Component("mass", 0)
  const domain = new Domain({}, {trans, geom, shapes, mass})
  const meshsys = new MeshSystem(domain, trans, geom)
  const physicssys = new PhysicsSystem(domain, trans, shapes, mass)
  physicssys.world.gravity.y = -9.8
  physicssys.world.addBody(new Body({
    shape: new Plane(),
    quaternion: new Quaternion().setFromEuler(-Math.PI * 0.5, 0, 0)
  }))
  scene.add(meshsys.group)

  const econfig = {
    components: {trans: {}, geom: {}, shapes: {}, mass: {}}
  }

  const sphereGeom = new SphereBufferGeometry()
  const boxGeom = new BoxBufferGeometry()

  const sphereShapes = [new Sphere(1)]
  const boxShapes = [new Box(new Vec3(0.5, 0.5, 0.5))]

  const origin = new Vector3(0, 3, -10)
  const position = new Vector3()
  for (let ii = 0; ii < 10; ii++) {
    const id = domain.add(econfig)
    if (ii & 1) {
      geom.update(id, sphereGeom)
      shapes.update(id, sphereShapes)
    } else {
      geom.update(id, boxGeom)
      shapes.update(id, boxShapes)
    }
    mass.update(id, 1)
    position.set(
      origin.x + ThreeMath.randFloat(-2, 2),
      origin.y + ThreeMath.randFloat(-2, 2),
      origin.z + ThreeMath.randFloat(-2, 2),
    )
    trans.updatePosition(id, position)
  }

  return Value.constant((clock: Clock) => {
    physicssys.update(clock)
    meshsys.update()
    webglRenderer.render(scene, camera)
    // scene2 expects back face culling to be disabled
    webglRenderer.state.setCullFace(CullFaceNone)
  })
}
