import {Clock} from "../../core/clock"
import {mat4, quat, vec3} from "../../core/math"
import {Mutable, Value} from "../../core/react"
import {Disposer, PMap, getValue} from "../../core/util"
import {
  Component, ComponentConfig, Coroutine, Cube, Cylinder, GameEngine, GameObject, GameObjectConfig,
  Mesh, MeshFilter, PrimitiveType, Quad, Sphere, Time, Transform,
} from "../game"
import {RenderEngine} from "../render"

interface Updatable { update (clock :Clock) :void }
interface Wakeable { awake () :void }

/** An implementation of the GameEngine interface in TypeScript. */
export class TypeScriptGameEngine implements GameEngine {
  readonly dirtyTransforms = new Set<TypeScriptTransform>()
  readonly updatables = new Set<Updatable>()

  _renderEngine? :RenderEngine

  get renderEngine () :RenderEngine {
    if (!this._renderEngine) throw new Error("Missing render engine")
    return this._renderEngine
  }

  createPrimitive (type :PrimitiveType, materialConfig? :PMap<any>) :GameObject {
    let mesh :TypeScriptMesh
    switch (type) {
      case "sphere": mesh = new TypeScriptSphere() ; break
      case "cylinder": mesh = new TypeScriptCylinder() ; break
      case "cube": mesh = new TypeScriptCube() ; break
      case "quad": mesh = new TypeScriptQuad() ; break
      default: throw new Error(`Unknown primitive type "${type}"`)
    }
    return this.createGameObject(type, {
      meshFilter: {mesh},
      meshRenderer: {material: materialConfig || {}},
    })
  }

  createGameObjects (configs :PMap<GameObjectConfig>) :void {
    for (const name in configs) this.createGameObject(name, configs[name])
  }

  createGameObject (name? :string, config? :GameObjectConfig) :GameObject {
    return new TypeScriptGameObject(this, getValue(name, "object"), config || {})
  }

  update (clock :Clock) :void {
    Time.deltaTime = clock.dt
    for (const updatable of this.updatables) updatable.update(clock)
    for (const transform of this.dirtyTransforms) transform._validate(LOCAL_TO_WORLD_MATRIX_INVALID)
    this.dirtyTransforms.clear()
    this.renderEngine.update()
  }

  dispose () {
    // TODO: dispose of all extant game objects?
  }
}

/** Constructor interface for TypeScript components. */
export interface ComponentConstructor {
  new (gameObject :TypeScriptGameObject, type :string): Component
}

const componentConstructors = new Map<string, ComponentConstructor>()

/** Registers a component type's constructor with the TypeScript engine.
  * @param type the component type name.
  * @param constructor the component constructor. */
export function registerComponentType (type :string, constructor :ComponentConstructor) {
  componentConstructors.set(type, constructor)
}

export class TypeScriptGameObject implements GameObject {
  readonly transform :Transform

  private readonly _componentValues = new Map<string, Mutable<Component|undefined>>()

  constructor (
    public gameEngine :TypeScriptGameEngine,
    public name :string,
    config :GameObjectConfig,
  ) {
    this.transform = this.addComponent("transform", {}, false)
    this.addComponents(config, false)
    this.sendMessage("awake")
  }

  addComponents (config :PMap<ComponentConfig>, wake = true) {
    for (const type in config) this.addComponent(type, config[type], wake)
  }

  addComponent<T extends Component> (type :string, config :ComponentConfig = {}, wake = true) :T {
    let component = this[type] as T|undefined
    if (!component) {
      const Constructor = componentConstructors.get(type)
      if (!Constructor) throw new Error(`Unknown component type "${type}"`)
      component = new Constructor(this, type) as T
    }
    applyConfig(component, config)
    if (wake) {
      const wakeable = component as unknown as Wakeable
      if (wakeable.awake) wakeable.awake()
    }
    return component
  }

  getComponent<T extends Component> (type :string) :T {
    return this[type] as T
  }

  getComponentValue<T extends Component> (type :string) :Value<T|undefined> {
    let value = this._componentValues.get(type)
    if (!value) this._componentValues.set(type, value = Mutable.local(this[type]))
    return value as Value<T|undefined>
  }

  hasMessageHandler (message :string) :boolean {
    for (const key in this) {
      if (this[key][message]) return true
    }
    return false
  }

  sendMessage (message :string) :void {
    for (const key in this) {
      const component = this[key]
      if (component[message]) component[message]()
    }
  }

  dispose () {
    for (const key in this) {
      const value = this[key]
      if (value instanceof TypeScriptComponent) value.dispose()
    }
  }

  _setComponent (type :string, component :Component) {
    const value = this._componentValues.get(type)
    if (value) value.update(component)
    if (type === "transform") return // transform is handled as a special case
    Object.defineProperty(this, type, {configurable: true, enumerable: true, value: component})
  }

  _deleteComponent (type :string) {
    delete this[type]
    const value = this._componentValues.get(type)
    if (value) value.update(undefined)
  }
}

function applyConfig (target :PMap<any>, config :PMap<any>) {
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

export class TypeScriptComponent implements Component {
  protected readonly _disposer = new Disposer()
  private readonly _coroutines :Coroutine[] = []

  get transform () :Transform { return this.gameObject.transform }

  constructor (readonly gameObject :TypeScriptGameObject, readonly type :string) {
    gameObject._setComponent(type, this)
    const updatable = this as unknown as Updatable
    if (updatable.update) gameObject.gameEngine.updatables.add(updatable)
  }

  sendMessage (message :string) :void {
    this.gameObject.sendMessage(message)
  }

  startCoroutine (fnOrGenerator :(() => Generator<void>)|Generator<void>) :Coroutine {
    return new TypeScriptCoroutine(
      this,
      typeof fnOrGenerator === "function" ? fnOrGenerator() : fnOrGenerator,
    )
  }

  dispose () {
    this._disposer.dispose()
    this.gameObject._deleteComponent(this.type)
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

const LOCAL_POSITION_INVALID = (1 << 0)
const LOCAL_ROTATION_INVALID = (1 << 1)
const LOCAL_SCALE_INVALID = (1 << 2)
const POSITION_INVALID = (1 << 3)
const ROTATION_INVALID = (1 << 4)
const LOSSY_SCALE_INVALID = (1 << 5)
const LOCAL_TO_WORLD_MATRIX_INVALID = (1 << 6)
const WORLD_TO_LOCAL_MATRIX_INVALID = (1 << 7)

class TypeScriptTransform extends TypeScriptComponent implements Transform {
  readonly lossyScale :vec3
  readonly localToWorldMatrix :mat4
  readonly worldToLocalMatrix :mat4

  private _parent? :TypeScriptTransform
  private _children :TypeScriptTransform[] = []
  private _localPosition :vec3
  private _localRotation :quat
  private _localScale :vec3
  private _position :vec3
  private _rotation :quat
  private _localPositionTarget :vec3
  private _localRotationTarget :quat
  private _positionTarget :vec3
  private _rotationTarget :quat
  private _lossyScaleTarget :vec3
  private _localToWorldMatrixTarget :mat4
  private _worldToLocalMatrixTarget :mat4
  private _invalidFlags = 0

  constructor (gameObject :TypeScriptGameObject, type :string) {
    super(gameObject, type)

    const makeReadWriteProxy = (
      target :any,
      invalidateFlags :number,
      validateFlags :number,
    ) => new Proxy(target, {
      set: (obj, prop, value) => {
        obj[prop] = value
        this._invalidate(invalidateFlags)
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

  get parent () :Transform|undefined { return this._parent }
  set parent (newParent :Transform|undefined) { this.setParent(newParent) }

  setParent (parent :Transform|undefined, worldPositionStays = true) :void {
    if (this._parent === parent) return
    this._maybeRemoveFromParent()
    this._parent = parent as TypeScriptTransform|undefined
    if (this._parent) this._parent._children.push(this)
    if (worldPositionStays) {
      this._invalidate(
        LOCAL_POSITION_INVALID | LOCAL_ROTATION_INVALID |
        LOCAL_TO_WORLD_MATRIX_INVALID | WORLD_TO_LOCAL_MATRIX_INVALID,
      )
    } else {
      this._invalidate(
        POSITION_INVALID | ROTATION_INVALID | LOSSY_SCALE_INVALID |
        LOCAL_TO_WORLD_MATRIX_INVALID | WORLD_TO_LOCAL_MATRIX_INVALID,
      )
    }
  }

  get childCount () :number { return this._children.length }

  getChild (index :number) :Transform {
    return this._children[index]
  }

  get localPosition () :vec3 { return this._localPosition }
  set localPosition (pos :vec3) { vec3.copy(this._localPosition, pos) }

  get localRotation () :quat { return this._localRotation }
  set localRotation (rot :quat) { quat.copy(this._localRotation, rot) }

  get localScale () :vec3 { return this._localScale }
  set localScale (scale :vec3) { vec3.copy(this._localScale, scale) }

  get position () :vec3 { return this._position }
  set position (pos :vec3) { vec3.copy(this._position, pos) }

  get rotation () :quat { return this._rotation }
  set rotation (rot :quat) { quat.copy(this._rotation, rot) }

  dispose () {
    super.dispose()
    this._maybeRemoveFromParent()
    this.gameObject.gameEngine.dirtyTransforms.delete(this)
  }

  private _maybeRemoveFromParent () {
    if (this._parent) this._parent._children.splice(this._parent._children.indexOf(this), 1)
  }

  private _invalidate (flags :number) {
    const intersection = flags & ~this._invalidFlags
    if (intersection === 0) return
    this._invalidFlags |= flags
    let childFlags = 0
    if (intersection & (LOCAL_POSITION_INVALID | POSITION_INVALID)) {
      childFlags |= POSITION_INVALID | LOCAL_TO_WORLD_MATRIX_INVALID | WORLD_TO_LOCAL_MATRIX_INVALID
    }
    if (intersection & (LOCAL_ROTATION_INVALID | ROTATION_INVALID)) {
      childFlags |=
        POSITION_INVALID | ROTATION_INVALID | LOSSY_SCALE_INVALID |
        LOCAL_TO_WORLD_MATRIX_INVALID | WORLD_TO_LOCAL_MATRIX_INVALID
    }
    if (intersection & LOCAL_SCALE_INVALID) {
      childFlags |=
        POSITION_INVALID | LOSSY_SCALE_INVALID |
        LOCAL_TO_WORLD_MATRIX_INVALID | WORLD_TO_LOCAL_MATRIX_INVALID
    }
    if (childFlags !== 0) {
      for (const child of this._children) child._invalidate(childFlags)
    }
    if (
      intersection & LOCAL_TO_WORLD_MATRIX_INVALID &&
      this.gameObject.hasMessageHandler("onTransformChanged")
    ) {
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
        // TODO: figure out why the transform fails to update without this
        this._parent._validate(ROTATION_INVALID)
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
registerComponentType("transform", TypeScriptTransform)

export class TypeScriptMeshFilter extends TypeScriptComponent implements MeshFilter {
  meshValue = Mutable.local<TypeScriptMesh|undefined>(undefined)

  get mesh () :Mesh|undefined { return this.meshValue.current }
  set mesh (mesh :Mesh|undefined) { this.meshValue.update(mesh as TypeScriptMesh) }
}
registerComponentType("meshFilter", TypeScriptMeshFilter)

export class TypeScriptMesh implements Mesh {
  dispose () {}
}

export class TypeScriptSphere extends TypeScriptMesh implements Sphere {}

export class TypeScriptCylinder extends TypeScriptMesh implements Cylinder {}

export class TypeScriptCube extends TypeScriptMesh implements Cube {}

export class TypeScriptQuad extends TypeScriptMesh implements Quad {}
