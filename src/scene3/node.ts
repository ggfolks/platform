import {
  AnimationAction, AnimationMixer, Color, Intersection,
  Material, Mesh, Object3D, Raycaster, Vector3,
} from "three"

import {dim2} from "../core/math"
import {Subject, Value} from "../core/react"
import {Noop, NoopRemover, PMap, getValue} from "../core/util"
import {Graph} from "../graph/graph"
import {InputEdgeMeta, inputEdge, outputEdge, property} from "../graph/meta"
import {NodeTypeRegistry, WrappedValue} from "../graph/node"
import {SubgraphRegistry} from "../graph/util"
import {Component} from "../entity/entity"
import {EntityComponentConfig, EntityComponentNode} from "../entity/node"
import {PointerConfig} from "../input/node"
import {windowSize} from "../scene2/gl"
import {AnimationController, AnimationControllerConfig} from "./animation"
import {HoverMap, loadGLTFAnimationClip} from "./entity"

/** Emits information about a single hover point. */
abstract class HoverConfig implements EntityComponentConfig, PointerConfig {
  type = "hover"
  @property() component = ""
  @property() index = 0
  @property() count = 1
  @outputEdge("Vector3") worldPosition = undefined
  @outputEdge("Vector3") worldMovement = undefined
  @outputEdge("Vector3") viewPosition = undefined
  @outputEdge("Vector3") viewMovement = undefined
  @outputEdge("boolean") pressed = undefined
  @outputEdge("boolean", true) hovered = undefined
}

const zeroVector = new Vector3()

class Hover extends EntityComponentNode<Component<HoverMap>> {

  constructor (graph :Graph, id :string, readonly config :HoverConfig) {
    super(graph, id, config)
  }

  protected _createOutput (name :string) {
    const component = this._component
    if (!component) {
      switch (name) {
        case "worldPosition":
        case "worldMovement":
        case "viewPosition":
        case "viewMovement": return Value.constant(new Vector3())
        default: return Value.constant(false)
      }
    }
    const index = this.config.index || 0
    const count = this.config.count === undefined ? 1 : this.config.count
    const hover = component.getValue(this._entityId).map(hovers => {
      if (hovers.size === count) {
        let remaining = index
        for (const value of hovers.values()) {
          if (remaining-- === 0) return value
        }
      }
      return
    })
    switch (name) {
      case "worldPosition":
      case "worldMovement":
      case "viewPosition":
      case "viewMovement": return hover.map(hover => hover ? hover[name] : zeroVector)
      case "pressed": return hover.map(hover => Boolean(hover && hover.pressed))
      default: return hover.map(Boolean)
    }
  }
}

/** Controls an animation action on the entity. */
abstract class AnimationActionConfig implements EntityComponentConfig {
  type = "animationAction"
  @property() component = ""
  @property() url = ""
  @property() repetitions = Number.POSITIVE_INFINITY
  @property() clampWhenFinished = false
  @inputEdge("boolean") play = undefined
  @outputEdge("boolean", true) finished = undefined
  // YAGNI? @outputEdge("boolean") loop = undefined
}

const isPlaceholder = (obj :Object3D) => obj.children.length == 0

class AnimationActionNode extends EntityComponentNode<Component<AnimationMixer>> {
  private _action? :Subject<AnimationAction>

  constructor (graph :Graph, id :string, readonly config :AnimationActionConfig) {
    super(graph, id, config)
  }

  connect () {
    const component = this._component
    if (!component) return
    const actplay = Subject.join2(
      this._getAction(component),
      this.graph.getValue(this.config.play, false),
    )
    this._disposer.add(actplay.onValue(([action, play]) => {
      // if the object being animated is still a placeholder, don't try to animate it
      if (!isPlaceholder(action.getRoot()) && play !== action.isScheduled()) {
        if (play) {
          if (this.config.repetitions) action.repetitions = this.config.repetitions
          if (this.config.clampWhenFinished !== undefined) {
            action.clampWhenFinished = this.config.clampWhenFinished
          }
          action.reset()
          action.play()
        } else {
          action.stop()
        }
      }
    }))
  }

  dispose () {
    super.dispose()
    this._action = undefined
  }

  protected _createOutput () {
    const component = this._component
    if (!component) return Value.constant(false)
    const actplay = Subject.join2(
      this._getAction(component),
      this.graph.getValue(this.config.play, false),
    )
    return actplay.switchMap(([action, playing]) => Subject.deriveSubject<boolean>(disp => {
      if (isPlaceholder(action.getRoot())) return NoopRemover
      const listener = (e :any) => {
        if (e.action === action) disp(true)
      }
      action.getMixer().addEventListener("finished", listener)
      return () => action.getMixer().removeEventListener("finished", listener)
    })).fold(false, (ov, nv) => nv)
  }

  protected _getAction (component :Component<AnimationMixer>) {
    if (!this._action) {
      this._action = Subject.join2(
        component.getValue(this._entityId),
        loadGLTFAnimationClip(this.config.url)
      ).map(([mixer, clip]) => mixer.clipAction(clip))
    }
    return this._action
  }
}

/** Controls an animation controller on the entity. */
abstract class AnimationControllerNodeConfig implements EntityComponentConfig {
  type = "animationController"
  config :AnimationControllerConfig = {states: {default: {}}}
  @property() component = ""
  @outputEdge("string") state = undefined
}

class AnimationControllerNode extends EntityComponentNode<Component<AnimationMixer>> {
  private _inputsMeta :PMap<InputEdgeMeta> = {}
  private _animationController? :AnimationController
  private _output = new WrappedValue(Value.constant("default"), "default")

  get inputsMeta () {
    return this._inputsMeta
  }

  constructor (graph :Graph, id :string, readonly config :AnimationControllerNodeConfig) {
    super(graph, id, config)
    const controllerConfig = config.config
    for (const stateKey in controllerConfig.states) {
      const state = controllerConfig.states[stateKey]
      if (!state.transitions) continue
      for (const transitionKey in state.transitions) {
        const transition = state.transitions[transitionKey]
        if (transition.condition) {
          const name = transition.condition.substring(transition.condition.indexOf("!") + 1)
          this._inputsMeta[name] = {type: "boolean"}
        }
      }
    }
  }

  connect () {
    const component = this._component
    if (!component) return
    const conditions = new Map<string, Value<boolean>>()
    for (const inputKey in this._inputsMeta) {
      conditions.set(inputKey, this.graph.getValue<boolean>(this.config[inputKey], false))
    }
    this._disposer.add(component.getValue(this._entityId).onValue(mixer => {
      if (isPlaceholder(mixer.getRoot())) return
      if (this._animationController) {
        this._animationController.dispose()
        this._disposer.remove(this._animationController)
      }
      this._disposer.add(this._animationController = new AnimationController(
        mixer,
        conditions,
        this.config.config,
      ))
      this._output.update(this._animationController.state)
    }))
  }

  protected _createOutput () {
    return this._output
  }
}

/** Casts a ray into the scene. */
abstract class RaycasterConfig implements EntityComponentConfig {
  type = "raycaster"
  @property() component = ""
  @property("CoordinateFrame") frame = "local"
  @inputEdge("Vector3") origin = undefined
  @inputEdge("Vector3") direction = undefined
  @outputEdge("number") distance = undefined
}

const NoIntersection = {distance: Infinity} as Intersection

class RaycasterNode extends EntityComponentNode<Component<Object3D>> {

  private _intersection? :Value<Intersection>
  private _origin? :Value<Vector3>
  private _direction? :Value<Vector3>

  constructor (graph :Graph, id :string, readonly config :RaycasterConfig) {
    super(graph, id, config)
  }

  connect () {
    // subscribe to updates so that we can poll the current value
    this._disposer.add(this._getOrigin().onValue(Noop))
    this._disposer.add(this._getDirection().onValue(Noop))
  }

  protected _createOutput () {
    return this._getIntersection().map(intersection => intersection.distance)
  }

  protected _getIntersection () {
    if (!this._intersection) {
      const raycaster = new Raycaster()
      const target :Intersection[] = []
      this._intersection = this.graph.clock.fold(NoIntersection, () => {
        const component = this._component
        if (!component) return NoIntersection
        target.length = 0
        const object = component.read(this._entityId)
        const parent = object.parent as Object3D
        let ancestor = parent
        while (ancestor.parent) ancestor = ancestor.parent
        raycaster.set(this._getOrigin().current, this._getDirection().current)
        if (this.config.frame !== "world") raycaster.ray.applyMatrix4(object.matrixWorld)
        // remove the object itself while we raycast
        parent.remove(object)
        raycaster.intersectObject(ancestor, true, target)
        parent.add(object)
        return target.length > 0 ? target[0] : NoIntersection
      })
    }
    return this._intersection
  }

  protected _getOrigin () {
    if (!this._origin) {
      this._origin = this.graph.getValue(this.config.origin, new Vector3())
    }
    return this._origin
  }

  protected _getDirection () {
    if (!this._direction) {
      this._direction = this.graph.getValue(this.config.direction, new Vector3(0, 0, 1))
    }
    return this._direction
  }
}

/** Update the visibility of an Object3D. */
abstract class UpdateVisibleConfig implements EntityComponentConfig {
  type = "updateVisible"
  @property() component = ""
  @inputEdge("boolean") input = undefined
}

class UpdateVisibleNode extends EntityComponentNode<Component<Object3D>> {

  constructor (graph :Graph, id :string, readonly config :UpdateVisibleConfig) {
    super(graph, id, config)
  }

  connect () {
    const component = this._component
    if (!component) return
    this._disposer.add(
      this.graph.getValue(this.config.input, true).onValue(vis => {
        component.read(this._entityId).visible = vis
      }))
  }
}

/** Updates a single material property. */
abstract class UpdateMaterialPropertyConfig implements EntityComponentConfig {
  type = "updateMaterialProperty"
  @property() component = ""
  @property() name = "color"
  @inputEdge("any") input = undefined
}

class UpdateMaterialProperty extends EntityComponentNode<Component<Object3D>> {

  constructor (graph :Graph, id :string, readonly config :UpdateMaterialPropertyConfig) {
    super(graph, id, config)
  }

  connect () {
    const component = this._component
    if (!component) return
    const name = getValue(this.config.name as string|undefined, "color")
    this._disposer.add(
      this.graph.getValue(this.config.input, new Color()).onValue(input => {
        component.read(this._entityId).traverse(object => {
          if (!(object instanceof Mesh)) return
          if (Array.isArray(object.material)) {
            for (const material of object.material) {
              if (material.userData.shared) {
                object.material = object.material.map(cloneMaterial)
                break
              }
            }
            for (const material of object.material) {
              material[name] = input
            }
          } else {
            if (object.material.userData.shared) {
              object.material = cloneMaterial(object.material)
            }
            object.material[name] = input
          }
        })
      }),
    )
  }
}

function cloneMaterial (material :Material) :Material {
  const cloned = material.clone()
  cloned.userData.shared = false
  return cloned
}

/** Registers the nodes in this module with the supplied registry. */
export function registerScene3Nodes (registry :NodeTypeRegistry) {
  registry.registerNodeTypes(["scene3"], {
    hover: Hover,
    animationAction: AnimationActionNode,
    animationController: AnimationControllerNode,
    raycaster: RaycasterNode,
    updateVisible: UpdateVisibleNode,
    updateMaterialProperty: UpdateMaterialProperty,
  })
}

/** Registers the subgraphs in this module with the supplied registry. */
export function registerScene3Subgraphs (registry :SubgraphRegistry) {
  registry.registerSubgraphs(["scene3"], {
    doubleClickToInspect: {
      doubleClick: {type: "doubleClick"},
      hover: {type: "hover", component: "hovers"},
      inspect: {type: "and", inputs: ["doubleClick", "hover"]},
      ui: {
        type: "ui",
        input: "inspect",
        root: {
          type: "root",
          autoSize: true,
          hintSize: windowSize(window).map(
            size => dim2.fromValues(Math.round(size[0] * 0.9), Math.round(size[1] * 0.9)),
          ),
          contents: {
            type: "box",
            contents: {type: "graphviewer", editable: Value.constant(true)},
            style: {halign: "stretch", valign: "stretch", background: "$root"},
          },
        },
      },
    },
    pointerDraggable: {
      hover: {type: "hover", component: "hovers"},
      drag: {
        type: "Vector3.multiplyScalar",
        vector: ["hover", "worldMovement"],
        scalar: ["hover", "pressed"],
      },
      grabbed: {type: "output", name: "grabbed", input: ["hover", "pressed"]},
      translate: {type: "translate", component: "trans", frame: "world", input: "drag"},
    },
  })
}
