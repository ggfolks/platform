import {Euler, dim2, vec3, vec3zero} from "../core/math"
import {Value} from "../core/react"
import {getValue} from "../core/util"
import {Graph} from "../graph/graph"
import {activateNodeConfigs, property, inputEdge, outputEdge} from "../graph/meta"
import {Node, NodeConfig, NodeTypeRegistry} from "../graph/node"
import {SubgraphRegistry} from "../graph/util"
import {PointerConfig} from "../input/node"
import {windowSize} from "../scene2/gl"
import {CoordinateFrame, Graph as GraphComponent, Hover, Hoverable} from "./game"
import {RaycastHit} from "./render"

/** Exposes the properties of a component as inputs and outputs. */
abstract class ComponentConfig implements NodeConfig {
  type = "component"
  @property() compType = "transform" // TODO: special property type to select from existing
}

class ComponentNode extends Node {

  constructor (graph :Graph, id :string, readonly config :ComponentConfig) {
    super(graph, id, config)
  }

  protected _createOutput (name :string, defaultValue :any) :Value<any> {
    const graphComponent = this.graph.ctx.graphComponent as GraphComponent|undefined
    if (!graphComponent) return Value.constant(defaultValue)
    return graphComponent.gameObject
      .getComponentValue(getValue(this.config.compType, "transform"))
      .switchMap(
        component => component
          ? component.getProperty(name, defaultValue)
          : Value.constant(defaultValue)
      )
  }
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

class HoverNode extends Node {

  constructor (graph :Graph, id :string, readonly config :HoverConfig) {
    super(graph, id, config)
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
    let hover :Value<Hover|undefined>
    const component = this.graph.ctx.graphComponent as GraphComponent|undefined
    if (component) {
      hover = component.gameObject.getComponentValue<Hoverable>("hoverable")
        .switchMap(hoverable => {
          if (!hoverable) return Value.constant<Hover|undefined>(undefined)
          return hoverable.hovers.fold(
            getHover(hoverable.hovers),
            (hover, hovers) => getHover(hovers),
          )
        })
    } else {
      hover = Value.constant<Hover|undefined>(undefined)
    }
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
    const origin = this.graph.getValue(this.config.origin, vec3.create())
    const direction = this.graph.getValue(this.config.direction, vec3.fromValues(0, 0, 1))
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
  @inputEdge("Euler") input = undefined
}

class Rotate extends Node {

  constructor (graph :Graph, id :string, readonly config :RotateConfig) {
    super(graph, id, config)
  }

  connect () {
    const component = this.graph.ctx.graphComponent as GraphComponent|undefined
    if (!component) return
    const input = this.graph.getValue(this.config.input, Euler.create())
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
    const input = this.graph.getValue(this.config.input, vec3.create())
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
    pointerDraggable: draggable,
    fallable,
    draggableFallable: {
      draggable: {type: "subgraph", title: "draggable", graph: draggable},
      fallable: {
        type: "subgraph",
        title: "fallable",
        grabbed: ["draggable", "grabbed"],
        jump: 0,
        height: 0,
        graph: fallable,
      },
      aboveGround: {type: "output", name: "aboveGround", input: ["fallable", "aboveGround"]},
    },
  })
}
