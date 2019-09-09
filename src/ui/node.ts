import {refEquals} from "../core/data"
import {dim2, vec2} from "../core/math"
import {Scale, getValueStyle} from "../core/ui"
import {Mutable, Value} from "../core/react"
import {MutableSet} from "../core/rcollect"
import {Disposer, PMap, getValue} from "../core/util"
import {Graph, GraphConfig} from "../graph/graph"
import {getNodeMeta, inputEdge} from "../graph/meta"
import {Subgraph} from "../graph/util"
import {
  InputEdge, InputEdges, Node, NodeConfig,
  NodeContext, NodeInput, NodeTypeRegistry,
} from "../graph/node"
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

export type NodeCreator = (config :GraphConfig) => Map<string, string>
export type NodeEditor = (edit :NodeEdit) => FullNodeEdit
export type NodeRemover = (ids :Set<string>) => void
export type NodeCopier = (ids :Set<string>) => GraphConfig

export interface GraphEditConfig {
  [id :string] :PMap<any>
}

export interface NodeEdit {
  editNumber? :number
  add? :GraphConfig
  edit? :GraphEditConfig
  remove? :Set<string>
}

interface FullNodeEdit extends NodeEdit {
  add :GraphConfig
  edit :GraphEditConfig
  remove :Set<string>
}

let currentEditNumber = 0
function advanceEditNumber () { currentEditNumber++ }
document.addEventListener("keyup", advanceEditNumber)
document.addEventListener("mouseup", advanceEditNumber)
document.addEventListener("touchend", advanceEditNumber)

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
      const selection = MutableSet.local<string>()
      const nodeCreator = Mutable.local<NodeCreator>(() => new Map())
      const nodeEditor = Mutable.local<NodeEditor>(edit => ({add: {}, edit: {}, remove: new Set()}))
      const canUndo = Mutable.local(false)
      const canRedo = Mutable.local(false)
      const undoStack :FullNodeEdit[] = []
      const redoStack :FullNodeEdit[] = []
      const applyEdit = (edit :NodeEdit) => {
        const reverseEdit = nodeEditor.current(edit)
        const lastEdit = undoStack[undoStack.length - 1]
        if (lastEdit && lastEdit.editNumber === currentEditNumber) {
          // merge into last edit
          for (const id in reverseEdit.add) {
            const nodeConfig = reverseEdit.add[id]
            const editConfig = lastEdit.edit[id]
            if (editConfig) {
              delete lastEdit.edit[id]
              mergeEdits(nodeConfig, editConfig)

            } else if (lastEdit.remove.has(id)) {
              lastEdit.remove.delete(id)
              continue
            }
            lastEdit.add[id] = nodeConfig
          }
          for (const id in reverseEdit.edit) {
            const nodeConfig = reverseEdit.edit[id]
            const editConfig = lastEdit.edit[id]
            if (editConfig) {
              mergeEdits(nodeConfig, editConfig)
            } else if (lastEdit.remove.has(id)) {
              continue
            }
            lastEdit.edit[id] = nodeConfig
          }
          for (const id of reverseEdit.remove) {
            if (!lastEdit.add[id]) {
              lastEdit.remove.add(id)
            }
          }
        } else {
          reverseEdit.editNumber = currentEditNumber
          undoStack.push(reverseEdit)
        }
        redoStack.length = 0
        canUndo.update(true)
        canRedo.update(false)
      }
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
              action: () => nodeCreator.current({[key as string]: {type: (key as string)}}),
            }),
          },
        })),
        selection,
        nodeCreator,
        nodeEditor,
        applyEdit: Value.constant(applyEdit),
        canUndo,
        undo: () => {
          redoStack.push(nodeEditor.current(undoStack.pop()!))
          canRedo.update(true)
          canUndo.update(undoStack.length > 0)
        },
        canRedo,
        redo: () => {
          undoStack.push(nodeEditor.current(redoStack.pop()!))
          canUndo.update(true)
          canRedo.update(redoStack.length > 0)
        },
        ...createGraphModelData(graph, applyEdit),
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

function mergeEdits (first :PMap<any>, second :PMap<any>) {
  for (const key in second) {
    first[key] = second[key]
  }
}

function createGraphModelData (graph :Graph, applyEdit :(edit :NodeEdit) => void) :ModelData {
  let nodeData :ModelProvider|undefined
  return {
    createNodes: Value.constant((config :GraphConfig) => {
      const add :GraphConfig = {}
      const ids = new Map<string, string>()
      for (const oldId in config) {
        // find a unique name based on the original id
        let newId = oldId
        for (let ii = 2; graph.nodes.has(newId); ii++) newId = oldId + ii
        ids.set(oldId, newId)
        add[newId] = config[oldId]
      }
      const convertInput = (input :NodeInput<any>) => {
        if (typeof input === "string") return ids.get(input)
        else if (Array.isArray(input)) {
          const newId = ids.get(input[0])
          return newId === undefined ? undefined : [newId, input[1]]
        } else return input
      }
      for (const oldId in config) {
        const nodeConfig = config[oldId]
        const inputsMeta = getNodeMeta(nodeConfig.type).inputs
        for (const inputKey in inputsMeta) {
          const input = nodeConfig[inputKey]
          if (inputsMeta[inputKey].multiple) {
            if (Array.isArray(input)) {
              nodeConfig[inputKey] = input.map(convertInput)
            }
          } else if (input !== undefined) {
            nodeConfig[inputKey] = convertInput(input)
          }
        }
      }
      applyEdit({add})
      return ids
    }),
    editNodes: Value.constant((edit :NodeEdit) => {
      const reverseAdd :GraphConfig = {}
      const reverseEdit :GraphEditConfig = {}
      const reverseRemove = new Set<string>()
      if (edit.remove) {
        for (const id of edit.remove) {
          reverseAdd[id] = graph.removeNode(id)
        }
      }
      if (edit.add) {
        for (const id in edit.add) {
          graph.createNode(id, edit.add[id])
          reverseRemove.add(id)
        }
      }
      if (edit.edit) {
        for (const id in edit.edit) {
          const node = graph.nodes.require(id)
          const editConfig = edit.edit[id]
          const reverseConfig :PMap<any> = {}
          for (const key in editConfig) {
            const property = node.getProperty(key)
            const currentValue = property.current
            reverseConfig[key] = currentValue === undefined ? null : currentValue
            property.update(editConfig[key])
          }
          reverseEdit[id] = reverseConfig
        }
        for (const id in edit.edit) {
          graph.nodes.require(id).reconnect()
        }
      }
      if (edit.add) {
        for (const id in edit.add) graph.nodes.require(id).connect()
      }
      return {add: reverseAdd, edit: reverseEdit, remove: reverseRemove}
    }),
    removeAllNodes: () => {
      applyEdit({remove: new Set(graph.nodes.keys())})
      nodeData = undefined
    },
    copyNodes: Value.constant((ids :Set<string>) => {
      const config = {}
      for (const id of ids) config[id] = graph.nodes.get(id)!.toJSON()
      return config
    }),
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
            subgraphElement.subgraph = createGraphModelData(subgraph.containedGraph, applyEdit)
          }
          const propertyModels :Map<ModelKey, Model> = new Map()
          const inputModels :Map<ModelKey, Model> = new Map()
          const outputModels :Map<ModelKey, Model> = new Map()

          function createPropertyValue (key :ModelKey, defaultValue :any = undefined) {
            const property = value.current.getProperty(key as string)
            return Mutable.deriveMutable(
              dispatch => property.onChange(dispatch),
              () => getValue(property.current, defaultValue),
              input => {
                applyEdit({
                  edit: {
                    [value.current.id]: {[key]: input},
                  },
                })
              },
              refEquals,
            )
          }
          if (!value.current.config.position) value.current.config.position = [0, 0]
          return {
            id: Value.constant(value.current.id),
            type: Value.constant(type),
            position: createPropertyValue("position"),
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
