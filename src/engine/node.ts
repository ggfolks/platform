import {dim2} from "../core/math"
import {Value} from "../core/react"
import {Graph} from "../graph/graph"
import {property, outputEdge} from "../graph/meta"
import {Node, NodeConfig, NodeTypeRegistry} from "../graph/node"
import {SubgraphRegistry} from "../graph/util"
import {PointerConfig} from "../input/node"
import {windowSize} from "../scene2/gl"

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

class Hover extends Node {

  constructor (graph :Graph, id :string, readonly config :HoverConfig) {
    super(graph, id, config)
  }
}

/** Registers the nodes in this module with the supplied registry. */
export function registerEngineNodes (registry :NodeTypeRegistry) {
  registry.registerNodeTypes(["engine"], {
    hover: Hover,
  })
}

/** Registers the subgraphs in this module with the supplied registry. */
export function registerEngineSubgraphs (registry :SubgraphRegistry) {
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
  })
}
