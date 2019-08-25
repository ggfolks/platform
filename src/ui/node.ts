import {dim2, vec2} from "../core/math"
import {Scale, getValueStyle} from "../core/ui"
import {Value} from "../core/react"
import {Disposer} from "../core/util"
import {Graph} from "../graph/graph"
import {inputEdge} from "../graph/meta"
import {Subgraph} from "../graph/util"
import {Node, NodeConfig, NodeContext, NodeTypeRegistry} from "../graph/node"
import {HAnchor, Host, Root, RootConfig, VAnchor} from "./element"
import {Model, ModelData, ModelKey, mapProvider} from "./model"
import {Theme, UI} from "./ui"
import {ImageResolver, StyleDefs} from "./style"

/** Context for nodes relating to UI. */
export interface UINodeContext extends NodeContext {
  host :Host
  theme :Theme
  styles :StyleDefs
  image :ImageResolver
  screen :Value<dim2>
}

/** Creates a UI element when the input becomes true. */
abstract class UINodeConfig implements NodeConfig {
  type = "UI"
  model? :ModelData
  root :RootConfig = {type: "root", scale: Scale.ONE, contents: {type: ""}}
  origin? :vec2
  size? :vec2
  screenH? :HAnchor
  screenV? :VAnchor
  rootH? :HAnchor
  rootV? :VAnchor
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
        let root :Root
        const ui = new UI(ctx.theme, ctx.styles, ctx.image)
        const disposer = new Disposer()
        root = ui.createRoot(this.config.root, new Model({
          ...this.config.model,
          remove: () => {
            ctx.host.removeRoot(root)
            root.dispose()
            disposer.dispose()
          },
          ...createGraphModelData(graph),
        }))
        if (this.config.size) root.setSize(this.config.size)
        else root.sizeToFit()
        if (this.config.origin) root.setOrigin(this.config.origin)
        else disposer.add(root.bindOrigin(
          ctx.screen,
          this.config.screenH || "center",
          this.config.screenV || "center",
          this.config.rootH || "center",
          this.config.rootV || "center",
        ))
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
      const inputModels :Map<ModelKey, Model> = new Map()
      const outputModels :Map<ModelKey, Model> = new Map()
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
          resolve: (key :ModelKey) => {
            let model = inputModels.get(key)
            if (!model) {
              const multiple = value.current.inputsMeta[key].multiple
              const input = value.current.config[key]
              let style :Value<string>
              if (multiple) {
                style = value.current.graph.getValues(input, 0).map(
                  values => getValueStyle(values[values.length - 1]),
                )
              } else {
                style = value.current.graph.getValue(input, 0).map(getValueStyle)
              }
              inputModels.set(key, model = new Model({
                name: Value.constant(key),
                multiple: Value.constant(multiple),
                value: Value.constant(input),
                style,
              }))
            }
            return model
          },
        },
        output: {
          resolve: (key :ModelKey) => {
            let model = outputModels.get(key)
            if (!model) {
              outputModels.set(key, model = new Model({
                name: Value.constant(key),
                style: value.current.getOutput(key as string, undefined).map(getValueStyle),
              }))
            }
            return model
          },
        },
      }
    }),
  }
}

/** Registers the nodes in this module with the supplied registry. */
export function registerUINodes (registry :NodeTypeRegistry) {
  registry.registerNodeType("UI", UINode)
}
