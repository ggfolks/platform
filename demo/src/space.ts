import {
  Color,
  DirectionalLight,
  Euler,
  Math as ThreeMath,
  Mesh,
  PerspectiveCamera,
  Quaternion,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three"

import {Body} from "cannon"

import {Clock} from "tfw/core/clock"
import {Subject} from "tfw/core/react"
import {Graph} from "tfw/graph/graph"
import {registerMathNodes} from "tfw/graph/math"
import {registerUtilNodes} from "tfw/graph/util"
import {NodeTypeRegistry} from "tfw/graph/node"
import {DenseValueComponent, Domain, GraphSystem} from "tfw/entity/entity"
import {registerEntityNodes} from "tfw/entity/node"
import {Renderer} from "tfw/scene2/gl"
import {TransformComponent} from "tfw/space/entity"
import {registerSpaceNodes} from "tfw/space/node"
import {MeshSystem} from "tfw/scene3/entity"
import {generateHeightfield} from "tfw/scene3/terrain"
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

    const nodeCtx = {
      types: new NodeTypeRegistry(
        registerMathNodes,
        registerUtilNodes,
        registerEntityNodes,
        registerSpaceNodes,
        registerInputNodes,
      ),
    }

    const trans = new TransformComponent("trans")
    const mesh = new DenseValueComponent<Mesh>("mesh", new Mesh())
    const body = new DenseValueComponent<Body>("body", new Body())
    const graph = new DenseValueComponent<Graph>("graph", new Graph(nodeCtx, {}))
    const domain = new Domain({}, {trans, mesh, body, graph})

    const meshsys = new MeshSystem(domain, trans, mesh)
    scene.add(meshsys.group)

    const physicssys = new PhysicsSystem(domain, trans, body)
    physicssys.world.gravity.y = -9.8

    const graphsys = new GraphSystem(nodeCtx, domain, graph)

    const elementSize = 0.5
    const data = generateHeightfield(7, 1.5)
    const terrainId = domain.add({
      components: {
        trans: {},
        mesh: {
          geometry: {type: "heightfieldBuffer", data, elementSize},
          material: {type: "toon", color: "#80ff80"},
        },
        body: {shapes: [{type: "heightfield", data, elementSize}]},
      },
    })
    const halfExtent = (data.length - 1) * elementSize * 0.5
    trans.updatePosition(terrainId, new Vector3(-halfExtent, 0.0, halfExtent))
    trans.updateQuaternion(terrainId, new Quaternion().setFromAxisAngle(
      new Vector3(1, 0, 0),
      -Math.PI * 0.5,
    ))

    const origin = new Vector3(0, 3, -10)
    const position = new Vector3()
    for (let ii = 0; ii < 10; ii++) {
      let geometryType = "boxBuffer"
      let shapeType = "box"
      if (ii & 1) {
        geometryType = "sphereBuffer"
        shapeType = "sphere"
      }
      const id = domain.add({
        components: {
          trans: {},
          mesh: {
            geometry: {type: geometryType},
            material: {type: "toon", color: new Color().setHSL(Math.random(), 1.0, 0.8)},
          },
          body: {shapes: [{type: shapeType}], mass: 1},
        },
      })
      position.set(
        origin.x + ThreeMath.randFloat(-2, 2),
        origin.y + ThreeMath.randFloat(-2, 2),
        origin.z + ThreeMath.randFloat(-2, 2),
      )
      trans.updatePosition(id, position)
    }

    const avatarId = domain.add({
      components: {
        trans: {},
        mesh: {geometry: {type: "boxBuffer"}, material: {type: "toon"}},
        body: {shapes: [{type: "box"}]},
        graph: {
          left: {type: "key", code: 37},
          right: {type: "key", code: 39},
          leftRight: {type: "subtract", inputs: ["left", "right"]},
          leftRightSpeed: {type: "constant", value: 2},
          leftRightVelocity: {type: "multiply", inputs: ["leftRight", "leftRightSpeed"]},
          rotate: {type: "rotate", component: "trans", y: "leftRightVelocity"},

          fwd: {type: "key", code: 38},
          back: {type: "key", code: 40},
          fwdBack: {type: "subtract", inputs: ["fwd", "back"]},
          fwdBackSpeed: {type: "constant", value: 2},
          fwdBackVelocity: {type: "multiply", inputs: ["fwdBack", "fwdBackSpeed"]},
          translate: {type: "translate", component: "trans", z: "fwdBackVelocity"},

          spawn: {type: "key", code: 32},
          addEntity: {type: "addEntity", input: "spawn", config: {
            components: {
              trans: {initial: new Float32Array([0, 3, -10, 0, 0, 0, 1, 1, 1, 1])},
              mesh: {geometry: {type: "boxBuffer"}, material: {type: "toon"}},
              body: {shapes: [{type: "box"}]},
              graph: {
                changeDirection: {type: "interval", seconds: 0.25},
                randomX: {type: "random", min: -1, max: 1},
                randomY: {type: "random", min: -1, max: 1},
                randomZ: {type: "random", min: -1, max: 1},
                velX: {type: "latch", store: "changeDirection", value: "randomX"},
                velY: {type: "latch", store: "changeDirection", value: "randomY"},
                velZ: {type: "latch", store: "changeDirection", value: "randomZ"},
                move: {type: "translate", component: "trans", x: "velX", y: "velY", z: "velZ"},
                countdown: {type: "timeout", seconds: 10},
                deleteSelf: {type: "deleteEntity", input: "countdown"},
              },
            },
          }},
        },
      },
    })
    trans.updatePosition(avatarId, position.set(0, 3, -10))
    trans.updateQuaternion(avatarId, new Quaternion().setFromEuler(new Euler(0, Math.PI, 0)))

    disp((clock: Clock) => {
      graphsys.update(clock)
      physicssys.update(clock)
      meshsys.update()
      webglRenderer.render(scene, camera)
    })

    return () => {
      sizeRemover()
      // restore 2d canvas
      root.removeChild(webglRenderer.domElement)
      root.appendChild(renderer.canvas)
      webglRenderer.dispose()
    }
  })
}
