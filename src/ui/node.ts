import {vec2} from "gl-matrix"

import {Scale} from "../core/ui"
import {Value} from "../core/react"
import {Graph} from "../graph/graph"
import {inputEdge} from "../graph/meta"
import {Subgraph} from "../graph/util"
import {Node, NodeConfig, NodeContext, NodeTypeRegistry} from "../graph/node"
import {Host, Root, RootConfig} from "./element"
import {Model, ModelData, ModelKey, mapProvider} from "./model"
import {Theme, UI} from "./ui"
import {ImageResolver, StyleDefs} from "./style"

/** Context for nodes relating to UI. */
export interface UINodeContext extends NodeContext {
  host :Host
  theme :Theme
  styles :StyleDefs
  image :ImageResolver
}

/** Creates a UI element when the input becomes true. */
abstract class UINodeConfig implements NodeConfig {
  type = "UI"
  model? :ModelData
  root :RootConfig = {type: "root", scale: Scale.ONE, contents: {type: ""}}
  origin? :vec2
  size? :vec2
  @inputEdge("boolean") input = undefined
}

class UINode extends Node {

  constructor (graph :Graph, id :string, readonly config :UINodeConfig) {
    super(graph, id, config)
  }

  connect () {
    this._disposer.add(this.graph.getValue(this.config.input, false).onValue(value => {
      if (value) {
        let graph = this.graph
        while (graph.ctx.subgraph) graph = graph.ctx.subgraph.graph
        const ctx = this.graph.ctx as UINodeContext
        let root :Root | undefined
        const ui = new UI(ctx.theme, ctx.styles, ctx.image)
        root = ui.createRoot(this.config.root, new Model({
          ...this.config.model,
          remove: () => {
            if (root) {
              ctx.host.removeRoot(root)
              root.dispose()
            }
          },
          ...createGraphModelData(graph),
        }))
        if (this.config.size) root.setSize(this.config.size)
        else root.sizeToFit()
        if (this.config.origin) root.setOrigin(this.config.origin)
        ctx.host.addRoot(root)
      }
    }))
  }
}

function createGraphModelData (graph :Graph) :ModelData {
  return {
    nodeKeys: graph.nodes.keysSource(),
    nodeData: mapProvider(graph.nodes, value => {
      const type = value.current.config.type
      const subgraphElement :ModelData = {}
      if (type === "subgraph") {
        const subgraph = value.current as Subgraph
        subgraphElement.subgraph = createGraphModelData(subgraph.containedGraph)
      }
      return {
        id: Value.constant(value.current.id),
        type: Value.constant(type),
        ...subgraphElement,
        propertyKeys: Value.constant(Object.keys(value.current.propertiesMeta)),
        inputKeys: Value.constant(Object.keys(value.current.inputsMeta)),
        outputKeys: Value.constant(Object.keys(value.current.outputsMeta)),
        defaultOutputKey: Value.constant(value.current.defaultOutputKey),
        property: {
          resolve: (key :ModelKey) => {
            const propertiesMeta = value.current.propertiesMeta[key]
            const configValue = value.current.config[key]
            return new Model({
              name: Value.constant(key),
              constraints: Value.constant(propertiesMeta.constraints),
              value: Value.constant(
                configValue === undefined ? propertiesMeta.defaultValue : configValue,
              ),
            })
          },
        },
        input: {
          resolve: (key :ModelKey) => new Model({
            name: Value.constant(key),
            multiple: Value.constant(value.current.inputsMeta[key].multiple),
            value: Value.constant(value.current.config[key]),
          }),
        },
        output: {
          resolve: (key :ModelKey) => new Model({
            name: Value.constant(key),
            isDefault: Value.constant(value.current.outputsMeta[key].isDefault),
            value: value.current.getOutput(key as string, undefined),
          }),
        },
      }
    }),
  }
}

/** Registers the nodes in this module with the supplied registry. */
export function registerUINodes (registry :NodeTypeRegistry) {
  registry.registerNodeType("UI", UINode)
}
