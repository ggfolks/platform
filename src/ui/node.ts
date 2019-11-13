import {dataEquals, refEquals} from "../core/data"
import {dim2, rect} from "../core/math"
import {Scale, getValueStyle} from "../core/ui"
import {ChangeFn, Mutable, Value} from "../core/react"
import {MutableSet} from "../core/rcollect"
import {Disposer, Noop, PMap, getValue, filteredIterable} from "../core/util"
import {Graph, GraphConfig} from "../graph/graph"
import {getNodeMeta, inputEdge} from "../graph/meta"
import {Page, Subgraph} from "../graph/util"
import {
  CategoryNode, InputEdge, InputEdges, Node, NodeConfig,
  NodeContext, NodeInput, NodeTypeRegistry,
} from "../graph/node"
import {Host, Root, getCurrentEditNumber} from "./element"
import {Action, Command, Model, ModelData, ModelKey, ElementsModel, mapModel} from "./model"
import {makePropertiesModel} from "./property"
import {Theme, UI} from "./ui"
import {ImageResolver, StyleDefs} from "./style"

export type InputValue = InputEdge<any> | InputEdges<any>

/** Context for nodes relating to UI. */
export interface UINodeContext extends NodeContext {
  host :Host
  theme :Theme
  styles :StyleDefs
  image :ImageResolver
  screen :Value<rect>
}

/** Creates a UI element when the input becomes true. */
abstract class UINodeConfig implements NodeConfig {
  type = "ui"
  model? :ModelData
  root :Root.Config = {type: "root", scale: Scale.ONE, contents: {type: ""}}
  rootBounds? :rect
  screenH? :Root.HAnchor
  screenV? :Root.VAnchor
  rootH? :Root.HAnchor
  rootV? :Root.VAnchor
  @inputEdge("boolean") input = undefined
}

export type NodeCreator = (config :GraphConfig) => Map<string, string>
export type NodeEditor = (edit :NodeEdit) => FullNodeEdit
export type NodeRemover = (ids :Set<string>) => void
export type NodeCopier = (ids :Set<string>) => GraphConfig

const NoopEditor :NodeEditor = edit =>
  ({path: [], activePage: "default", selection: new Set(), add: {}, edit: {}, remove: new Set()})

export interface GraphEditConfig {
  [id :string] :PMap<any>
}

export interface NodeEdit {
  editNumber? :number
  path? :string[]
  page? :string
  activePage? :string
  selection? :Set<string>
  add? :GraphConfig
  edit? :GraphEditConfig
  remove? :Set<string>
}

interface FullNodeEdit extends NodeEdit {
  path :string[]
  activePage :string
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
      // we may have started out in a subgraph; in that case, rise to the outermost graph
      while (graph.ctx.subgraph) graph = graph.ctx.subgraph.graph
      const ctx = this.graph.ctx as UINodeContext
      let root :Root
      const ui = new UI(ctx.theme, ctx.styles, ctx.image)
      const disposer = new Disposer()
      const path = Mutable.local<string[]>([])
      const activePage = Mutable.local("default")
      const selection = MutableSet.local<string>()
      const setSelection = (newSelection :Set<string>) => {
        // remove anything not in the new selection
        for (const id of selection) {
          if (!newSelection.has(id)) selection.delete(id)
        }
        // add anything not in the old selection
        for (const id of newSelection) selection.add(id)
      }
      const pageEditor = Mutable.local<NodeEditor>(NoopEditor)
      const nodeCreator = Mutable.local<NodeCreator>(() => new Map())
      const graphModel = Mutable.local<Model>(new Model({}))
      const setPath = (newPath :string[]) => {
        activePage.update("default")
        selection.clear()
        path.update(newPath)
        let pathGraph = graph
        for (const id of newPath) {
          const subgraph = pathGraph.nodes.require(id) as Subgraph
          pathGraph = subgraph.containedGraph
        }
        const data = createGraphModelData(pathGraph, activePage, applyEdit, reloadPath)
        pageEditor.update(data.editPages as NodeEditor)
        graphModel.update(new Model(data))
      }
      const reloadPath = () => setPath(path.current)
      const canUndo = Mutable.local(false)
      const canRedo = Mutable.local(false)
      const undoStack :FullNodeEdit[] = []
      const redoStack :FullNodeEdit[] = []
      const applyEdit = (edit :NodeEdit) => {
        const oldPath = path.current.slice()
        const oldActivePage = activePage.current
        const oldSelection = new Set(selection)
        const reverseEdit = pageEditor.current(edit)
        if (edit.path) setPath(edit.path)
        if (edit.activePage) activePage.update(edit.activePage)
        if (edit.selection) setSelection(edit.selection)
        const lastEdit = undoStack[undoStack.length - 1]
        const currentEditNumber = getCurrentEditNumber()
        if (lastEdit && lastEdit.editNumber === currentEditNumber && lastEdit.page === edit.page) {
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
          reverseEdit.path = oldPath
          reverseEdit.activePage = oldActivePage
          reverseEdit.selection = oldSelection
          undoStack.push(reverseEdit)
        }
        redoStack.length = 0
        canUndo.update(true)
        canRedo.update(false)
      }
      setPath([])
      function getCategoryModel (
        category :CategoryNode,
        createConfig :(name :string) => NodeConfig
      ) :ElementsModel<string> {
        return mapModel(category.children.keysValue, category.children, (value, key) => {
          if (value.current instanceof CategoryNode) return {
            name: Value.constant(key),
            submenu: Value.constant(true),
            model: getCategoryModel(value.current, createConfig),
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
        typeCategoryModel: getCategoryModel(ctx.types.root, name => ({type: name})),
        subgraphCategoryModel: getCategoryModel(
          ctx.subgraphs.root,
          name => ctx.subgraphs.createNodeConfig(name),
        ),
        path,
        push: (id :string) => {
          const newPath = path.current.slice()
          newPath.push(id)
          setPath(newPath)
        },
        pop: new Command(() => setPath(path.current.slice(0, path.current.length - 1)),
                         path.map(path => path.length > 0)),
        graphModel,
        activePage,
        selection,
        nodeCreator,
        applyEdit,
        undo: new Command(() => {
          const oldSelection = new Set(selection)
          const edit = undoStack.pop()!
          setPath(edit.path)
          activePage.update(edit.activePage)
          const reverseEdit = pageEditor.current(edit)
          setSelection(edit.selection)
          reverseEdit.path = edit.path
          reverseEdit.activePage = edit.activePage
          reverseEdit.selection = oldSelection
          redoStack.push(reverseEdit)
          canRedo.update(true)
          canUndo.update(undoStack.length > 0)
        }, canUndo),
        redo: new Command(() => {
          const oldSelection = new Set(selection)
          const edit = redoStack.pop()!
          setPath(edit.path)
          activePage.update(edit.activePage)
          const reverseEdit = pageEditor.current(edit)
          setSelection(edit.selection)
          reverseEdit.path = edit.path
          reverseEdit.activePage = edit.activePage
          reverseEdit.selection = oldSelection
          undoStack.push(reverseEdit)
          canUndo.update(true)
          canRedo.update(redoStack.length > 0)
        }, canRedo),
        clearUndoStacks: () => {
          undoStack.length = 0
          redoStack.length = 0
          canUndo.update(false)
          canRedo.update(false)
        },
      })
      root = ui.createRoot(this.config.root, model)
      if (this.config.rootBounds) {
        root.setSize(rect.size(this.config.rootBounds))
        root.setOrigin(rect.pos(this.config.rootBounds))
      }
      else {
        root.setSize(dim2.fromValues(Math.round(ctx.screen.current[2]*0.9),
                                     Math.round(ctx.screen.current[3]*0.9)))
        disposer.add(root.bindOrigin(
          ctx.screen,
          this.config.screenH || "center",
          this.config.screenV || "center",
          this.config.rootH || "center",
          this.config.rootV || "center",
        ))
      }
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

function createGraphModelData (
  graph :Graph,
  activePage :Mutable<string>,
  applyEdit :(edit :NodeEdit) => void,
  reloadPath :Action,
) :ModelData {
  const pageModels = new Map<ModelKey, Model>()
  let currentPageKeys :string[] = []
  let changeFn :ChangeFn<string[]> = Noop
  const getOrder = (id :string) => {
    if (id === "default") return 0
    return graph.nodes.require(id).config.order || 0
  }
  const updatePageKeys = () => {
    const oldPageKeys = currentPageKeys
    currentPageKeys = ["default"]
    for (const [id, node] of graph.nodes) {
      if (node.config.type === "page") currentPageKeys.push(id)
    }
    currentPageKeys.sort((a, b) => getOrder(a) - getOrder(b))
    changeFn(currentPageKeys, oldPageKeys)
  }
  updatePageKeys()
  const pagesModel = {
    keys: Value.deriveValue(
      dataEquals,
      dispatch => {
        changeFn = dispatch
        return graph.nodes.keysValue.onValue(updatePageKeys)
      },
      () => currentPageKeys,
    ),
    resolve: (key :ModelKey) => {
      let model = pageModels.get(key)
      if (!model) {
        const id = key as string
        let containedGraph = graph
        let remove = Noop
        let name = Value.constant(id)
        if (key !== "default") {
          const page = graph.nodes.require(id) as Page
          containedGraph = page.containedGraph
          const createPropertyValue = createPropertyValueCreator(page, applyEdit)
          name = createPropertyValue("name")
          remove = () => {
            let newActivePage = activePage.current
            if (activePage.current === id) {
              const index = currentPageKeys.indexOf(id)
              newActivePage = currentPageKeys[
                index === currentPageKeys.length - 1 ? index - 1 : index + 1
              ]
            }
            applyEdit({activePage: newActivePage, remove: new Set([id])})
          }
        }
        pageModels.set(key, model = new Model(createPageModelData(
          containedGraph,
          activePage,
          applyEdit,
          reloadPath,
          id,
          name,
          remove,
        )))
      }
      return model
    },
  }
  const pageEditor = createNodeEditor(graph, pageModels)
  return {
    pagesModel,
    createPage: () => {
      // find a unique id for the page
      let pageId = ""
      for (let ii = 2;; ii++) {
        const id = "page" + ii
        if (!graph.nodes.has(id)) {
          pageId = id
          break
        }
      }
      applyEdit({activePage: pageId, add: {
        [pageId]: {
          type: "page",
          name: pageId,
          order: getOrder(currentPageKeys[currentPageKeys.length - 1]) + 1,
          graph: {},
        },
      }})
    },
    updateOrder: (id :string, index :number) => {
      const currentIndex = currentPageKeys.indexOf(id)
      if (currentIndex === index) return
      const edit = {edit: {}}
      if (id === "default") {
        // to reorder the default page, we adjust the order of everything around it
        let order = -1
        for (let ii = index - 1; ii >= 0; ii--) {
          const key = currentPageKeys[ii]
          if (key !== "default") edit.edit[key] = {order: order--}
        }
        order = 1
        for (let ii = index; ii < currentPageKeys.length; ii++) {
          const key = currentPageKeys[ii]
          if (key !== "default") edit.edit[key] = {order: order++}
        }
      } else {
        // to reorder an ordinary page, we change its order
        let newOrder :number
        switch (index) {
          case 0:
            newOrder = getOrder(currentPageKeys[0]) - 1
            break
          case currentPageKeys.length:
            newOrder = getOrder(currentPageKeys[currentPageKeys.length - 1]) + 1
            break
          default:
            newOrder = (getOrder(currentPageKeys[index]) + getOrder(currentPageKeys[index - 1])) / 2
            break
        }
        edit.edit[id] = {order: newOrder}
      }
      applyEdit(edit)
    },
    removeAll: () => {
      applyEdit({activePage: "default", selection: new Set(), remove: new Set(graph.nodes.keys())})
    },
    editPages: (edit :NodeEdit) => {
      if (edit.page) {
        // forward to appropriate page model
        const model = pagesModel.resolve(edit.page)
        return model.resolve<NodeEditor>("editNodes")(edit)
      }
      const result = pageEditor(edit)
      updatePageKeys()
      return result
    },
    toJSON: () => graph.toJSON(),
    fromJSON: (json :GraphConfig) => {
      graph.fromJSON(json)
      reloadPath()
    },
  }
}

function createPageModelData (
  graph :Graph,
  activePage :Mutable<string>,
  applyEdit :(edit :NodeEdit) => void,
  reloadPath :Action,
  page :string,
  name :Value<string>,
  remove :Action,
) :ModelData {
  const nodeModels = new Map<ModelKey, Model>()
  return {
    id: Value.constant(page),
    name,
    removable: Value.constant(remove !== Noop),
    remove,
    createNodes: (config :GraphConfig) => {
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
      applyEdit({page, selection: new Set(ids.values()), add})
      return ids
    },
    editNodes: createNodeEditor(graph, nodeModels),
    copyNodes: (ids :Set<string>) => {
      const config = {}
      for (const id of ids) config[id] = graph.nodes.get(id)!.toJSON()
      return config
    },
    nodesModel: {
      keys: graph.nodes.keysValue.map(keys => filteredIterable(
        keys,
        key => graph.nodes.require(key).config.type !== "page",
      )),
      resolve: (key :ModelKey) => {
        let model = nodeModels.get(key)
        if (!model) {
          const node = graph.nodes.require(key as string)
          const type = node.config.type
          const subgraphElement :ModelData = {}
          if (type === "subgraph") {
            const subgraph = node as Subgraph
            subgraphElement.subgraph = createGraphModelData(
              subgraph.containedGraph,
              activePage,
              applyEdit,
              reloadPath,
            )
          }
          const createPropertyValue = createPropertyValueCreator(node, applyEdit, page)
          if (!node.config._position) node.config._position = [0, 0]
          nodeModels.set(key, model = new Model({
            id: Value.constant(node.id),
            type: Value.constant(type),
            name: node.name,
            position: createPropertyValue("_position"),
            ...subgraphElement,
            defaultOutputKey: Value.constant(node.defaultOutputKey),
            propertiesModel: makePropertiesModel(
              node.propertiesMeta,
              (key, value) => createPropertyValue(key, value.map(value => value.defaultValue)),
            ),
            inputsModel: mapModel(node.inputsMeta.keysValue, node.inputsMeta, (value, key) => {
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
            outputsModel: mapModel(node.outputsMeta.keysValue, node.outputsMeta, (value, key) => ({
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

function createNodeEditor (graph :Graph, models :Map<ModelKey, Model>) {
  return (edit :NodeEdit) => {
    const reverseAdd :GraphConfig = {}
    const reverseEdit :GraphEditConfig = {}
    const reverseRemove = new Set<string>()
    if (edit.remove) {
      for (const id of edit.remove) {
        reverseAdd[id] = graph.removeNode(id)
        models.delete(id)
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
    return {page: edit.page, add: reverseAdd, edit: reverseEdit, remove: reverseRemove}
  }
}

function createPropertyValueCreator (
  node :Node,
  applyEdit :(edit :NodeEdit) => void,
  page? :string,
) {
  return (key :ModelKey, defaultValue? :Value<any>) => {
    const property = node.getProperty(key as string)
    return Mutable.deriveMutable(
      dispatch => property.onChange(dispatch),
      () => getValue(property.current, defaultValue && defaultValue.current),
      input => {
        applyEdit({
          page,
          edit: {
            [node.id]: {[key]: input},
          },
        })
      },
      refEquals,
    )
  }
}

/** Registers the nodes in this module with the supplied registry. */
export function registerUINodes (registry :NodeTypeRegistry) {
  registry.registerNodeTypes(["ui"], {ui: UINode})
}
