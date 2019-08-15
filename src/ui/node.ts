import {vec2} from "gl-matrix"

import {vec2zero} from "../core/math"
import {Scale} from "../core/ui"
import {Value} from "../core/react"
import {Graph} from "../graph/graph"
import {getNodeMeta, inputEdge} from "../graph/meta"
import {Node, NodeConfig, NodeContext, NodeTypeRegistry} from "../graph/node"
import {Host, Root, RootConfig} from "./element"
import {Model, ModelData, ModelKey, ModelValue, Spec, mapProvider} from "./model"
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
        class NodeModel extends Model {
          resolve<V extends ModelValue> (spec :Spec<V>) :V {
            // special handling for remove action and node data
            if (spec === "remove") {
              const action = () => {
                if (root) {
                  ctx.host.removeRoot(root)
                  root.dispose()
                }
              }
              return action as V
            } else if (spec === "nodeKeys") {
              return graph.nodes.keysSource() as any
            } else if (spec === "nodeData") {
              return mapProvider(graph.nodes, value => {
                const type = value.current.config.type
                const meta = getNodeMeta(type)
                const resolveName = {
                  resolve: (key :ModelKey) => new Model({name: Value.constant(key)}),
                }
                return {
                  type: Value.constant(type),
                  inputKeys: Value.constant(Object.keys(meta.inputs)),
                  outputKeys: Value.constant(Object.keys(meta.outputs)),
                  input: resolveName,
                  output: resolveName,
                }
              }) as any
            }
            return super.resolve(spec)
          }
        }
        const ui = new UI(ctx.theme, ctx.styles, ctx.image, new NodeModel(this.config.model || {}))
        root = ui.createRoot(this.config.root)
        if (this.config.size) {
          root.pack(this.config.size[0], this.config.size[1])
        } // TODO: else pack to preferred size
        ctx.host.addRoot(root, this.config.origin || vec2zero)
      }
    }))
  }
}

/** Registers the nodes in this module with the supplied registry. */
export function registerUINodes (registry :NodeTypeRegistry) {
  registry.registerNodeType("UI", UINode)
}
