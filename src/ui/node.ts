import {refEquals} from "../core/data"
import {dim2, vec2} from "../core/math"
import {Scale, getValueStyle} from "../core/ui"
import {ChangeFn, Mutable, Value} from "../core/react"
import {Disposer, Noop, getValue} from "../core/util"
import {Graph, GraphConfig} from "../graph/graph"
import {inputEdge} from "../graph/meta"
import {Subgraph} from "../graph/util"
import {InputEdge, InputEdges, Node, NodeConfig, NodeContext, NodeTypeRegistry} from "../graph/node"
import {HAnchor, Host, Root, RootConfig, VAnchor} from "./element"
import {Model, ModelData, ModelKey, ModelProvider, mapProvider} from "./model"
import {Theme, UI} from "./ui"
import {ImageResolver, StyleDefs} from "./style"

export type InputValue = InputEdge<any> | InputEdges<any>

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
  type = "ui"
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

export type NodeCreator = (type :string) => void

class UINode extends Node {

  constructor (graph :Graph, id :string, readonly config :UINodeConfig) {
    super(graph, id, config)
  }

  connect () {
    this._disposer.add(this.graph.getValue(this.config.input, false).onValue(value => {
      if (!value) return
      let graph = this.graph
      while (graph.ctx.subgraph) graph = graph.ctx.subgraph.graph
      const ctx = this.graph.ctx as UINodeContext
      let root :Root
      const ui = new UI(ctx.theme, ctx.styles, ctx.image)
      const disposer = new Disposer()
      const nodeCreator = Mutable.local<NodeCreator>(Noop)
      const model = new Model({
        ...this.config.model,
        remove: () => {
          ctx.host.removeRoot(root)
          root.dispose()
          disposer.dispose()
        },
        categoryKeys: ctx.types.categories.keysSource().map(Array.from),
        categoryData: mapProvider(ctx.types.categories, (value, key) => ({
          name: Value.constant(key),
          submenu: Value.constant(true),
          keys: value,
          data: {
            resolve: (key :ModelKey) => new Model({
              name: Value.constant(key),
              action: () => nodeCreator.current(key as string),
            }),
          },
        })),
        nodeCreator,
        ...createGraphModelData(graph),
      })
      root = ui.createRoot(this.config.root, model)
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
    }))
  }

  toJSON () :NodeConfig {
    const json = super.toJSON()
    // delete what we can't convert
    delete json.model
    delete json.root
    delete json.origin
    delete json.size
    return json
  }
}

function createGraphModelData (graph :Graph) :ModelData {
  let nodeData :ModelProvider|undefined
  return {
    createNode: Value.constant((type :string) => graph.createNode(type)),
    removeAllNodes: () => {
      graph.removeAllNodes()
      nodeData = undefined
    },
    toJSON: Value.constant(() => graph.toJSON()),
    fromJSON: Value.constant((json :GraphConfig) => {
      graph.fromJSON(json)
      nodeData = undefined // force update to node data
    }),
    nodeKeys: graph.nodes.keysSource(),
    nodeData: {
      resolve: (key :ModelKey) => {
        if (!nodeData) nodeData = mapProvider(graph.nodes, value => {
          const type = value.current.config.type
          const subgraphElement :ModelData = {}
          if (type === "subgraph") {
            const subgraph = value.current as Subgraph
            subgraphElement.subgraph = createGraphModelData(subgraph.containedGraph)
          }
          const propertyModels :Map<ModelKey, Model> = new Map()
          const inputModels :Map<ModelKey, Model> = new Map()
          const outputModels :Map<ModelKey, Model> = new Map()

          function createPropertyValue (key :ModelKey, defaultValue :any = undefined) {
            let onChange :ChangeFn<InputValue> = Noop
            return Mutable.deriveMutable(
              dispatch => {
                onChange = dispatch
                return Noop
              },
              () => getValue(value.current.config[key], defaultValue),
              input => {
                const previous = getValue(value.current.config[key], defaultValue)
                value.current.config[key] = input
                value.current.reconnect()
                onChange(input, previous)
              },
              refEquals,
            )
          }
          if (!value.current.config.position) value.current.config.position = [0, 0]
          return {
            id: Value.constant(value.current.id),
            type: Value.constant(type),
            position: Value.constant(value.current.config.position),
            ...subgraphElement,
            propertyKeys: Value.constant(Object.keys(value.current.propertiesMeta)),
            inputKeys: Value.constant(Object.keys(value.current.inputsMeta)),
            outputKeys: Value.constant(Object.keys(value.current.outputsMeta)),
            defaultOutputKey: Value.constant(value.current.defaultOutputKey),
            propertyData: {
              resolve: (key :ModelKey) => {
                let model = propertyModels.get(key)
                if (!model) {
                  const propertiesMeta = value.current.propertiesMeta[key]
                  propertyModels.set(key, model = new Model({
                    name: Value.constant(key),
                    type: Value.constant(propertiesMeta.type),
                    constraints: Value.constant(propertiesMeta.constraints),
                    value: createPropertyValue(key, propertiesMeta.defaultValue),
                  }))
                }
                return model
              },
            },
            inputData: {
              resolve: (key :ModelKey) => {
                let model = inputModels.get(key)
                if (!model) {
                  const multiple = value.current.inputsMeta[key].multiple
                  const input = createPropertyValue(key)
                  let style :Value<string>
                  if (multiple) {
                    style = input.switchMap(input => value.current.graph.getValues(input, 0)).map(
                      values => getValueStyle(values[values.length - 1]),
                    )
                  } else {
                    style = input.switchMap(input => value.current.graph.getValue(input, 0)).map(
                      getValueStyle,
                    )
                  }
                  inputModels.set(key, model = new Model({
                    name: Value.constant(key),
                    multiple: Value.constant(multiple),
                    value: input,
                    style,
                  }))
                }
                return model
              },
            },
            outputData: {
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
        })
        return nodeData.resolve(key)
      },
    },
  }
}

/** Registers the nodes in this module with the supplied registry. */
export function registerUINodes (registry :NodeTypeRegistry) {
  registry.registerNodeTypes("ui", {ui: UINode})
}
