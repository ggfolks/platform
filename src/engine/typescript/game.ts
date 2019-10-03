import {mat4, quat, vec3} from "../../core/math"
import {getValue} from "../../core/util"
import {
  Component, Cube, Cylinder, GameEngine, GameObject, Mesh,
  MeshFilter, PrimitiveType, Quad, Sphere, Transform,
} from "../game"

/** An implementation of the GameEngine interface in TypeScript. */
export class TypeScriptGameEngine implements GameEngine {

  createPrimitive (type :PrimitiveType) :GameObject {
    const gameObject = this.createGameObject(type)
    const meshFilter = gameObject.addComponent<MeshFilter>("meshFilter")
    switch (type) {
      case "sphere": meshFilter.mesh = new TypeScriptSphere() ; break
      case "cylinder": meshFilter.mesh = new TypeScriptCylinder() ; break
      case "cube": meshFilter.mesh = new TypeScriptCube() ; break
      case "quad": meshFilter.mesh = new TypeScriptQuad() ; break
    }
    gameObject.createComponent("meshRenderer")
    return gameObject
  }

  createGameObject (name? :string) :GameObject {
    return new TypeScriptGameObject(getValue(name, "object"))
  }
}

interface ComponentConstructor {
  new (gameObject :TypeScriptGameObject, type :string): Component
}

const componentConstructors = new Map<string, ComponentConstructor>()

function registerComponentType (type :string, constructor :ComponentConstructor) {
  componentConstructors.set(type, constructor)
}

class TypeScriptGameObject implements GameObject {
  readonly transform :Transform

  constructor (public name :string) {
    this.transform = this.addComponent("transform")
  }

  addComponent<T extends Component> (type :string) :T {
    const Constructor = componentConstructors.get(type)
    if (!Constructor) throw new Error(`Unknown component type "${type}"`)
    return new Constructor(this, type) as T
  }

  getComponent<T extends Component> (type :string) :T {
    return this[type] as T
  }

  dispose () {
    for (const key in this) {
      const value = this[key]
      if (value instanceof TypeScriptComponent) value.dispose()
    }
  }
}

class TypeScriptComponent implements Component {

  constructor (readonly gameObject :TypeScriptGameObject, readonly type :string) {
    Object.defineProperty(gameObject, type, {configurable: true, enumerable: true, value: this})
  }

  dispose () {
    delete this.gameObject[this.type]
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
        this._validateLocal()
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
        this._validateGlobal()
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
    if (worldPositionStays) this._localValid = false
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
  }

  private _maybeRemoveFromParent () {
    if (this._parent) this._parent._children.splice(this._parent._children.indexOf(this), 1)
  }

  private _invalidateLocal () {
    this._localValid = false
    this._invalidateChildGlobals()
  }

  private _validateLocal () {
    if (this._localValid) return
    this._localValid = true
    // compute local transform from global and parent global
    mat4.copy(worldMatrix, this.localToWorldMatrix)
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
    this._invalidateChildGlobals()
  }

  private _invalidateChildGlobals () {
    for (const child of this._children) child._invalidateGlobal()
  }

  private _validateGlobal () {
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
  }
}
registerComponentType("transform", TypeScriptTransform)

class TypeScriptMeshFilter extends TypeScriptComponent implements MeshFilter {
  private _mesh? :TypeScriptMesh

  get mesh () :Mesh|undefined { return this._mesh }
  set mesh (mesh :Mesh|undefined) {
    this._mesh = mesh as TypeScriptMesh
  }
}
registerComponentType("meshFilter", TypeScriptMeshFilter)

class TypeScriptMesh implements Mesh {
  dispose () {}
}

class TypeScriptSphere extends TypeScriptMesh implements Sphere {}

class TypeScriptCylinder extends TypeScriptMesh implements Cylinder {}

class TypeScriptCube extends TypeScriptMesh implements Cube {}

class TypeScriptQuad extends TypeScriptMesh implements Quad {}
