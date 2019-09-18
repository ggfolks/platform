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
  CategoryNode, InputEdge, InputEdges, Node, NodeConfig,
  NodeContext, NodeInput, NodeTypeRegistry,
} from "../graph/node"
import {HAnchor, Host, Root, RootConfig, VAnchor, getCurrentEditNumber} from "./element"
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
  selection? :Set<string>
  add? :GraphConfig
  edit? :GraphEditConfig
  remove? :Set<string>
}

interface FullNodeEdit extends NodeEdit {
  selection :Set<string>
  add :GraphConfig
  edit :GraphEditConfig
  remove :Set<string>
}

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
      const setSelection = (newSelection :Set<string>) => {
        selection.clear()
        for (const id of newSelection) selection.add(id)
      }
      const nodeCreator = Mutable.local<NodeCreator>(() => new Map())
      const nodeEditor = Mutable.local<NodeEditor>(
        edit => ({selection: new Set(), add: {}, edit: {}, remove: new Set()}),
      )
      const canUndo = Mutable.local(false)
      const canRedo = Mutable.local(false)
      const undoStack :FullNodeEdit[] = []
      const redoStack :FullNodeEdit[] = []
      const applyEdit = (edit :NodeEdit) => {
        const oldSelection = new Set(selection)
        const reverseEdit = nodeEditor.current(edit)
        if (edit.selection) setSelection(edit.selection)
        const lastEdit = undoStack[undoStack.length - 1]
        const currentEditNumber = getCurrentEditNumber()
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
          reverseEdit.selection = oldSelection
          undoStack.push(reverseEdit)
        }
        redoStack.length = 0
        canUndo.update(true)
        canRedo.update(false)
      }
      function getCategoryKeys (category :CategoryNode) :Value<string[]> {
        return category.children.keysValue().map<string[]>(Array.from)
      }
      function getCategoryData (
        category :CategoryNode,
        createConfig :(name :string) => NodeConfig,
      ) :ModelProvider {
        return mapProvider(category.children, (value, key) => {
          if (value.current instanceof CategoryNode) return {
            name: Value.constant(key),
            submenu: Value.constant(true),
            keys: getCategoryKeys(value.current),
            data: getCategoryData(value.current, createConfig),
          }
          return {
            name: Value.constant(key),
            action: () => nodeCreator.current({[key as string]: createConfig(key as string)}),
          } as ModelData
        })
      }
      const model = new Model({
        ...this.config.model,
        remove: () => {
          ctx.host.removeRoot(root)
          root.dispose()
          disposer.dispose()
        },
        typeCategoryKeys: getCategoryKeys(ctx.types.root),
        typeCategoryData: getCategoryData(ctx.types.root, name => ({type: name})),
        subgraphCategoryKeys: getCategoryKeys(ctx.subgraphs.root),
        subgraphCategoryData: getCategoryData(
          ctx.subgraphs.root,
          name => ctx.subgraphs.createNodeConfig(name),
        ),
        selection,
        nodeCreator,
        nodeEditor,
        applyEdit: Value.constant(applyEdit),
        canUndo,
        undo: () => {
          const oldSelection = new Set(selection)
          const edit = undoStack.pop()!
          const reverseEdit = nodeEditor.current(edit)
          setSelection(edit.selection)
          reverseEdit.selection = oldSelection
          redoStack.push(reverseEdit)
          canRedo.update(true)
          canUndo.update(undoStack.length > 0)
        },
        canRedo,
        redo: () => {
          const oldSelection = new Set(selection)
          const edit = redoStack.pop()!
          const reverseEdit = nodeEditor.current(edit)
          setSelection(edit.selection)
          reverseEdit.selection = oldSelection
          undoStack.push(reverseEdit)
          canUndo.update(true)
          canRedo.update(redoStack.length > 0)
        },
        clearUndoStacks: () => {
          undoStack.length = 0
          redoStack.length = 0
          canUndo.update(false)
          canRedo.update(false)
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
  const nodeModels = new Map<ModelKey, Model>()
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
      applyEdit({selection: new Set(ids.values()), add})
      return ids
    }),
    editNodes: Value.constant((edit :NodeEdit) => {
      const reverseAdd :GraphConfig = {}
      const reverseEdit :GraphEditConfig = {}
      const reverseRemove = new Set<string>()
      if (edit.remove) {
        for (const id of edit.remove) {
          reverseAdd[id] = graph.removeNode(id)
          nodeModels.delete(id)
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
      applyEdit({selection: new Set(), remove: new Set(graph.nodes.keys())})
    },
    copyNodes: Value.constant((ids :Set<string>) => {
      const config = {}
      for (const id of ids) config[id] = graph.nodes.get(id)!.toJSON()
      return config
    }),
    toJSON: Value.constant(() => graph.toJSON()),
    fromJSON: Value.constant((json :GraphConfig) => {
      graph.fromJSON(json)
      nodeModels.clear() // force update to node data
    }),
    nodeKeys: graph.nodes.keysValue(),
    nodeData: {
      resolve: (key :ModelKey) => {
        let model = nodeModels.get(key)
        if (!model) {
          const node = graph.nodes.require(key as string)
          const type = node.config.type
          const subgraphElement :ModelData = {}
          if (type === "subgraph") {
            const subgraph = node as Subgraph
            subgraphElement.subgraph = createGraphModelData(subgraph.containedGraph, applyEdit)
          }
          function createPropertyValue (key :ModelKey, defaultValue? :Value<any>) {
            const property = node.getProperty(key as string)
            return Mutable.deriveMutable(
              dispatch => property.onChange(dispatch),
              () => getValue(property.current, defaultValue && defaultValue.current),
              input => {
                applyEdit({
                  edit: {
                    [node.id]: {[key]: input},
                  },
                })
              },
              refEquals,
            )
          }
          if (!node.config.position) node.config.position = [0, 0]
          nodeModels.set(key, model = new Model({
            id: Value.constant(node.id),
            type: Value.constant(type),
            title: node.title,
            position: createPropertyValue("position"),
            ...subgraphElement,
            propertyKeys: node.propertiesMeta.keysValue().map(Array.from),
            inputKeys: node.inputsMeta.keysValue().map(Array.from),
            outputKeys: node.outputsMeta.keysValue().map(Array.from),
            defaultOutputKey: Value.constant(node.defaultOutputKey),
            propertyData: mapProvider(node.propertiesMeta, (value, key) => ({
              name: Value.constant(key),
              type: value.map(value => value.type),
              constraints: value.map(value => value.constraints),
              value: createPropertyValue(key, value.map(value => value.defaultValue)),
            })),
            inputData: mapProvider(node.inputsMeta, (value, key) => {
              const multiple = value.map(value => value.multiple)
              const input = createPropertyValue(key)
              return {
                name: Value.constant(key),
                multiple,
                value: input,
                style: Value.join2(multiple, input).switchMap(([multiple, input]) => {
                  if (!multiple) return graph.getValue(input, 0).map(getValueStyle)
                  return graph.getValues(input, 0).map(
                    values => getValueStyle(values[values.length - 1]),
                  )
                }),
              }
            }),
            outputData: mapProvider(node.outputsMeta, (value, key) => ({
              name: Value.constant(key),
              style: node.getOutput(key as string, undefined).map(getValueStyle),
            })),
          }))
        }
        return model
      },
    },
  }
}

/** Registers the nodes in this module with the supplied registry. */
export function registerUINodes (registry :NodeTypeRegistry) {
  registry.registerNodeTypes(["ui"], {ui: UINode})
}
