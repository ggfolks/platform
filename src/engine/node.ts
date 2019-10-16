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
  activateNodeConfigs(HoverConfig, TranslateConfig)
  registry.registerNodeTypes(["engine"], {
    hover: HoverNode,
    rotate: Rotate,
    translate: Translate,
  })
}

/** Registers the subgraphs in this module with the supplied registry. */
export function registerEngineSubgraphs (registry :SubgraphRegistry) {
  const draggable = {
    hover: {type: "hover"},
    drag: {type: "vec3.scale", vector: ["hover", "worldMovement"], scalar: ["hover", "pressed"]},
    grabbed: {type: "output", name: "grabbed", input: ["hover", "pressed"]},
    translate: {type: "translate", frame: "world", input: "drag"},
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
  })
}
