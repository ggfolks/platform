import {Clock} from "../../core/clock"
import {Color} from "../../core/color"
import {refEquals} from "../../core/data"
import {mat4, quat, vec2, vec3, vec4, rect} from "../../core/math"
import {ChangeFn, Mutable, Value} from "../../core/react"
import {MutableMap, RMap} from "../../core/rcollect"
import {Disposer, NoopRemover, PMap, getValue, log} from "../../core/util"
import {ResourceLoader} from "../../asset/loader"
import {Graph as GraphObject, GraphConfig} from "../../graph/graph"
import {CategoryNode, NodeTypeRegistry} from "../../graph/node"
import {registerLogicNodes} from "../../graph/logic"
import {registerMathNodes} from "../../graph/math"
import {PropertyMeta} from "../../graph/meta"
import {
  createColorFn, createQuatFn, createVec2Fn, createVec3Fn, registerMatrixNodes,
} from "../../graph/matrix"
import {registerSignalNodes} from "../../graph/signal"
import {SubgraphRegistry, registerUtilNodes} from "../../graph/util"
import {InteractionManager} from "../../input/interact"
import {registerInputNodes} from "../../input/node"
import {HTMLHost} from "../../ui/element"
import {registerUINodes} from "../../ui/node"
import {DefaultStyles, DefaultTheme} from "../../ui/theme"
import {
  ALL_LAYERS_MASK, DEFAULT_LAYER_FLAG, ALL_HIDE_FLAGS_MASK, DEFAULT_PAGE, Component,
  ComponentConstructor, Configurable, ConfigurableConfig, CoordinateFrame, Coroutine, Cube,
  Cylinder, DefaultTileBounds, ExplicitGeometry, GameContext, GameEngine, GameObject,
  GameObjectConfig, Graph, Indicator, Mesh, MeshFilter, Page, PrimitiveType, Quad, SpaceConfig,
  SpawnPoint, Sphere, Tile, Time, Transform, Updatable,
} from "../game"
import {getConfigurableMeta, property} from "../meta"
import {PhysicsEngine} from "../physics"
import {RenderEngine} from "../render"
import {registerEngineNodes, registerEngineSubgraphs} from "../node"
import {JavaScript} from "../util"

/** Constructor interface for configurable TypeScript objects. */
export interface TypeScriptConfigurableConstructor {
  new (
    gameEngine :TypeScriptGameEngine,
    supertype :string,
    type :string,
    ...otherArgs :any[]
  ): TypeScriptConfigurable
}

class ConfigurableSupertype {
  readonly constructors = new Map<string, TypeScriptConfigurableConstructor>()
  readonly typeRoot = new CategoryNode("")
}

const configurableSupertypes = new Map<string, ConfigurableSupertype>()

/** Registers a configurable type's constructor with the TypeScript engine.
  * @param supertype the configurable supertype (e.g., "component")
  * @param categories the category path under which to list the type, if any.
  * @param type the configurable type name.
  * @param constructor the configurable constructor. */
export function registerConfigurableType (
  supertype :string,
  categories: string[]|undefined,
  type :string,
  constructor :TypeScriptConfigurableConstructor,
) {
  let configurableSupertype = configurableSupertypes.get(supertype)
  if (!configurableSupertype) {
    configurableSupertypes.set(supertype, configurableSupertype = new ConfigurableSupertype())
  }
  configurableSupertype.constructors.set(type, constructor)
  if (categories) configurableSupertype.typeRoot.getCategoryNode(categories).addLeafNode(type)
}

interface ProxyType<T> {
  create (populate :(out :T, arg? :any) => T) :(arg? :any) => T
  copy (out :T, source :T) :T
}

const ProxyTypes :PMap<ProxyType<any>> = {
  vec2: {create: createVec2Fn, copy: vec2.copy},
  vec3: {create: createVec3Fn, copy: vec3.copy},
  quat: {create: createQuatFn, copy: quat.copy},
  Color: {create: createColorFn, copy: Color.copy},
}

export class TypeScriptConfigurable implements Configurable {
  protected readonly _disposer = new Disposer()
  protected readonly _constructorArgs :any[]

  get isConfigurable () :true { return true }

  get propertiesMeta () :RMap<string, PropertyMeta> {
    return getConfigurableMeta(Object.getPrototypeOf(this)).properties
  }

  constructor (
    readonly gameEngine :TypeScriptGameEngine,
    readonly supertype :string,
    readonly type :string,
    ...otherArgs :any[]
  ) {
    this._constructorArgs = otherArgs
  }

  init () :void {
    // create any properties not created in constructor
    for (const [property, meta] of this.propertiesMeta) {
      this._maybeCreatePropertyValue(property, meta)
    }
  }

  getProperty<T> (name :string, overrideDefault? :any) :Value<T>|Mutable<T> {
    const valueName = getPropertyValueName(name)
    let property = this[valueName]
    if (!property) {
      log.warn("Missing property decorator for field", "name", name)
      this[valueName] = property = this._createPropertyValue(name, {type: "any", constraints: {}})
    }
    return property as Value<T>|Mutable<T>
  }

  createConfig (omitType? :boolean) :ConfigurableConfig {
    const config :ConfigurableConfig = {}
    if (!omitType) config.type = this.type
    for (const [key, meta] of this.propertiesMeta) {
      if (!(meta.constraints.readonly || meta.constraints.transient)) {
        config[key] = JavaScript.clone(this[key])
      }
    }
    return config
  }

  reconfigure (type :string|undefined, config :ConfigurableConfig|null) :Configurable|null {
    if (config === null) {
      this.dispose()
      return null
    }
    if (type === undefined) type = config.type
    if (type && type !== this.type) {
      this.dispose()
      return this.gameEngine.reconfigureConfigurable(
        this.supertype,
        null,
        type,
        config,
        ...this._constructorArgs,
      )
    }
    for (const key in config) {
      if (key !== "type") this[key] = config[key]
    }
    return this
  }

  dispose () {
    this._disposer.dispose()
  }

  protected _maybeCreatePropertyValue (property :string, meta :PropertyMeta) {
    const valueName = getPropertyValueName(property)
    if (!this[valueName]) this[valueName] = this._createPropertyValue(property, meta)
  }

  protected _createPropertyValue (name :string, meta :PropertyMeta) :Value<any> {
    // TODO: provide a way for read-only properties to advertise change, perhaps through a
    // custom message
    if (meta.constraints.readonly) {
      return Value.deriveValue(refEquals, () => NoopRemover, () => this[name])
    }
    let listener :ChangeFn<any>|undefined
    const propertyValue = Mutable.deriveMutable(
      dispatch => {
        listener = dispatch
        return () => listener = undefined
      },
      () => this[name],
      value => this[name] = value,
      refEquals,
    )
    const proxyType = ProxyTypes[meta.type]
    if (proxyType) {
      const current = proxyType.create(out => proxyType.copy(out, rawObject))
      const rawObject = this[name]
      const proxy = new Proxy(rawObject, {
        set: (obj, prop, value) => {
          if (listener) {
            const oldValue = current()
            obj[prop] = value
            listener(current(), oldValue)
          } else {
            obj[prop] = value
          }
          return true
        },
        get: (obj, prop) => {
          return obj[prop]
        },
      })
      Object.defineProperty(this, name, {
        get: () => proxy,
        set: value => {
          if (listener) {
            const oldValue = current()
            proxyType.copy(rawObject, value)
            listener(current(), oldValue)
          } else {
            proxyType.copy(rawObject, value)
          }
        },
      })
      return propertyValue
    }
    const descriptor = this._getPropertyDescriptor(name)
    const descriptorGet = descriptor.get
    const getter = descriptorGet
      ? () => descriptorGet.call(this)
      : () => descriptor.value
    const descriptorSet = descriptor.set
    const setter = descriptorSet
      ? (value :any) => descriptorSet.call(this, value)
      : (value :any) => descriptor.value = value
    Object.defineProperty(this, name, {
      get: getter,
      set: value => {
        const oldValue = getter()
        setter(value)
        if (listener && value !== oldValue) listener(value, oldValue)
      },
    })
    return propertyValue
  }

  protected _getPropertyDescriptor (name :string) :PropertyDescriptor {
    for (let object = this; object; object = Object.getPrototypeOf(object)) {
      const descriptor = Object.getOwnPropertyDescriptor(object, name)
      if (descriptor) return descriptor
    }
    return {value: undefined}
  }
}

function getPropertyValueName (property :string) :string {
  return property + "Value"
}

interface Wakeable { awake () :void }

/** An implementation of the GameEngine interface in TypeScript. */
export class TypeScriptGameEngine implements GameEngine {
  private readonly _disposer = new Disposer()
  private readonly _pages = Mutable.local([DEFAULT_PAGE])

  readonly ctx :GameContext
  readonly rootIds :Value<string[]>
  readonly activePage = Mutable.local<string>(DEFAULT_PAGE)
  readonly dirtyTransforms = new Set<TypeScriptTransform>()
  readonly updatables = new Set<Updatable>()
  readonly tagged = new Map<string, Set<GameObject>>()

  _renderEngine? :RenderEngine
  _physicsEngine? :PhysicsEngine

  readonly _gameObjects = MutableMap.local<string, GameObject>()

  readonly _defaultRootIds = Mutable.local<string[]>([])
  readonly _defaultRootsActive = Mutable.local(true)

  get renderEngine () :RenderEngine {
    if (!this._renderEngine) throw new Error("Missing render engine")
    return this._renderEngine
  }

  get physicsEngine () :PhysicsEngine {
    if (!this._physicsEngine) throw new Error("Missing physics engine")
    return this._physicsEngine
  }

  get pages () :Value<string[]> { return this._pages }

  get gameObjects () :RMap<string, GameObject> { return this._gameObjects }

  constructor (readonly root :HTMLElement,
               readonly interact :InteractionManager,
               screen :Value<rect>,
               readonly loader :ResourceLoader) {
    this.ctx = {
      types: new NodeTypeRegistry(
        registerLogicNodes,
        registerMathNodes,
        registerMatrixNodes,
        registerSignalNodes,
        registerUtilNodes,
        registerInputNodes,
        registerUINodes,
        registerEngineNodes,
      ),
      loader,
      subgraphs: new SubgraphRegistry(registerEngineSubgraphs),
      host: this._disposer.add(new HTMLHost(root, interact, false)),
      theme: DefaultTheme,
      styles: DefaultStyles,
      screen,
    }
    this.rootIds = this.activePage.switchMap(
      page => page === DEFAULT_PAGE
        ? this._defaultRootIds
        : this.gameObjects.require(page).transform.childIds,
    )
    this.activePage.onChange((newPage, oldPage) => {
      if (oldPage === DEFAULT_PAGE) this._defaultRootsActive.update(false)
      else {
        const page = this.gameObjects.get(oldPage)
        if (page) page.activeSelf = false
      }
      if (newPage === DEFAULT_PAGE) this._defaultRootsActive.update(true)
      else this.gameObjects.require(newPage).activeSelf = true
    })
    this._defaultRootsActive.onChange(active => {
      for (const rootId of this._defaultRootIds.current) {
        // make sure the object exists; it may be deleted in an enable/disable handler
        const gameObject = this.gameObjects.get(rootId)
        if (gameObject) gameObject._updateActiveInHierarchy()
      }
    })
  }

  createConfigurableConfig (
    configurable :Configurable|null,
    omitType? :boolean,
  ) :ConfigurableConfig|null {
    return configurable && configurable.createConfig(omitType)
  }

  reconfigureConfigurable (
    supertype :string,
    configurable :Configurable|null,
    type :string|undefined,
    config :ConfigurableConfig|null,
    ...constructorArgs :any[]
  ) :Configurable|null {
    if (configurable !== null) return configurable.reconfigure(type, config)
    if (config === null) return null
    const configurableSupertype = this._requireConfigurableSupertype(supertype)
    if (type === undefined) type = config.type
    if (type === undefined) throw new Error(`No type given to create "${supertype}"`)
    const constructor = configurableSupertype.constructors.get(type)
    if (!constructor) throw new Error(`Unknown configurable type "${type}"`)
    const newConfigurable = new constructor(this, supertype, type, ...constructorArgs)
    newConfigurable.init()
    return newConfigurable.reconfigure(undefined, config)
  }

  getConfigurableTypeRoot (supertype :string) :CategoryNode {
    return this._requireConfigurableSupertype(supertype).typeRoot
  }

  private _requireConfigurableSupertype (supertype :string) :ConfigurableSupertype {
    const configurableSupertype = configurableSupertypes.get(supertype)
    if (!configurableSupertype) throw new Error(`Unknown configurable supertype "${supertype}"`)
    return configurableSupertype
  }

  createPage (name? :string) :GameObject {
    return this.createGameObject(name || "page", {page: {}}, true)
  }

  createPrimitive (type :PrimitiveType, config? :GameObjectConfig) :GameObject {
    const mergedConfig = {
      meshFilter: {meshConfig: {type}},
      meshRenderer: {},
    }
    if (config) applyConfig(mergedConfig, config)
    return this.createGameObject(type, mergedConfig)
  }

  setSpace (config :SpaceConfig, layerMask? :number, mergedObjectConfig? :GameObjectConfig|null) {
    this.disposeGameObjects(layerMask)
    if (mergedObjectConfig === null) {
      this.createGameObjects(config, true)
      return
    }
    this.renderEngine.startMerging(mergedObjectConfig)
    try {
      this.createGameObjects(config, true)
    } finally {
      this.renderEngine.stopMerging()
    }
  }

  createGameObjects (configs :SpaceConfig, onDefaultPage = false) :PMap<GameObject> {
    // create the objects and map them by original name
    const gameObjects :PMap<GameObject> = {}
    for (const name in configs) {
      gameObjects[name] = new TypeScriptGameObject(this, name)
    }

    // configure the objects with updated references
    const replaceIds = (config :object) => {
      const newConfig = {}
      for (const key in config) {
        const value = config[key]
        if (typeof value === "string" && key.endsWith("Id")) {
          const gameObject = gameObjects[value]
          if (gameObject) newConfig[key] = gameObject.id
          else newConfig[key] = value

        } else if (
          typeof value === "object" &&
          value !== null &&
          Object.getPrototypeOf(value) === Object.prototype
        ) {
          newConfig[key] = replaceIds(value)

        } else {
          newConfig[key] = value
        }
      }
      return newConfig
    }
    for (const name in configs) {
      gameObjects[name].configure(replaceIds(configs[name]))
    }

    // put the objects on the proper page, if necessary
    if (!onDefaultPage) {
      const activePage = this.activePage.current
      if (activePage !== DEFAULT_PAGE) {
        const parent = this.gameObjects.require(activePage).transform
        for (const name in configs) {
          const config = configs[name]
          if (!(config.transform && config.transform.parentId)) {
            gameObjects[name].transform.parent = parent
          }
        }
      }
    }

    // wake the objects up
    for (const name in gameObjects) gameObjects[name].sendMessage("awake")

    return gameObjects
  }

  createGameObject (
    name? :string,
    config? :GameObjectConfig,
    onDefaultPage = false,
    wake = true,
  ) :GameObject {
    const gameObject = new TypeScriptGameObject(this, getValue(name, "object"))
    if (config) gameObject.configure(config)
    if (!(onDefaultPage || config && config.transform && config.transform.parentId)) {
      const activePage = this.activePage.current
      if (activePage !== DEFAULT_PAGE) {
        gameObject.transform.parent = this.gameObjects.require(activePage).transform
      }
    }
    if (wake) gameObject.sendMessage("awake")
    return gameObject
  }

  disposeGameObjects (layerMask :number = ALL_LAYERS_MASK) :void {
    for (const gameObject of this.gameObjects.values()) {
      if (gameObject.layerFlags & layerMask) gameObject.dispose()
    }
  }

  createConfig (layerMask = ALL_LAYERS_MASK, hideMask = ALL_HIDE_FLAGS_MASK) :SpaceConfig {
    const config :SpaceConfig = {}
    for (const [id, gameObject] of this.gameObjects) {
      if (gameObject.layerFlags & layerMask && !(gameObject.hideFlags & hideMask)) {
        config[id] = gameObject.createConfig(hideMask)
      }
    }
    return config
  }

  findGameObjectsWithTag (tag :string, target :GameObject[] = []) :GameObject[] {
    const tagged = this.tagged.get(tag)
    if (tagged) {
      for (const object of tagged) {
        if (object.activeInHierarchy) target.push(object)
      }
    }
    return target
  }

  findWithTag (tag :string) :GameObject|undefined {
    const tagged = this.tagged.get(tag)
    if (tagged) {
      for (const object of tagged) {
        if (object.activeInHierarchy) return object
      }
    }
    return undefined
  }

  addUpdatable (updatable :Updatable) :void {
    this.updatables.add(updatable)
  }

  removeUpdatable (updatable :Updatable) :void {
    this.updatables.delete(updatable)
  }

  update (clock :Clock) :void {
    Time.deltaTime = clock.dt
    this._validateDirtyTransforms() // need this for camera transform used in hover computation
    this.renderEngine.updateHovers()
    for (const updatable of this.updatables) updatable.update(clock)
    this.ctx.host.update(clock)
    if (this._physicsEngine) {
      // validate transforms both before the physics update (to apply any changes made outside the
      // physics system) and after (to apply the transforms read from the physics system)
      this._validateDirtyTransforms()
      this._physicsEngine.update(clock)
    }
    this._validateDirtyTransforms()
    this.renderEngine.render()
  }

  _getNextOrder (parentId :string|undefined, page :boolean) :number {
    const ids = (parentId === undefined)
      ? (page ? this._pages.current : this._defaultRootIds.current)
      : this.gameObjects.require(parentId).transform.childIds.current
    if (ids.length === 0) return 0
    const lastId = ids[ids.length - 1]
    return lastId === DEFAULT_PAGE ? 0 : this.gameObjects.require(lastId).order + 1
  }

  _rootRemoved (root :TypeScriptTransform) {
    const idx = removeId(this._getRootIds(root), root.gameObject.id)
    if (this.activePage.current === root.gameObject.id) {
      const pages = this._pages.current
      this.activePage.update(pages[idx < pages.length ? idx : idx - 1])
    }
  }

  _rootReordered (root :TypeScriptTransform) {
    reorderChildId(this._getRootIds(root), root, this.gameObjects)
  }

  private _getRootIds (root :TypeScriptTransform) :Mutable<string[]> {
    return root.gameObject.page ? this._pages : this._defaultRootIds
  }

  _validateDirtyTransforms () {
    for (const transform of this.dirtyTransforms) {
      transform._validate(LOCAL_TO_WORLD_MATRIX_INVALID)
      transform.sendMessage("onTransformChanged")
    }
    this.dirtyTransforms.clear()
  }

  dispose () {
    this._disposer.dispose()
    // TODO: dispose of all extant game objects?
  }
}

function removeId (ids :Mutable<string[]>, id :string) :number {
  const idx = ids.current.indexOf(id)
  if (idx === -1) throw new Error(`Child "${id}" missing from list`)
  const newIds = ids.current.slice()
  newIds.splice(idx, 1)
  ids.update(newIds)
  return idx
}

function reorderChildId (
  ids :Mutable<string[]>,
  child :TypeScriptTransform,
  gameObjects :RMap<string, GameObject>,
) :number {
  return reorderId(
    ids,
    child.gameObject.id,
    id => id === DEFAULT_PAGE ? 0 : gameObjects.require(id).order,
  )
}

function reorderId (ids :Mutable<string[]>, id :string, getOrder: (id :string) => number) :number {
  const idx = ids.current.indexOf(id)
  const newIds = ids.current.slice()
  if (idx !== -1) newIds.splice(idx, 1)
  const order = getOrder(id)
  let ii = 0
  for (; ii < newIds.length; ii++) {
    if (order < getOrder(newIds[ii])) {
      newIds.splice(ii, 0, id)
      break
    }
  }
  if (ii === newIds.length) newIds.push(id)
  ids.update(newIds)
  return idx
}

type MessageHandler = (...args :any[]) => void

const GameObjectPropertiesMeta = MutableMap.local<string, PropertyMeta>()
GameObjectPropertiesMeta.set("isStatic", {type: "boolean", constraints: {}})

let messageCounter = 0

export class TypeScriptGameObject implements GameObject {
  readonly id :string
  readonly tagValue = Mutable.local("")
  readonly layerFlagsValue = Mutable.local(DEFAULT_LAYER_FLAG)
  readonly hideFlagsValue = Mutable.local(0)
  readonly nameValue :Mutable<string>
  readonly orderValue = Mutable.local(0)
  readonly activeSelfValue = Mutable.local(false)
  readonly activeInHierarchyValue = Mutable.local(false)
  readonly isStaticValue = Mutable.local(false)
  readonly transform :Transform
  readonly page? :Page

  private readonly _componentTypes = Mutable.local<string[]>([])
  private readonly _components = MutableMap.local<string, Component>()
  private readonly _messageHandlers = new Map<string, MessageHandler[]>()

  get tag () :string { return this.tagValue.current }
  set tag (tag :string) { this.tagValue.update(tag) }

  get layerFlags () :number { return this.layerFlagsValue.current }
  set layerFlags (flags :number) { this.layerFlagsValue.update(flags) }

  get hideFlags () :number { return this.hideFlagsValue.current }
  set hideFlags (flags :number) { this.hideFlagsValue.update(flags) }

  get name () :string { return this.nameValue.current }
  set name (name :string) { this.nameValue.update(name) }

  get order () :number { return this.orderValue.current }
  set order (order :number) { this.orderValue.update(order) }

  get activeSelf () :boolean { return this.activeSelfValue.current }
  set activeSelf (active :boolean) { this.activeSelfValue.update(active) }

  get activeInHierarchy () :boolean { return this.activeInHierarchyValue.current }
  set activeInHierarchy (active :boolean) {
    if (!active) {
      this.activeSelf = false
      return
    }
    this.activeSelf = true
    if (this.transform.parent) this.transform.parent.gameObject.activeInHierarchy = true
    else this.gameEngine.activePage.update(this.page ? this.id : DEFAULT_PAGE)
  }

  get isStatic () :boolean { return this.isStaticValue.current }
  set isStatic (isStatic :boolean) { this.isStaticValue.update(isStatic) }

  get propertiesMeta () :RMap<string, PropertyMeta> { return GameObjectPropertiesMeta }

  get componentTypes () :Value<string[]> { return this._componentTypes }
  get components () :RMap<string, Component> { return this._components }

  constructor (public gameEngine :TypeScriptGameEngine, name :string) {
    this.id = name
    for (
      let ii = 2;
      gameEngine._gameObjects.has(this.id) || this.id === DEFAULT_PAGE;
      ii++
    ) this.id = name + ii
    gameEngine._gameObjects.set(this.id, this)
    this.nameValue = Mutable.local(name)
    this.transform = this.addComponent("transform", {}, false)
    this.tagValue.onChange((newTag, oldTag) => {
      if (oldTag) {
        const tagged = this.gameEngine.tagged.get(oldTag)
        if (tagged) {
          tagged.delete(this)
          if (tagged.size === 0) this.gameEngine.tagged.delete(oldTag)
        }
      }
      if (newTag) {
        let tagged = this.gameEngine.tagged.get(newTag)
        if (!tagged) this.gameEngine.tagged.set(newTag, tagged = new Set())
        tagged.add(this)
      }
    })
  }

  configure (config :GameObjectConfig) {
    if (config.order === undefined) {
      this.orderValue.update(
        this.gameEngine._getNextOrder(config.transform && config.transform.parentId, !!config.page),
      )
    }
    for (const key in config) {
      const value = config[key]
      if (key === "transform") {
        this.transform.reconfigure(undefined, value)
        continue
      }
      if (typeof value === "object") this.addComponent(key, value, false)
      else this[key] = value
    }
    this.activeInHierarchyValue.onChange(active => {
      this.sendMessage(active ? "onEnable" : "onDisable")
      for (let ii = 0; ii < this.transform.childCount; ii++) {
        this.transform.getChild(ii).gameObject._updateActiveInHierarchy()
      }
    })
    this.activeSelfValue.onValue(() => this._updateActiveInHierarchy())
    if (config.activeSelf === undefined && !this.page) this.activeSelf = true
  }

  addComponents (config :PMap<ConfigurableConfig>, wake = true) {
    for (const type in config) this.addComponent(type, config[type], wake)
  }

  addComponent<T extends Component> (
    type :string,
    config :ConfigurableConfig = {},
    wake = true,
  ) :T {
    let component = this[type] as T|undefined
    if (component) {
      component.reconfigure(undefined, config)
    } else {
      component = this.gameEngine.reconfigureConfigurable(
        "component",
        null,
        type,
        config,
        this,
      ) as T
      if (wake) {
        const wakeable = component as unknown as Wakeable
        if (wakeable.awake) wakeable.awake()
      }
    }
    return component
  }

  requireComponent<T extends Component> (type :string|ComponentConstructor<T>) :T {
    const component = this.getComponent(type)
    if (!component) throw new Error(`Missing required component of type "${type}"`)
    return component
  }

  getComponent<T extends Component> (type :string|ComponentConstructor<T>) :T|undefined {
    if (typeof type === "string") {
      const value = this[type]
      return value instanceof TypeScriptComponent ? value as unknown as T : undefined
    }
    for (const key in this) {
      if (this[key] instanceof type) return this[key] as unknown as T
    }
    return undefined
  }

  getComponentInParent<T extends Component> (type :string|ComponentConstructor<T>) :T|undefined {
    const component = this.getComponent(type)
    if (component) return component
    return this.transform.parent && this.transform.parent.getComponentInParent(type)
  }

  hasMessageHandler (message :string) :boolean {
    if (this._messageHandlers.has(message)) return true
    for (const key in this) {
      if (this[key][message]) return true
    }
    return false
  }

  addMessageHandler (message :string, handler :MessageHandler) {
    let handlers = this._messageHandlers.get(message)
    if (!handlers) this._messageHandlers.set(message, handlers = [])
    handlers.push(handler)
  }

  removeMessageHandler (message :string, handler :MessageHandler) {
    const handlers = this._messageHandlers.get(message)
    if (!handlers) return
    const idx = handlers.indexOf(handler)
    if (idx === -1) return
    handlers.splice(idx, 1)
    if (handlers.length === 0) this._messageHandlers.delete(message)
  }

  sendMessage (message :string, ...args :any[]) :void {
    messageCounter++
    for (const value of this.components.values()) {
      const component = value as TypeScriptComponent
      if (component[message] && component.lastMessage !== messageCounter) {
        component.lastMessage = messageCounter
        component[message](...args)
      }
    }
    const handlers = this._messageHandlers.get(message)
    if (handlers) {
      for (const handler of handlers) handler(...args)
    }
  }

  broadcastMessage (message :string, ...args: any[]) :void {
    this.sendMessage(message, ...args)
    for (let ii = 0; ii < this.transform.childCount; ii++) {
      this.transform.getChild(ii).broadcastMessage(message, ...args)
    }
  }

  getProperty<T> (name :string, overrideDefault? :any) :Value<T>|Mutable<T> {
    switch (name) {
      case "id": return Value.constant(this.id) as unknown as Value<T>
      case "tag": return this.tagValue as unknown as Value<T>
      case "layerFlags": return this.layerFlagsValue as unknown as Value<T>
      case "hideFlags": return this.hideFlagsValue as unknown as Value<T>
      case "name": return this.nameValue as unknown as Value<T>
      case "order": return this.orderValue as unknown as Value<T>
      case "activeSelf": return this.activeSelfValue as unknown as Value<T>
      case "isStatic": return this.isStaticValue as unknown as Value<T>
      default: return this.components.getValue(name) as unknown as Value<T>
    }
  }

  createConfig (hideMask = ALL_HIDE_FLAGS_MASK) :GameObjectConfig {
    const config :GameObjectConfig = {}
    if (this.tag !== "") config.tag = this.tag
    if (this.layerFlags !== DEFAULT_LAYER_FLAG) config.layerFlags = this.layerFlags
    if (this.hideFlags !== 0) config.hideFlags = this.hideFlags
    if (this.name !== this.id) config.name = this.name
    if (this.order !== 0) config.order = this.order
    if (this.isStatic) config.isStatic = true
    for (const type of this._componentTypes.current) {
      const component = this._components.require(type)
      if (!(component.hideFlags & hideMask)) config[type] = component.createConfig()
    }
    return config
  }

  disposeHierarchy () :void {
    for (let ii = this.transform.childCount - 1; ii >= 0; ii--) {
      this.transform.getChild(ii).gameObject.disposeHierarchy()
    }
    this.dispose()
  }

  dispose () {
    this.activeSelf = false
    this.tag = ""
    this.gameEngine._gameObjects.delete(this.id)
    for (const key in this) {
      const value = this[key]
      if (value instanceof TypeScriptComponent) value.dispose()
    }
  }

  _updateActiveInHierarchy () {
    this.activeInHierarchyValue.update(
      this.activeSelf &&
      (
        this.transform.parent
          ? this.transform.parent.gameObject.activeInHierarchy
          : this.page
          ? this.gameEngine.activePage.current === this.id
          : this.gameEngine._defaultRootsActive.current
      ),
    )
  }

  _componentReordered (component :Component) {
    for (const alias of component.aliases.concat([component.type])) {
      this._components.set(alias, component)
      if (alias !== "transform") {
        // transform is set in constructor
        Object.defineProperty(this, alias, {configurable: true, enumerable: true, value: component})
      }
    }
    reorderId(this._componentTypes, component.type, type => this._components.require(type).order)
  }

  _componentRemoved (component :Component) {
    removeId(this._componentTypes, component.type)
    for (const alias of component.aliases.concat([component.type])) {
      this._components.delete(alias)
      delete this[alias]
    }
  }
}

export function applyConfig (target :PMap<any>, config :PMap<any>) {
  for (const key in config) {
    const value = config[key]
    const targetValue = target[key]
    if (
      typeof value === "object" &&
      value !== null &&
      typeof targetValue === "object" &&
      targetValue !== null
    ) applyConfig(targetValue, value)
    else target[key] = value
  }
}

export class TypeScriptComponent extends TypeScriptConfigurable implements Component {
  @property("number", {editable: false}) hideFlags = 0
  @property("number", {editable: false}) order = 0

  lastMessage? :number

  readonly aliases :string[]

  protected readonly _disposer = new Disposer()
  private readonly _coroutines :TypeScriptCoroutine[] = []

  get removable () :boolean { return true }

  get transform () :Transform { return this.gameObject.transform }

  constructor (
    gameEngine :TypeScriptGameEngine,
    supertype :string,
    type :string,
    readonly gameObject :TypeScriptGameObject,
    ...aliases :string[]
  ) {
    super(gameEngine, supertype, type, gameObject, ...aliases)
    this.aliases = aliases
    this._disposer.add(gameObject.activeInHierarchyValue.onValue(active => {
      const updatable = this as any
      if (active) {
        if (updatable.update) gameEngine.addUpdatable(updatable)
        for (const coroutine of this._coroutines) gameEngine.addUpdatable(coroutine)
      } else {
        if (updatable.update) gameEngine.removeUpdatable(updatable)
        for (const coroutine of this._coroutines) gameEngine.removeUpdatable(coroutine)
      }
    }))
  }

  init () {
    super.init()
    const componentTypes = this.gameObject.componentTypes.current
    if (componentTypes.length > 0) {
      this.order =
        this.gameObject.requireComponent(componentTypes[componentTypes.length - 1]).order + 1
    }
    this.getProperty("order").onValue(() => this.gameObject._componentReordered(this))
  }

  requireComponent<T extends Component> (type :string|ComponentConstructor<T>) :T {
    return this.gameObject.requireComponent(type)
  }

  getComponent<T extends Component> (type :string|ComponentConstructor<T>) :T|undefined {
    return this.gameObject.getComponent(type)
  }

  getComponentInParent<T extends Component> (type :string|ComponentConstructor<T>) :T|undefined {
    return this.gameObject.getComponentInParent(type)
  }

  sendMessage (message :string, ...args :any[]) :void {
    this.gameObject.sendMessage(message, ...args)
  }

  broadcastMessage (message :string, ...args: any[]) :void {
    this.gameObject.broadcastMessage(message, ...args)
  }

  startCoroutine (fnOrGenerator :(() => Generator<void>)|Generator<void>) :Coroutine {
    return new TypeScriptCoroutine(
      this,
      typeof fnOrGenerator === "function" ? fnOrGenerator() : fnOrGenerator,
    )
  }

  stopAllCoroutines () {
    for (const coroutine of this._coroutines) {
      coroutine.dispose()
    }
  }

  createConfig () :ConfigurableConfig {
    return super.createConfig(true)
  }

  dispose () {
    this._disposer.dispose()
    this.gameObject._componentRemoved(this)
    for (const coroutine of this._coroutines) coroutine.dispose()
    const updatable = this as any
    if (updatable.update) this.gameObject.gameEngine.removeUpdatable(updatable)
  }

  _addCoroutine (coroutine :TypeScriptCoroutine) {
    this._coroutines.push(coroutine)
    if (this.gameObject.activeInHierarchy) this.gameObject.gameEngine.addUpdatable(coroutine)
  }

  _removeCoroutine (coroutine :TypeScriptCoroutine) {
    this._coroutines.splice(this._coroutines.indexOf(coroutine), 1)
    if (this.gameObject.activeInHierarchy) this.gameObject.gameEngine.removeUpdatable(coroutine)
  }
}

export class TypeScriptCoroutine implements Coroutine {

  constructor (
    private readonly _component :TypeScriptComponent,
    private readonly _fn :Generator<void>,
  ) {
    this._component._addCoroutine(this)
  }

  update () {
    if (this._fn.next().done) this.dispose()
  }

  dispose () {
    this._component._removeCoroutine(this)
  }
}

const tmpq = quat.create()
const tmpv = vec3.create()
const tmpv4 = vec4.create()

const LOCAL_POSITION_INVALID = (1 << 0)
const LOCAL_ROTATION_INVALID = (1 << 1)
const LOCAL_SCALE_INVALID = (1 << 2)
const POSITION_INVALID = (1 << 3)
const ROTATION_INVALID = (1 << 4)
const LOSSY_SCALE_INVALID = (1 << 5)
const LOCAL_TO_WORLD_MATRIX_INVALID = (1 << 6)
const WORLD_TO_LOCAL_MATRIX_INVALID = (1 << 7)
const RIGHT_INVALID = (1 << 8)
const UP_INVALID = (1 << 9)
const FORWARD_INVALID = (1 << 10)

const LOCAL_INVALID =
  LOCAL_POSITION_INVALID | LOCAL_ROTATION_INVALID |
  LOCAL_TO_WORLD_MATRIX_INVALID | WORLD_TO_LOCAL_MATRIX_INVALID |
  RIGHT_INVALID | UP_INVALID | FORWARD_INVALID

const WORLD_INVALID =
  POSITION_INVALID | ROTATION_INVALID | LOSSY_SCALE_INVALID |
  LOCAL_TO_WORLD_MATRIX_INVALID | WORLD_TO_LOCAL_MATRIX_INVALID |
  RIGHT_INVALID | UP_INVALID | FORWARD_INVALID

class TypeScriptTransform extends TypeScriptComponent implements Transform {
  @property("vec3", {readonly: true, transient: true, editable: false}) readonly lossyScale :vec3
  readonly localToWorldMatrix :mat4
  readonly worldToLocalMatrix :mat4
  readonly right :vec3
  readonly up :vec3
  readonly forward :vec3

  private _parent? :TypeScriptTransform
  private _addedToRoot = false
  private readonly _children :TypeScriptTransform[] = []
  private readonly _childIds = Mutable.local<string[]>([])
  private readonly _localPosition :vec3
  private readonly _localRotation :quat
  private readonly _localScale :vec3
  private readonly _position :vec3
  private readonly _rotation :quat
  private readonly _localPositionTarget :vec3
  private readonly _localRotationTarget :quat
  private readonly _positionTarget :vec3
  private readonly _rotationTarget :quat
  private readonly _lossyScaleTarget :vec3
  private readonly _localToWorldMatrixTarget :mat4
  private readonly _worldToLocalMatrixTarget :mat4
  private readonly _rightTarget :vec3
  private readonly _upTarget :vec3
  private readonly _forwardTarget :vec3
  private _invalidFlags = 0

  constructor (
    gameEngine :TypeScriptGameEngine,
    supertype :string,
    type :string,
    gameObject :TypeScriptGameObject,
  ) {
    super(gameEngine, supertype, type, gameObject)

    const makeReadWriteProxy = (
      target :any,
      invalidateFlags :number,
      validateFlags :number,
    ) => new Proxy(target, {
      set: (obj, prop, value) => {
        if (obj[prop] !== value) {
          obj[prop] = value
          this._invalidate(invalidateFlags)
        }
        return true
      },
      get: (obj, prop) => {
        this._validate(validateFlags)
        return obj[prop]
      },
    })
    this._localPosition = makeReadWriteProxy(
      this._localPositionTarget = vec3.create(),
      POSITION_INVALID | LOCAL_TO_WORLD_MATRIX_INVALID | WORLD_TO_LOCAL_MATRIX_INVALID,
      LOCAL_POSITION_INVALID,
    )
    this._localRotation = makeReadWriteProxy(
      this._localRotationTarget = quat.create(),
      ROTATION_INVALID | LOCAL_TO_WORLD_MATRIX_INVALID | WORLD_TO_LOCAL_MATRIX_INVALID |
        RIGHT_INVALID | UP_INVALID | FORWARD_INVALID,
      LOCAL_ROTATION_INVALID,
    )
    this._localScale = makeReadWriteProxy(
      vec3.fromValues(1, 1, 1),
      LOSSY_SCALE_INVALID | LOCAL_TO_WORLD_MATRIX_INVALID | WORLD_TO_LOCAL_MATRIX_INVALID,
      LOCAL_SCALE_INVALID,
    )

    this._position = makeReadWriteProxy(
      this._positionTarget = vec3.create(),
      LOCAL_POSITION_INVALID | LOCAL_TO_WORLD_MATRIX_INVALID | WORLD_TO_LOCAL_MATRIX_INVALID,
      POSITION_INVALID,
    )
    this._rotation = makeReadWriteProxy(
      this._rotationTarget = quat.create(),
      LOCAL_ROTATION_INVALID | LOCAL_TO_WORLD_MATRIX_INVALID | WORLD_TO_LOCAL_MATRIX_INVALID |
        RIGHT_INVALID | UP_INVALID | FORWARD_INVALID,
      ROTATION_INVALID,
    )

    const makeReadOnlyProxy = (target :any, validateFlags :number) => new Proxy(target, {
      set: (obj, prop, value) => {
        throw new Error("Object is read-only")
      },
      get: (obj, prop) => {
        this._validate(validateFlags)
        return obj[prop]
      },
    })
    this.lossyScale = makeReadOnlyProxy(
      this._lossyScaleTarget = vec3.fromValues(1, 1, 1),
      LOSSY_SCALE_INVALID,
    )
    this.localToWorldMatrix = makeReadOnlyProxy(
      this._localToWorldMatrixTarget = mat4.create(),
      LOCAL_TO_WORLD_MATRIX_INVALID,
    )
    this.worldToLocalMatrix = makeReadOnlyProxy(
      this._worldToLocalMatrixTarget = mat4.create(),
      WORLD_TO_LOCAL_MATRIX_INVALID,
    )
    this.right = makeReadOnlyProxy(this._rightTarget = vec3.fromValues(1, 0, 0), RIGHT_INVALID)
    this.up = makeReadOnlyProxy(this._upTarget = vec3.fromValues(0, 1, 0), UP_INVALID)
    this.forward = makeReadOnlyProxy(
      this._forwardTarget = vec3.fromValues(0, 0, 1),
      FORWARD_INVALID,
    )
  }

  get removable () :boolean { return false }

  get parent () :Transform|undefined { return this._parent }
  set parent (newParent :Transform|undefined) { this.setParent(newParent) }

  @property("string|undefined", {editable: false}) get parentId () :string|undefined {
    return this._parent && this._parent.gameObject.id
  }
  set parentId (id :string|undefined) {
    this.parent = (id === undefined)
      ? undefined
      : this.gameObject.gameEngine.gameObjects.require(id).transform
  }

  setParent (parent :Transform|undefined, worldPositionStays = true) :void {
    if (this._parent === parent) return
    let preValidate = POSITION_INVALID | ROTATION_INVALID
    let invalidate = LOCAL_INVALID
    let postValidate = LOCAL_POSITION_INVALID | LOCAL_ROTATION_INVALID
    if (!worldPositionStays) {
      preValidate = LOCAL_POSITION_INVALID | LOCAL_ROTATION_INVALID
      invalidate = WORLD_INVALID
      postValidate = POSITION_INVALID | ROTATION_INVALID
    }
    this._validate(preValidate)
    this._maybeRemoveFromParent()
    this._parent = parent as TypeScriptTransform|undefined
    if (this._parent) this._parent._childReordered(this)
    else {
      this.gameObject.gameEngine._rootReordered(this)
      this._addedToRoot = true
    }
    this._invalidate(invalidate)
    this.broadcastMessage("onTransformParentChanged")
    this.gameObject._updateActiveInHierarchy()
    this._validate(postValidate)
  }

  get childIds () :Value<string[]> { return this._childIds }

  get childCount () :number { return this._children.length }

  getChild (index :number) :Transform {
    return this._children[index]
  }

  @property("vec3") get localPosition () :vec3 { return this._localPosition }
  set localPosition (pos :vec3) { vec3.copy(this._localPosition, pos) }

  @property("quat") get localRotation () :quat { return this._localRotation }
  set localRotation (rot :quat) { quat.copy(this._localRotation, rot) }

  @property("vec3") get localScale () :vec3 { return this._localScale }
  set localScale (scale :vec3) { vec3.copy(this._localScale, scale) }

  @property("vec3", {transient: true, editable: false}) get position () :vec3 {
    return this._position
  }
  set position (pos :vec3) { vec3.copy(this._position, pos) }

  @property("quat", {transient: true, editable: false}) get rotation () :quat {
    return this._rotation
  }
  set rotation (rot :quat) { quat.copy(this._rotation, rot) }

  rotate (euler :vec3, frame? :CoordinateFrame) :void {
    quat.fromEuler(tmpq, euler[0], euler[1], euler[2])
    if (frame === "world") quat.multiply(this._rotation, tmpq, this._rotation)
    else quat.multiply(this._localRotation, this._localRotation, tmpq)
  }

  translate (vector :vec3, frame? :CoordinateFrame) :void {
    if (frame === "world") vec3.add(this._position, this._position, vector)
    else {
      vec3.add(
        this._localPosition,
        vec3.transformQuat(tmpv, vector, this._localRotation),
        this._localPosition,
      )
    }
  }

  transformPoint (point :vec3, target? :vec3) :vec3 {
    if (!target) target = vec3.create()
    return vec3.transformMat4(target, point, this.localToWorldMatrix)
  }

  transformVector (vector :vec3, target? :vec3) :vec3 {
    if (!target) target = vec3.create()
    vec4.set(tmpv4, vector[0], vector[1], vector[2], 0)
    vec4.transformMat4(tmpv4, tmpv4, this.localToWorldMatrix)
    return vec3.set(target, tmpv4[0], tmpv4[1], tmpv4[2])
  }

  transformDirection (direction :vec3, target? :vec3) :vec3 {
    target = this.transformVector(direction, target)
    return vec3.normalize(target, target)
  }

  awake () {
    this._disposer.add(this.gameObject.orderValue.onValue(() => {
      if (this._parent) this._parent._childReordered(this)
      else {
        this.gameObject.gameEngine._rootReordered(this)
        this._addedToRoot = true
      }
    }))
  }

  dispose () {
    super.dispose()
    this._maybeRemoveFromParent()
    this.gameObject.gameEngine.dirtyTransforms.delete(this)
  }

  protected _createPropertyValue (name :string, meta :PropertyMeta) :Value<any> {
    switch (name) {
      case "parentId":
        return Mutable.deriveMutable(
          dispatch => {
            let value = this.parentId
            const handler = () => {
              const oldValue = value
              value = this.parentId
              dispatch(value, oldValue)
            }
            this.gameObject.addMessageHandler("onTransformParentChanged", handler)
            return () => this.gameObject.removeMessageHandler("onTransformParentChanged", handler)
          },
          () => this.parentId,
          value => this.parentId = value,
          refEquals,
        )
      case "localPosition":
      case "localScale":
      case "position":
        return this._createTransformPropertyValue(name, createVec3Fn, vec3.copy)

      case "localRotation":
      case "rotation":
        return this._createTransformPropertyValue(name, createQuatFn, quat.copy)

      default:
        return super._createPropertyValue(name, meta)
    }
  }

  private _createTransformPropertyValue<T> (
    name :string,
    createFn :(populate :(out :T, arg? :any) => T) => ((arg? :any) => T),
    copyFn :(out :T, source :T) => T,
  ) :Mutable<any> {
    const current = createFn(out => copyFn(out, this[name]))
    return Mutable.deriveMutable<any>(
      dispatch => {
        let value = current()
        const handler = () => {
          const oldValue = value
          value = current()
          dispatch(value, oldValue)
        }
        this.gameObject.addMessageHandler("onTransformChanged", handler)
        return () => this.gameObject.removeMessageHandler("onTransformChanged", handler)
      },
      current,
      value => copyFn(this[name], value),
      refEquals,
    )
  }

  private _maybeRemoveFromParent () {
    if (this._parent) this._parent._childRemoved(this)
    else if (this._addedToRoot) {
      this.gameObject.gameEngine._rootRemoved(this)
      this._addedToRoot = false
    }
  }

  _childRemoved (child :TypeScriptTransform) {
    this._children.splice(this._children.indexOf(child), 1)
    removeId(this._childIds, child.gameObject.id)
  }

  _childReordered (child :TypeScriptTransform) {
    if (reorderChildId(this._childIds, child, this.gameObject.gameEngine.gameObjects) === -1) {
      this._children.push(child)
    }
  }

  private _invalidate (flags :number) {
    const intersection = flags & ~this._invalidFlags
    if (intersection === 0) return
    this._invalidFlags |= flags
    for (const child of this._children) child._invalidate(WORLD_INVALID)
    if (this.gameObject.hasMessageHandler("onTransformChanged")) {
      this.gameObject.gameEngine.dirtyTransforms.add(this)
    }
  }

  _validate (flags :number) {
    const intersection = flags & this._invalidFlags
    if (intersection === 0) return
    this._invalidFlags &= ~flags
    if (intersection & LOCAL_ROTATION_INVALID) {
      if (this._parent) {
        quat.multiply(
          this._localRotationTarget,
          quat.invert(tmpq, this._parent.rotation),
          this._rotationTarget,
        )
      } else {
        quat.copy(this._localRotationTarget, this._rotationTarget)
      }
    }
    if (intersection & LOCAL_POSITION_INVALID) {
      if (this._parent) {
        vec3.transformMat4(
          this._localPositionTarget,
          this._positionTarget,
          this._parent.worldToLocalMatrix,
        )
      } else {
        vec3.copy(this._localPositionTarget, this._positionTarget)
      }
    }
    if (intersection & LOCAL_TO_WORLD_MATRIX_INVALID) {
      mat4.fromRotationTranslationScale(
        this._localToWorldMatrixTarget,
        this.localRotation,
        this.localPosition,
        this.localScale,
      )
      if (this._parent) {
        mat4.multiply(
          this._localToWorldMatrixTarget,
          this._parent.localToWorldMatrix,
          this._localToWorldMatrixTarget,
        )
      }
    }
    if (intersection & WORLD_TO_LOCAL_MATRIX_INVALID) {
      mat4.invert(this._worldToLocalMatrixTarget, this.localToWorldMatrix)
    }
    if (intersection & POSITION_INVALID) {
      mat4.getTranslation(this._positionTarget, this.localToWorldMatrix)
    }
    if (intersection & ROTATION_INVALID) {
      mat4.getRotation(this._rotationTarget, this.localToWorldMatrix)
    }
    if (intersection & LOSSY_SCALE_INVALID) {
      mat4.getScaling(this._lossyScaleTarget, this.localToWorldMatrix)
    }
    if (intersection & RIGHT_INVALID) {
      vec3.transformQuat(this._rightTarget, vec3.set(this._rightTarget, 1, 0, 0), this.rotation)
    }
    if (intersection & UP_INVALID) {
      vec3.transformQuat(this._upTarget, vec3.set(this._upTarget, 0, 1, 0), this.rotation)
    }
    if (intersection & FORWARD_INVALID) {
      vec3.transformQuat(this._forwardTarget, vec3.set(this._forwardTarget, 0, 0, 1), this.rotation)
    }
  }
}
registerConfigurableType("component", undefined, "transform", TypeScriptTransform)

export class TypeScriptPage extends TypeScriptComponent implements Page {

  get active () { return this.gameObject.gameEngine.activePage.current === this.gameObject.id }
  set active (active :boolean) {
    if (active) this.gameObject.gameEngine.activePage.update(this.gameObject.id)
    else if (this.active) this.gameObject.gameEngine.activePage.update(DEFAULT_PAGE)
  }
}
registerConfigurableType("component", undefined, "page", TypeScriptPage)

export class TypeScriptMeshFilter extends TypeScriptComponent implements MeshFilter {
  meshValue = Mutable.local<TypeScriptMesh|null>(null)

  get mesh () :Mesh|null { return this.meshValue.current }
  set mesh (mesh :Mesh|null) { this.meshValue.update(mesh as TypeScriptMesh|null) }

  @property("mesh", {editable: false}) get meshConfig () :ConfigurableConfig|null {
    return this.gameEngine.createConfigurableConfig(this.mesh)
  }
  set meshConfig (config :ConfigurableConfig|null) {
    this.mesh = this.gameEngine.reconfigureConfigurable("mesh", this.mesh, undefined, config)
  }
}
registerConfigurableType("component", ["engine"], "meshFilter", TypeScriptMeshFilter)

export abstract class TypeScriptMesh extends TypeScriptConfigurable implements Mesh {}

export class TypeScriptSphere extends TypeScriptMesh implements Sphere {}
registerConfigurableType("mesh", [], "sphere", TypeScriptSphere)

export class TypeScriptCylinder extends TypeScriptMesh implements Cylinder {}
registerConfigurableType("mesh", [], "cylinder", TypeScriptCylinder)

export class TypeScriptCube extends TypeScriptMesh implements Cube {}
registerConfigurableType("mesh", [], "cube", TypeScriptCube)

export class TypeScriptQuad extends TypeScriptMesh implements Quad {}
registerConfigurableType("mesh", [], "quad", TypeScriptQuad)

export class TypeScriptIndicator extends TypeScriptMesh implements Indicator {}
registerConfigurableType("mesh", [], "indicator", TypeScriptIndicator)

export class TypeScriptExplicitGeometry extends TypeScriptMesh implements ExplicitGeometry {
  @property("Float32Array", {editable: false}) vertices = new Float32Array()
  @property("Float32Array", {editable: false}) colors = new Float32Array()
  @property("Uint16Array|Uint32Array", {editable: false}) triangles = new Uint16Array()
}
registerConfigurableType("mesh", [], "explicitGeometry", TypeScriptExplicitGeometry)

export class TypeScriptGraph extends TypeScriptComponent implements Graph {
  private readonly _graph :GraphObject

  @property("graph") get graphConfig () :GraphConfig { return this._graph.config }
  set graphConfig (config :GraphConfig) { this._graph.reconfigure(config) }

  constructor (
    gameEngine :TypeScriptGameEngine,
    supertype :string,
    type :string,
    gameObject :TypeScriptGameObject,
  ) {
    super(gameEngine, supertype, type, gameObject)
    const subctx = Object.create(gameObject.gameEngine.ctx)
    subctx.graphComponent = this
    this._graph = new GraphObject(subctx, {})
  }

  onEnable () {
    this._graph.connect()
  }

  update (clock :Clock) {
    this._graph.update(clock)
  }

  onDisable () {
    this._graph.disconnect()
  }
}
registerConfigurableType("component", ["engine"], "graph", TypeScriptGraph)

export class TypeScriptTile extends TypeScriptComponent implements Tile {
  @property("vec3") min = vec3.clone(DefaultTileBounds.min)
  @property("vec3") max = vec3.clone(DefaultTileBounds.max)
  @property("boolean") walkable = false
  @property("boolean") blocking = false
}
registerConfigurableType("component", ["engine"], "tile", TypeScriptTile)

export class TypeScriptSpawnPoint extends TypeScriptComponent implements SpawnPoint {}
registerConfigurableType("component", ["engine"], "spawnPoint", TypeScriptSpawnPoint)

/** Base class for categories of preferences saved to local storage. */
export abstract class PrefsCategory extends TypeScriptConfigurable {
  abstract readonly title :string

  init () {
    super.init()
    // read the initial values from local storage, update on change
    for (const [property, meta] of this.propertiesMeta) {
      if (meta.constraints.readonly || meta.constraints.transient) continue
      const storageKey = this.type + "/" + property
      const value = localStorage.getItem(storageKey)
      if (value !== null) (this as any)[property] = this.gameEngine.loader.eval(value)
      this.getProperty(property).onChange(
        value => localStorage.setItem(storageKey, JavaScript.stringify(value)),
      )
    }
  }
}
