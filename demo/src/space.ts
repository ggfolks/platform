import {
  BoxBufferGeometry,
  BufferGeometry,
  Color,
  DirectionalLight,
  Euler,
  Material,
  Math as ThreeMath,
  MeshToonMaterial,
  PerspectiveCamera,
  Quaternion,
  Scene,
  SphereBufferGeometry,
  Vector3,
  WebGLRenderer,
} from "three"

import {Box, Heightfield, Shape, Sphere, Vec3} from "cannon"

import {Clock} from "tfw/core/clock"
import {Subject} from "tfw/core/react"
import {Graph} from "tfw/graph/graph"
import {registerMathNodes} from "tfw/graph/math"
import {NodeTypeRegistry} from "tfw/graph/node"
import {DenseValueComponent, Domain, Float32Component} from "tfw/entity/entity"
import {Renderer} from "tfw/scene2/gl"
import {TransformComponent} from "tfw/space/entity"
import {registerSpaceNodes} from "tfw/space/node"
import {MeshSystem} from "tfw/scene3/entity"
import {generateHeightfield, createHeightfieldGeometry} from "tfw/scene3/terrain"
import {PhysicsSystem} from "tfw/physics3/entity"
import {registerInputNodes} from "tfw/input/node"
import {RenderFn} from "./index"

export function spaceDemo (renderer :Renderer) :Subject<RenderFn> {
  return Subject.derive(disp => {
    const webglRenderer = new WebGLRenderer()

    const scene = new Scene()
    const camera = new PerspectiveCamera()
    scene.add(camera)
    camera.position.y = 3

    const light = new DirectionalLight()
    light.position.set(1, 1, 1)
    scene.add(light)

    // replace 2d canvas with 3d one
    const root = renderer.canvas.parentElement as HTMLElement
    root.removeChild(renderer.canvas)
    root.appendChild(webglRenderer.domElement)
    const sizeRemover = renderer.size.onValue(size => {
      webglRenderer.setPixelRatio(window.devicePixelRatio)
      webglRenderer.setSize(size[0], size[1])
      camera.aspect = size[0] / size[1]
      camera.updateProjectionMatrix()
    })

    const trans = new TransformComponent("trans")
    const geom = new DenseValueComponent<BufferGeometry>("geom", new BufferGeometry())
    const mat = new DenseValueComponent<Material>("mat", new MeshToonMaterial())
    const shapes = new DenseValueComponent<Shape[]>("shapes", [])
    const mass = new Float32Component("mass", 0)
    const domain = new Domain({}, {trans, geom, mat, shapes, mass})
    const meshsys = new MeshSystem(domain, trans, geom, mat)
    const physicssys = new PhysicsSystem(domain, trans, shapes, mass)
    physicssys.world.gravity.y = -9.8

    scene.add(meshsys.group)

    const econfig = {
      components: {trans: {}, geom: {}, mat: {}, shapes: {}, mass: {}}
    }

    const terrainId = domain.add(econfig)
    const elementSize = 0.5
    const heightfield = generateHeightfield(7, 1.5)
    // @ts-ignore the type for Heightfield is number[][], not number[]
    shapes.update(terrainId, [new Heightfield(heightfield, {elementSize})])
    const halfExtent = (heightfield.length - 1) * elementSize * 0.5
    trans.updatePosition(terrainId, new Vector3(-halfExtent, 0.0, halfExtent))
    trans.updateQuaternion(terrainId, new Quaternion().setFromAxisAngle(
      new Vector3(1, 0, 0),
      -Math.PI * 0.5,
    ))
    mat.update(terrainId, new MeshToonMaterial({color: "#80ff80"}))
    geom.update(terrainId, createHeightfieldGeometry(heightfield, elementSize, 5))

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
      mat.update(id, new MeshToonMaterial({color: new Color().setHSL(Math.random(), 1.0, 0.8)}))
      mass.update(id, 1)
      position.set(
        origin.x + ThreeMath.randFloat(-2, 2),
        origin.y + ThreeMath.randFloat(-2, 2),
        origin.z + ThreeMath.randFloat(-2, 2),
      )
      trans.updatePosition(id, position)
    }

    const avatarId = domain.add(econfig)
    geom.update(avatarId, boxGeom)
    trans.updatePosition(avatarId, position.set(0, 3, -10))
    trans.updateQuaternion(avatarId, new Quaternion().setFromEuler(new Euler(0, Math.PI, 0)))

    const nodes = new NodeTypeRegistry()
    registerMathNodes(nodes)
    registerSpaceNodes(nodes)
    registerInputNodes(nodes)
    const graph = new Graph(nodes, {domain}, {
      left: {type: "key", code: 37},
      right: {type: "key", code: 39},
      leftRight: {type: "subtract", inputs: ["left", "right"]},
      leftRightSpeed: {type: "constant", value: 2},
      leftRightVelocity: {type: "multiply", inputs: ["leftRight", "leftRightSpeed"]},
      rotate: {type: "rotate", entity: avatarId, component: "trans", y: "leftRightVelocity"},

      fwd: {type: "key", code: 38},
      back: {type: "key", code: 40},
      fwdBack: {type: "subtract", inputs: ["fwd", "back"]},
      fwdBackSpeed: {type: "constant", value: 2},
      fwdBackVelocity: {type: "multiply", inputs: ["fwdBack", "fwdBackSpeed"]},
      translate: {type: "translate", entity: avatarId, component: "trans", z: "fwdBackVelocity"},
    })

    disp((clock: Clock) => {
      graph.update(clock)
      physicssys.update(clock)
      meshsys.update()
      webglRenderer.render(scene, camera)
    })

    return () => {
      graph.dispose()
      sizeRemover()
      // restore 2d canvas
      root.removeChild(webglRenderer.domElement)
      root.appendChild(renderer.canvas)
      webglRenderer.dispose()
    }
  })
}
