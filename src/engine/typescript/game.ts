import {Clock} from "../../core/clock"
import {mat4, quat, vec3} from "../../core/math"
import {Mutable, Value} from "../../core/react"
import {Disposer, getValue} from "../../core/util"
import {
  Component, Coroutine, Cube, Cylinder, GameEngine, GameObject, Mesh,
  MeshFilter, PrimitiveType, Quad, Sphere, Time, Transform,
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

  createPrimitive (type :PrimitiveType) :GameObject {
    const gameObject = this.createGameObject(type, ["meshFilter", "meshRenderer"])
    const meshFilter = gameObject.getComponent<MeshFilter>("meshFilter")
    switch (type) {
      case "sphere": meshFilter.mesh = new TypeScriptSphere() ; break
      case "cylinder": meshFilter.mesh = new TypeScriptCylinder() ; break
      case "cube": meshFilter.mesh = new TypeScriptCube() ; break
      case "quad": meshFilter.mesh = new TypeScriptQuad() ; break
    }
    return gameObject
  }

  createGameObject (name? :string, components? :string[]) :GameObject {
    return new TypeScriptGameObject(this, getValue(name, "object"), components || [])
  }

  update (clock :Clock) :void {
    Time.deltaTime = clock.dt
    for (const updatable of this.updatables) updatable.update(clock)
    for (const transform of this.dirtyTransforms) transform._validateGlobal()
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

  constructor (public gameEngine :TypeScriptGameEngine, public name :string, components :string[]) {
    this.transform = this.addComponent("transform")
    for (const type of components) this.addComponent(type, false)
    this.sendMessage("awake")
  }

  addComponent<T extends Component> (type :string, wake = true) :T {
    const Constructor = componentConstructors.get(type)
    if (!Constructor) throw new Error(`Unknown component type "${type}"`)
    const component = new Constructor(this, type) as T
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

  startCoroutine (fn :() => Generator<void>) :Coroutine {
    return new TypeScriptCoroutine(this, fn())
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

const worldMatrix = mat4.create()
const parentInverseMatrix = mat4.create()

class TypeScriptTransform extends TypeScriptComponent implements Transform {
  readonly lossyScale :vec3
  readonly localToWorldMatrix :mat4

  private _parent? :TypeScriptTransform
  private _children :TypeScriptTransform[] = []
  private _localPosition :vec3
  private _localRotation :quat
  private _localScale :vec3
  private _position :vec3
  private _rotation :quat
  private _localPositionTarget :vec3
  private _localRotationTarget :quat
  private _localScaleTarget :vec3
  private _positionTarget :vec3
  private _rotationTarget :quat
  private _lossyScaleTarget :vec3
  private _localToWorldMatrixTarget :mat4
  private _localValid = true
  private _globalValid = true

  constructor (gameObject :TypeScriptGameObject, type :string) {
    super(gameObject, type)

    const makeLocalProxy = (target :any) => new Proxy(target, {
      set: (obj, prop, value) => {
        obj[prop] = value
        this._invalidateGlobal()
        return true
      },
      get: (obj, prop) => {
        this._validateLocal()
        return obj[prop]
      },
    })
    this._localPosition = makeLocalProxy(this._localPositionTarget = vec3.create())
    this._localRotation = makeLocalProxy(this._localRotationTarget = quat.create())
    this._localScale = makeLocalProxy(this._localScaleTarget = vec3.fromValues(1, 1, 1))

    const makeGlobalProxy = (target :any) => new Proxy(target, {
      set: (obj, prop, value) => {
        obj[prop] = value
        this._invalidateLocal()
        return true
      },
      get: (obj, prop) => {
        this._validateGlobal()
        return obj[prop]
      },
    })
    this._position = makeGlobalProxy(this._positionTarget = vec3.create())
    this._rotation = makeGlobalProxy(this._rotationTarget = quat.create())

    const makeReadOnlyGlobalProxy = (target :any) => new Proxy(target, {
      set: (obj, prop, value) => {
        throw new Error("Object is read-only")
      },
      get: (obj, prop) => {
        this._validateGlobal()
        return obj[prop]
      },
    })
    this.lossyScale = makeReadOnlyGlobalProxy(this._lossyScaleTarget = vec3.fromValues(1, 1, 1))
    this.localToWorldMatrix = makeReadOnlyGlobalProxy(
      this._localToWorldMatrixTarget = mat4.create(),
    )
  }

  get parent () :Transform|undefined { return this._parent }
  set parent (newParent :Transform|undefined) { this.setParent(newParent) }

  setParent (parent :Transform|undefined, worldPositionStays = true) :void {
    if (this._parent === parent) return
    this._maybeRemoveFromParent()
    this._parent = parent as TypeScriptTransform|undefined
    if (this._parent) this._parent._children.push(this)
    if (worldPositionStays) this._invalidateLocal()
    else this._invalidateGlobal()
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

  private _invalidateLocal () {
    this._localValid = false
    this._invalidateGlobal()
  }

  private _validateLocal () {
    if (this._localValid) return
    this._localValid = true
    // compute local transform from global and parent global
    mat4.fromRotationTranslationScale(
      worldMatrix,
      this._rotationTarget,
      this._positionTarget,
      this._lossyScaleTarget,
    )
    if (this._parent) {
      mat4.invert(parentInverseMatrix, this._parent.localToWorldMatrix)
      mat4.multiply(worldMatrix, parentInverseMatrix, worldMatrix)
    }
    mat4.getTranslation(this._localPositionTarget, worldMatrix)
    mat4.getRotation(this._localRotationTarget, worldMatrix)
    mat4.getScaling(this._localScaleTarget, worldMatrix)
  }

  private _invalidateGlobal () {
    if (!this._globalValid) return
    this._globalValid = false
    if (this.gameObject.hasMessageHandler("onTransformChanged")) {
      this.gameObject.gameEngine.dirtyTransforms.add(this)
    }
    this._invalidateChildGlobals()
  }

  private _invalidateChildGlobals () {
    for (const child of this._children) child._invalidateGlobal()
  }

  _validateGlobal () {
    if (this._globalValid) return
    this._globalValid = true
    // compute global transform from local and parent global
    mat4.fromRotationTranslationScale(
      this._localToWorldMatrixTarget,
      this._localRotation,
      this._localPosition,
      this._localScale,
    )
    if (this._parent) {
      mat4.multiply(
        this._localToWorldMatrixTarget,
        this._parent.localToWorldMatrix,
        this._localToWorldMatrixTarget,
      )
    }
    mat4.getTranslation(this._positionTarget, this._localToWorldMatrixTarget)
    mat4.getRotation(this._rotationTarget, this._localToWorldMatrixTarget)
    mat4.getScaling(this._lossyScaleTarget, this._localToWorldMatrixTarget)
    this.sendMessage("onTransformChanged")
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
