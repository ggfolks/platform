import {dim2, vec3, vec3zero} from "../core/math"
import {Value} from "../core/react"
import {MutableMap, RMap} from "../core/rcollect"
import {getValue} from "../core/util"
import {Graph} from "../graph/graph"
import {
  InputEdgeMeta, OutputEdgeMeta, PropertyMeta, activateNodeConfigs, property, inputEdge, outputEdge,
} from "../graph/meta"
import {Node, NodeConfig, NodeTypeRegistry} from "../graph/node"
import {SubgraphRegistry} from "../graph/util"
import {PointerConfig} from "../input/node"
import {windowSize} from "../scene2/gl"
import {Component, CoordinateFrame, Graph as GraphComponent, Hover, Hoverable} from "./game"
import {getComponentMeta} from "./meta"
import {RaycastHit} from "./render"

abstract class AbstractComponentNode<T extends Component> extends Node {

  protected get _componentValue () :Value<T|undefined> {
    const graphComponent = this.graph.ctx.graphComponent as GraphComponent|undefined
    if (!graphComponent) return Value.constant<T|undefined>(undefined)
    return this._componentType.switchMap(
      type => graphComponent.gameObject.components.getValue(type) as Value<T|undefined>,
    )
  }

  protected abstract get _componentType () :Value<string>
}

/** Exposes the properties of a component as inputs and outputs. */
abstract class ComponentConfig implements NodeConfig {
  type = "component"
  @property("select") compType = "transform"
}

class ComponentNode extends AbstractComponentNode<Component> {

  get propertiesMeta () :RMap<string, PropertyMeta> {
    const graphComponent = this.graph.ctx.graphComponent as GraphComponent|undefined
    if (!graphComponent) return RMap.empty()
    return RMap.fromValue(
      graphComponent.gameObject.components.keysValue,
      types => {
        const map = MutableMap.local<string, PropertyMeta>()
        map.set("compType", {
          type: "select",
          defaultValue: "transform",
          constraints: {options: types},
        })
        return map
      },
    )
  }

  get inputsMeta () :RMap<string, InputEdgeMeta> {
    return RMap.fromValue(this._componentValue, component => getComponentInputsMeta(component))
  }

  get outputsMeta () :RMap<string, OutputEdgeMeta> {
    return RMap.fromValue(this._componentValue, component => getComponentOutputsMeta(component))
  }

  constructor (graph :Graph, id :string, readonly config :ComponentConfig) {
    super(graph, id, config)
  }

  connect () {
    for (const key of this.inputsMeta.keys()) {
      const value = this.config[key]
      if (value === undefined) continue
      this._disposer.add(
        Value
          .join2(this._componentValue, this.graph.getValue(value, undefined))
          .onValue(([component, value]) => {
            if (component && value !== undefined) component[key] = value
          })
      )
    }
  }

  protected get _componentType () :Value<string> {
    return this.getProperty("compType") as Value<string>
  }

  protected _createOutput (name :string, defaultValue :any) :Value<any> {
    return this._componentValue.switchMap(
      component => component
        ? component.getProperty(name, defaultValue)
        : Value.constant(defaultValue)
    )
  }
}

const componentInputsMeta = new Map<Component|undefined, RMap<string, InputEdgeMeta>>()

function getComponentInputsMeta (component :Component|undefined) :RMap<string, InputEdgeMeta> {
  let prototype = component && Object.getPrototypeOf(component)
  let meta = componentInputsMeta.get(prototype)
  if (!meta) {
    const map = MutableMap.local<string, InputEdgeMeta>()
    for (; prototype; prototype = Object.getPrototypeOf(prototype)) {
      for (const [name, property] of getComponentMeta(prototype).properties) {
        if (!(property.constraints && property.constraints.readonly)) {
          map.set(name, {type: property.type})
        }
      }
    }
    componentInputsMeta.set(prototype, meta = map)
  }
  return meta
}

const componentOutputsMeta = new Map<Component|undefined, RMap<string, OutputEdgeMeta>>()

function getComponentOutputsMeta (component :Component|undefined) :RMap<string, OutputEdgeMeta> {
  let prototype = component && Object.getPrototypeOf(component)
  let meta = componentOutputsMeta.get(prototype)
  if (!meta) {
    const map = MutableMap.local<string, OutputEdgeMeta>()
    for (; prototype; prototype = Object.getPrototypeOf(prototype)) {
      for (const [name, property] of getComponentMeta(prototype).properties) {
        map.set(name, {type: property.type})
      }
    }
    componentOutputsMeta.set(prototype, meta = map)
  }
  return meta
}

/** Emits information about a single hover point. */
abstract class HoverConfig implements NodeConfig, PointerConfig {
  type = "hover"
  @property() index = 0
  @property() count = 1
  @outputEdge("vec3") worldPosition = undefined
  @outputEdge("vec3") worldMovement = undefined
  @outputEdge("vec3") viewPosition = undefined
  @outputEdge("vec3") viewMovement = undefined
  @outputEdge("boolean") pressed = undefined
  @outputEdge("boolean", true) hovered = undefined
}

class HoverNode extends AbstractComponentNode<Hoverable> {

  constructor (graph :Graph, id :string, readonly config :HoverConfig) {
    super(graph, id, config)
  }

  protected get _componentType () :Value<string> {
    return Value.constant("hoverable")
  }

  protected _createOutput (name :string) {
    const index = getValue(this.config.index, 0)
    const count = getValue(this.config.count, 1)
    const getHover = (hovers :ReadonlyMap<number, Hover>) => {
      if (hovers.size === count) {
        let remaining = index
        for (const value of hovers.values()) {
          if (remaining-- === 0) return value
        }
      }
      return undefined
    }
    const hover :Value<Hover|undefined> = this._componentValue.switchMap(hoverable => {
      if (!hoverable) return Value.constant<Hover|undefined>(undefined)
      return hoverable.hovers.fold(
        getHover(hoverable.hovers),
        (hover, hovers) => getHover(hovers),
      )
    })
    switch (name) {
      case "worldPosition":
      case "worldMovement":
      case "viewPosition":
      case "viewMovement": return hover.map(hover => hover ? hover[name] : vec3zero)
      case "pressed": return hover.map(hover => Boolean(hover && hover.pressed))
      default: return hover.map(Boolean)
    }
  }
}

/** Casts a ray into the scene. */
abstract class RaycastConfig implements NodeConfig {
  type = "raycast"
  @property("CoordinateFrame") frame = "local"
  @inputEdge("vec3") origin = undefined
  @inputEdge("vec3") direction = undefined
  @outputEdge("number") distance = undefined
}

class Raycast extends Node {

  constructor (graph :Graph, id :string, readonly config :RaycastConfig) {
    super(graph, id, config)
  }

  protected _createOutput () {
    const component = this.graph.ctx.graphComponent as GraphComponent|undefined
    if (!component) return Value.constant(Infinity)
    const origin = this._getConnectedValue(this.config.origin, vec3.create())
    const direction = this._getConnectedValue(this.config.direction, vec3.fromValues(0, 0, 1))
    const worldOrigin = vec3.create()
    const worldDirection = vec3.create()
    const hits :RaycastHit[] = []
    return this.graph.clock.fold(Infinity, () => {
      vec3.copy(worldOrigin, origin.current)
      vec3.copy(worldDirection, direction.current)
      if (this.config.frame !== "world") {
        component.transform.transformPoint(worldOrigin, worldOrigin)
        component.transform.transformDirection(worldDirection, worldDirection)
      }
      component.gameObject.gameEngine.renderEngine.raycastAll(
        worldOrigin,
        worldDirection,
        0,
        Infinity,
        hits,
      )
      for (const hit of hits) {
        if (hit.transform !== component.transform) return hit.distance
      }
      return Infinity
    })
  }
}

/** Rotates by an amount determined by the input. */
abstract class RotateConfig implements NodeConfig {
  type = "rotate"
  @property("CoordinateFrame") frame = "local"
  @inputEdge("vec3") input = undefined
}

class Rotate extends Node {

  constructor (graph :Graph, id :string, readonly config :RotateConfig) {
    super(graph, id, config)
  }

  connect () {
    const component = this.graph.ctx.graphComponent as GraphComponent|undefined
    if (!component) return
    const input = this._getConnectedValue(this.config.input, vec3.create())
    this._disposer.add(this.graph.clock.onEmit(() => {
      component.transform.rotate(input.current, this.config.frame as CoordinateFrame|undefined)
    }))
  }
}

/** Translates by an amount determined by the input. */
abstract class TranslateConfig implements NodeConfig {
  type = "translate"
  @property("CoordinateFrame") frame = "local"
  @inputEdge("vec3") input = undefined
}

class Translate extends Node {

  constructor (graph :Graph, id :string, readonly config :TranslateConfig) {
    super(graph, id, config)
  }

  connect () {
    const component = this.graph.ctx.graphComponent as GraphComponent|undefined
    if (!component) return
    const input = this._getConnectedValue(this.config.input, vec3.create())
    this._disposer.add(this.graph.clock.onEmit(() => {
      component.transform.translate(input.current, this.config.frame as CoordinateFrame|undefined)
    }))
  }
}

/** Registers the nodes in this module with the supplied registry. */
export function registerEngineNodes (registry :NodeTypeRegistry) {
  activateNodeConfigs(HoverConfig, RotateConfig, TranslateConfig)
  registry.registerNodeTypes(["engine"], {
    component :ComponentNode,
    hover: HoverNode,
    raycast: Raycast,
    rotate: Rotate,
    translate: Translate,
  })
}

/** Registers the subgraphs in this module with the supplied registry. */
export function registerEngineSubgraphs (registry :SubgraphRegistry) {
  const draggable = {
    hover: {type: "hover"},
    grabbed: {type: "output", name: "grabbed", input: ["hover", "pressed"]},
    translate: {
      type: "translate",
      frame: "world",
      input: {type: "vec3.scale", vector: ["hover", "worldMovement"], scalar: ["hover", "pressed"]},
    },
  }
  const fallable = {
    transform: {type: "component", compType: "transform"},
    offsetPosition: {
      type: "vec3.add",
      inputs: [["transform", "position"], vec3.fromValues(0, 1, 0)],
    },
    raycast: {
      type: "raycast",
      frame: "world",
      origin: "offsetPosition",
      direction: vec3.fromValues(0, -1, 0),
    },
    height: {type: "property", name: "height"},
    heightPlusOne: {type: "add", inputs: [1, "height"]},
    offset: {type: "subtract", a: "heightPlusOne", b: ["raycast", "distance"]},
    clock: {type: "clock"},
    aboveGround: {type: "lessThan", a: "offset", b: -0.0001},
    grabbed: {type: "input", name: "grabbed"},
    notGrabbed: {type: "not", input: "grabbed"},
    falling: {type: "and", inputs: ["aboveGround", "notGrabbed"]},
    dv: {type: "multiply", inputs: ["clock", -9.8]},
    baseVelocity: {type: "add", inputs: ["velocity", "dv"]},
    jump: {type: "input", name: "jump"},
    velocity: {
      type: "conditional",
      condition: "falling",
      ifTrue: "baseVelocity",
      ifFalse: "jump",
    },
    fall: {type: "multiply", inputs: ["clock", "velocity"]},
    delta: {type: "max", inputs: ["offset", "fall"]},
    translation: {type: "vec3.fromValues", y: "delta"},
    translate: {type: "translate", input: "translation"},
    aboveGroundOutput: {type: "output", name: "aboveGround", input: "aboveGround"},
  }
  const rootSize = windowSize(window).map(
    size => dim2.fromValues(Math.round(size[0] * 0.9), Math.round(size[1] * 0.9)),
  )
  registry.registerSubgraphs(["engine", "object"], {
    doubleClickToInspect: {
      doubleClick: {type: "doubleClick"},
      hover: {type: "hover"},
      inspect: {type: "and", inputs: ["doubleClick", "hover"]},
      ui: {
        type: "ui",
        input: "inspect",
        root: {
          type: "root",
          autoSize: true,
          hintSize: rootSize,
          minSize: rootSize,
          contents: {
            type: "box",
            contents: {type: "graphViewer", editable: Value.constant(true)},
            style: {halign: "stretch", valign: "stretch", background: "$root"},
          },
        },
      },
    },
    pointerDraggable: draggable,
    fallable,
    draggableFallable: {
      draggable: {type: "subgraph", name: "draggable", graph: draggable},
      fallable: {
        type: "subgraph",
        name: "fallable",
        grabbed: ["draggable", "grabbed"],
        jump: 0,
        height: 0,
        graph: fallable,
      },
      aboveGround: {type: "output", name: "aboveGround", input: ["fallable", "aboveGround"]},
    },
    leftRightArrowsRotate: {
      left: {type: "key", code: 37},
      right: {type: "key", code: 39},
      leftRight: {type: "subtract", a: "left", b: "right"},
      speed: {type: "property", name: "speed", defaultValue: 120},
      clock: {type: "clock"},
      leftRightDelta: {type: "multiply", inputs: ["leftRight", "speed", "clock"]},
      rotation: {type: "vec3.fromValues", y: "leftRightDelta"},
      rotate: {type: "rotate", input: "rotation"},
    },
    forwardBackArrowsMove: {
      forward: {type: "key", code: 38},
      back: {type: "key", code: 40},
      forwardBack: {type: "subtract", a: "forward", b: "back"},
      speed: {type: "property", name: "speed", defaultValue: 2},
      clock: {type: "clock"},
      forwardBackDelta: {type: "multiply", inputs: ["forwardBack", "speed", "clock"]},
      translation: {type: "vec3.fromValues", z: "forwardBackDelta"},
      translate: {type: "translate", input: "translation"},
    },
  })

  registry.registerSubgraphs(["engine", "camera"], {
    dragToRotate: {
      hover: {type: "hover"},
      viewMovement: {type: "vec3.split", input: ["hover", "viewMovement"]},
      updateRotation: {
        type: "component",
        compType: "transform",
        rotation: {
          type: "quat.fromEuler",
          x: {
            type: "accumulate",
            min: -90,
            max: 90,
            input: {type: "multiply", inputs: [["hover", "pressed"], ["viewMovement", "y"], -60]},
          },
          y: {
            type: "accumulate",
            input: {type: "multiply", inputs: [["hover", "pressed"], ["viewMovement", "x"], 60]},
          },
        },
      },
    },
    wasdMovement: {
      translate: {
        type: "translate",
        frame: "world",
        input: {
          type: "vec3.projectOnPlane",
          input: {
            type: "vec3.transformQuat",
            vector: {
              type: "vec3.scale",
              vector: {
                type: "vec3.fromValues",
                x: {type: "subtract", a: {type: "key", code: 68}, b: {type: "key", code: 65}},
                z: {type: "subtract", a: {type: "key", code: 83}, b: {type: "key", code: 87}},
              },
              scalar: {
                type: "multiply",
                inputs: [{type: "clock"}, {type: "property", name: "speed", defaultValue: 10}],
              },
            },
            quaternion: [{type: "component"}, "rotation"],
          },
        },
      },
    },
    spaceToJump: {
      fallable: {
        type: "subgraph",
        name: "fallable",
        grabbed: false,
        jump: {
          type: "multiply",
          inputs: [
            {type: "key", code: 32},
            {type: "property", name: "speed", defaultValue: 3},
          ],
        },
        height: 1,
        graph: fallable,
      },
    },
  })
}
