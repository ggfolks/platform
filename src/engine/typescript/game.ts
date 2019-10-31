import {loadImage} from "../../core/assets"
import {Clock} from "../../core/clock"
import {refEquals} from "../../core/data"
import {mat4, quat, vec3, vec4} from "../../core/math"
import {Mutable, Value} from "../../core/react"
import {MutableMap, RMap} from "../../core/rcollect"
import {Disposer, NoopRemover, PMap, getValue} from "../../core/util"
import {windowSize} from "../../core/ui"
import {Graph as GraphObject, GraphConfig} from "../../graph/graph"
import {CategoryNode, NodeConfig, NodeTypeRegistry} from "../../graph/node"
import {registerLogicNodes} from "../../graph/logic"
import {registerMathNodes} from "../../graph/math"
import {createQuatFn, createVec3Fn, registerMatrixNodes} from "../../graph/matrix"
import {registerSignalNodes} from "../../graph/signal"
import {SubgraphRegistry, registerUtilNodes} from "../../graph/util"
import {registerInputNodes} from "../../input/node"
import {HTMLHost} from "../../ui/element"
import {registerUINodes} from "../../ui/node"
import {DefaultStyles, DefaultTheme} from "../../ui/theme"
import {
  DEFAULT_PAGE, Component, ComponentConstructor, Configurable, ConfigurableConfig, CoordinateFrame,
  Coroutine, Cube, Cylinder, GameContext, GameEngine, GameObject, GameObjectConfig, Graph, Mesh,
  MeshFilter, Page, PrimitiveType, Quad, SpaceConfig, Sphere, Time, Transform,
} from "../game"
import {PropertyMeta, getConfigurableMeta, property} from "../meta"
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

  init () :void {}

  getProperty<T> (name :string, overrideDefault? :any) :Value<T|undefined>|Mutable<T|undefined> {
    const propertyName = name + "Value"
    const property = this[propertyName]
    if (property instanceof Value) return property as unknown as Value<T|undefined>
    // default implementation doesn't know about changes
    return Mutable.deriveMutable(
      dispatch => NoopRemover,
      () => this[name] as T|undefined,
      newValue => this[name] = newValue,
      refEquals,
    )
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
}

interface Updatable { update (clock :Clock) :void }
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

  _renderEngine? :RenderEngine
  _physicsEngine? :PhysicsEngine

  readonly _gameObjects = MutableMap.local<string, GameObject>()

  readonly _defaultRootIds = Mutable.local<string[]>([])

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

  constructor (readonly root :HTMLElement) {
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
      subgraphs: new SubgraphRegistry(registerEngineSubgraphs),
      host: this._disposer.add(new HTMLHost(root)),
      theme: DefaultTheme,
      styles: DefaultStyles,
      image: {resolve: loadImage},
      screen: windowSize(window),
    }
    this.rootIds = this.activePage.switchMap(
      page => page === DEFAULT_PAGE
        ? this._defaultRootIds
        : this.gameObjects.require(page).transform.childIds,
    )
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
    return this.createGameObject(name || "page", {page: {}})
  }

  createPrimitive (type :PrimitiveType, config? :GameObjectConfig) :GameObject {
    const mergedConfig = {
      meshFilter: {meshConfig: {type}},
      meshRenderer: {},
    }
    if (config) applyConfig(mergedConfig, config)
    return this.createGameObject(type, mergedConfig)
  }

  createGameObjects (configs :SpaceConfig) :void {
    for (const name in configs) this.createGameObject(name, configs[name])
  }

  createGameObject (name? :string, config? :GameObjectConfig) :GameObject {
    return new TypeScriptGameObject(this, getValue(name, "object"), config || {})
  }

  createConfig () :SpaceConfig {
    const config :SpaceConfig = {}
    for (const [id, gameObject] of this.gameObjects) config[id] = gameObject.createConfig()
    return config
  }

  update (clock :Clock) :void {
    Time.deltaTime = clock.dt
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
    for (const transform of this.dirtyTransforms) transform._validate(LOCAL_TO_WORLD_MATRIX_INVALID)
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

export class TypeScriptGameObject implements GameObject {
  readonly id :string
  readonly nameValue :Mutable<string>
  readonly orderValue = Mutable.local(0)
  readonly transform :Transform
  readonly page? :Page

  private readonly _componentTypes = Mutable.local<string[]>([])
  private readonly _components = MutableMap.local<string, Component>()
  private readonly _messageHandlers = new Map<string, MessageHandler[]>()

  get name () :string { return this.nameValue.current }
  set name (name :string) { this.nameValue.update(name) }

  get order () :number { return this.orderValue.current }
  set order (order :number) { this.orderValue.update(order) }

  get componentTypes () :Value<string[]> { return this._componentTypes }
  get components () :RMap<string, Component> { return this._components }

  constructor (
    public gameEngine :TypeScriptGameEngine,
    name :string,
    config :GameObjectConfig,
  ) {
    this.id = name
    for (
      let ii = 2;
      gameEngine._gameObjects.has(this.id) || this.id === DEFAULT_PAGE;
      ii++
    ) this.id = name + ii
    gameEngine._gameObjects.set(this.id, this)
    this.nameValue = Mutable.local(name)
    this.transform = this.addComponent("transform", {}, false)
    for (const key in config) {
      const value = config[key]
      if (key === "transform") {
        applyConfig(this.transform, value)
        continue
      }
      if (typeof value === "object") this.addComponent(key, value, false)
      else this[key] = value
    }
    this.sendMessage("awake")
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
    for (const key in this) {
      const component = this[key]
      if (component[message]) component[message](...args)
    }
    const handlers = this._messageHandlers.get(message)
    if (handlers) {
      for (const handler of handlers) handler(...args)
    }
  }

  getProperty<T> (name :string, overrideDefault? :any) :Value<T|undefined>|Mutable<T|undefined> {
    switch (name) {
      case "id": return Value.constant(this.id) as unknown as Value<T|undefined>
      case "name": return this.nameValue as unknown as Value<T|undefined>
      case "order": return this.orderValue as unknown as Value<T|undefined>
      default: return this.components.getValue(name) as unknown as Value<T|undefined>
    }
  }

  createConfig () :GameObjectConfig {
    const config :GameObjectConfig = {}
    if (this.name !== this.id) config.name = this.name
    if (this.order !== 0) config.order = this.order
    for (const type of this._componentTypes.current) {
      config[type] = this._components.require(type).createConfig()
    }
    return config
  }

  dispose () {
    this.gameEngine._gameObjects.delete(this.id)
    for (const key in this) {
      const value = this[key]
      if (value instanceof TypeScriptComponent) value.dispose()
    }
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
      targetValue !== null &&
      !(targetValue instanceof NonApplicableConfig)
    ) applyConfig(targetValue, value)
    else target[key] = value
  }
}

export class TypeScriptComponent extends TypeScriptConfigurable implements Component {
  readonly aliases :string[]
  readonly orderValue = Mutable.local(0)

  protected readonly _disposer = new Disposer()
  private readonly _coroutines :Coroutine[] = []

  get removable () :boolean { return true }

  get order () :number { return this.orderValue.current }
  set order (order :number) { this.orderValue.update(order) }

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
    const updatable = this as unknown as Updatable
    if (updatable.update) gameObject.gameEngine.updatables.add(updatable)
  }

  init () {
    this._disposer.add(this.orderValue.onValue(() => this.gameObject._componentReordered(this)))
  }

  requireComponent<T extends Component> (type :string|ComponentConstructor<T>) :T {
    return this.gameObject.requireComponent(type)
  }

  getComponent<T extends Component> (type :string|ComponentConstructor<T>) :T|undefined {
    return this.gameObject.getComponent(type)
  }

  sendMessage (message :string, ...args :any[]) :void {
    this.gameObject.sendMessage(message, ...args)
  }

  startCoroutine (fnOrGenerator :(() => Generator<void>)|Generator<void>) :Coroutine {
    return new TypeScriptCoroutine(
      this,
      typeof fnOrGenerator === "function" ? fnOrGenerator() : fnOrGenerator,
    )
  }

  createConfig () :ConfigurableConfig {
    const config :ConfigurableConfig = {}
    if (this.order !== 0) config.order = this.order
    const meta = getConfigurableMeta(Object.getPrototypeOf(this))
    for (const [key, property] of meta.properties) {
      if (property.constraints.readonly || property.constraints.transient) continue
      config[key] = JavaScript.clone(this[key])
    }
    return config
  }

  dispose () {
    this._disposer.dispose()
    this.gameObject._componentRemoved(this)
    for (const coroutine of this._coroutines) coroutine.dispose()
    const updatable = this as unknown as Updatable
    if (updatable.update) this.gameObject.gameEngine.updatables.delete(updatable)
  }

  _addCoroutine (coroutine :TypeScriptCoroutine) {
    this._coroutines.push(coroutine)
    this.gameObject.gameEngine.updatables.add(coroutine)
  }

  _removeCoroutine (coroutine :TypeScriptCoroutine) {
    this._coroutines.splice(this._coroutines.indexOf(coroutine), 1)
    this.gameObject.gameEngine.updatables.delete(coroutine)
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

const LOCAL_INVALID =
  LOCAL_POSITION_INVALID | LOCAL_ROTATION_INVALID |
  LOCAL_TO_WORLD_MATRIX_INVALID | WORLD_TO_LOCAL_MATRIX_INVALID

const WORLD_INVALID =
  POSITION_INVALID | ROTATION_INVALID | LOSSY_SCALE_INVALID |
  LOCAL_TO_WORLD_MATRIX_INVALID | WORLD_TO_LOCAL_MATRIX_INVALID

class TypeScriptTransform extends TypeScriptComponent implements Transform {
  @property("vec3", {readonly: true, transient: true}) readonly lossyScale :vec3
  readonly localToWorldMatrix :mat4
  readonly worldToLocalMatrix :mat4

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
      ROTATION_INVALID | LOCAL_TO_WORLD_MATRIX_INVALID | WORLD_TO_LOCAL_MATRIX_INVALID,
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
      LOCAL_ROTATION_INVALID | LOCAL_TO_WORLD_MATRIX_INVALID | WORLD_TO_LOCAL_MATRIX_INVALID,
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
  }

  get removable () :boolean { return false }

  get parent () :Transform|undefined { return this._parent }
  set parent (newParent :Transform|undefined) { this.setParent(newParent) }

  get parentId () :string|undefined { return this._parent && this._parent.gameObject.id }
  set parentId (id :string|undefined) {
    this.parent = (id === undefined)
      ? undefined
      : this.gameObject.gameEngine.gameObjects.require(id).transform
  }

  setParent (parent :Transform|undefined, worldPositionStays = true) :void {
    if (this._parent === parent) return
    this._maybeRemoveFromParent()
    this._parent = parent as TypeScriptTransform|undefined
    if (this._parent) this._parent._childReordered(this)
    else {
      this.gameObject.gameEngine._rootReordered(this)
      this._addedToRoot = true
    }
    this._invalidate(worldPositionStays ? LOCAL_INVALID : WORLD_INVALID)
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

  @property("vec3", {transient: true}) get position () :vec3 { return this._position }
  set position (pos :vec3) { vec3.copy(this._position, pos) }

  @property("quat", {transient: true}) get rotation () :quat { return this._rotation }
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

  getProperty<T> (name :string, overrideDefault? :any) :Value<T|undefined>|Mutable<T|undefined> {
    switch (name) {
      case "localPosition":
      case "localScale":
      case "position":
        return this._getTransformProperty(name, createVec3Fn, vec3.copy)

      case "localRotation":
      case "rotation":
        return this._getTransformProperty(name, createQuatFn, quat.copy)
    }
    return super.getProperty(name, overrideDefault)
  }

  private _getTransformProperty<T> (
    name :string,
    createFn :(populate :(out :T, arg? :any) => T) => ((arg? :any) => T),
    copyFn :(out :T, source :T) => T,
  ) :Mutable<any> {
    const propertyName = `_${name}Property`
    const property = this[propertyName]
    if (property) return property
    const current = createFn(out => copyFn(out, this[name]))
    return this[propertyName] = Mutable.deriveMutable<any>(
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
    if (intersection & LOCAL_TO_WORLD_MATRIX_INVALID) {
      this.sendMessage("onTransformChanged")
    }
  }
}
registerConfigurableType("component", undefined, "transform", TypeScriptTransform)

class TypeScriptPage extends TypeScriptComponent implements Page {

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

  get meshConfig () :ConfigurableConfig|null {
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

// marker class to flag configurations as being not recursively applicable
class NonApplicableConfig<T> {
  [key :string] :T
}

export class TypeScriptGraph extends TypeScriptComponent implements Graph {
  private readonly _graph :GraphObject

  get graphConfig () :GraphConfig { return this._graph.config }
  set graphConfig (config :GraphConfig) {
    // remove any nodes no longer in the config
    for (const id of this._graph.nodes.keys()) {
      if (config[id] === undefined) this._graph.removeNode(id)
    }
    // add/re-add any nodes present
    for (const id in config) {
      if (this._graph.nodes.has(id)) this._graph.removeNode(id)
      this._graph.createNode(id, config[id])
    }
    // connect after everything's in place
    for (const id in config) {
      this._graph.nodes.require(id).connect()
    }
  }

  constructor (
    gameEngine :TypeScriptGameEngine,
    supertype :string,
    type :string,
    gameObject :TypeScriptGameObject,
  ) {
    super(gameEngine, supertype, type, gameObject)
    const subctx = Object.create(gameObject.gameEngine.ctx)
    subctx.graphComponent = this
    this._graph = new GraphObject(subctx, new NonApplicableConfig<NodeConfig>())
  }

  update (clock :Clock) {
    this._graph.update(clock)
  }
}
registerConfigurableType("component", ["engine"], "graph", TypeScriptGraph)
