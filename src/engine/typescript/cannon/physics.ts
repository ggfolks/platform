import {
  Body, Box, Cylinder, IBodyOptions, Plane, Quaternion, Shape, Sphere, Vec3, World,
} from "cannon"

import {Clock} from "../../../core/clock"
import {quat, vec3} from "../../../core/math"
import {Mutable, Value} from "../../../core/react"
import {Disposer} from "../../../core/util"
import {PhysicsEngine, RigidBody} from "../../physics"
import {
  TypeScriptComponent, TypeScriptGameEngine, TypeScriptGameObject, TypeScriptCube,
  TypeScriptCylinder, TypeScriptMesh, TypeScriptMeshFilter, TypeScriptQuad, TypeScriptSphere,
  registerComponentType,
} from "../game"

/** A physics engine that uses Cannon.js. */
export class CannonPhysicsEngine implements PhysicsEngine {
  private readonly _disposer = new Disposer()
  private readonly _gravity :vec3

  readonly world = new World()

  get gravity () :vec3 { return this._gravity }
  set gravity (gravity :vec3) { vec3.copy(this._gravity, gravity) }

  constructor (readonly gameEngine :TypeScriptGameEngine) {
    gameEngine._physicsEngine = this

    this._gravity = new Proxy(vec3.create(), {
      set: (obj, prop, value) => {
        obj[prop] = value
        this._updateGravity()
        return true
      },
      get: (obj, prop) => {
        return obj[prop]
      },
    })
  }

  update (clock :Clock) :void {
    this.world.step(clock.dt)
    for (const body of this.world.bodies) {
      const userDataBody = body as UserDataBody
      userDataBody.userData.cannonRigidBody._applyTransform()
    }
  }

  dispose () {
    this._disposer.dispose()
  }

  private _updateGravity () {
    this.world.gravity.set(this._gravity[0], this._gravity[1], this._gravity[2])
  }
}

const TypeScriptCubePrototype = TypeScriptCube.prototype as any
TypeScriptCubePrototype._createShape = (scale :vec3) => [
  new Box(new Vec3(0.5 * scale[0], 0.5 * scale[1], 0.5 * scale[2])),
  new Vec3(),
  new Quaternion(),
]

const TypeScriptCylinderPrototype = TypeScriptCylinder.prototype as any
TypeScriptCylinderPrototype._createShape = (scale :vec3) => {
  const xzScale = (scale[0] + scale[2]) / 2
  return [
    new Cylinder(xzScale, xzScale, scale[1], 8),
    new Vec3(),
    new Quaternion().setFromEuler(-Math.PI / 2, 0, 0),
  ]
}

const TypeScriptQuadPrototype = TypeScriptQuad.prototype as any
TypeScriptQuadPrototype._createShape = (scale :vec3) => [
  new Plane(),
  new Vec3(),
  new Quaternion(),
]

const TypeScriptSpherePrototype = TypeScriptSphere.prototype as any
TypeScriptSpherePrototype._createShape = (scale :vec3) => [
  new Sphere((scale[0] + scale[1] + scale[2]) / 3),
  new Vec3(),
  new Quaternion(),
]

interface ExtendedMesh {
  _createShape (scale :vec3) :[Shape, Vec3, Quaternion]
}

class UserDataBody extends Body {
  userData :{cannonRigidBody :CannonRigidBody}

  constructor(options :IBodyOptions, cannonRigidBody :CannonRigidBody) {
    super(options)
    this.userData = {cannonRigidBody}
  }
}

class CannonRigidBody extends TypeScriptComponent implements RigidBody {
  private _body? :Body
  private _mass = 0
  private readonly _scale = Mutable.local(vec3.fromValues(1, 1, 1))

  get mass () :number { return this._mass }
  set mass (mass :number) {
    if (this._mass === mass) return
    this._mass = mass
    this._updateMass()
  }

  get physicsEngine () :CannonPhysicsEngine {
    return this.gameObject.gameEngine.physicsEngine as CannonPhysicsEngine
  }

  constructor (gameObject :TypeScriptGameObject, type :string) {
    super(gameObject, type)

    this._disposer.add(
      Value
        .join2(
          this.gameObject
            .getComponentValue<TypeScriptMeshFilter>("meshFilter")
            .switchMap(
              meshFilter => meshFilter
                ? meshFilter.meshValue
                : Value.constant<TypeScriptMesh|undefined>(undefined),
            ),
          this._scale,
        )
        .onValue(([mesh, scale]) => {
          if (this._body) this.physicsEngine.world.remove(this._body)
          if (!mesh) return
          this.physicsEngine.world.addBody(this._body = new UserDataBody({mass: this._mass}, this))
          const extended = mesh as unknown as ExtendedMesh
          this._body.addShape(...extended._createShape(scale))
          this._updateTransform()
        })
    )
  }

  onTransformChanged () {
    this._updateTransform()
  }

  dispose () {
    super.dispose()
    if (this._body) this.physicsEngine.world.remove(this._body)
  }

  _applyTransform () {
    if (!this._body) return
    const bodyPos = this._body.position
    vec3.set(this.transform.position, bodyPos.x, bodyPos.y, bodyPos.z)
    const bodyRot = this._body.quaternion
    quat.set(this.transform.rotation, bodyRot.x, bodyRot.y, bodyRot.z, bodyRot.w)
  }

  private _updateTransform () {
    if (!this._body) return
    const position = this.transform.position
    this._body.position.set(position[0], position[1], position[2])
    const rotation = this.transform.rotation
    this._body.quaternion.set(rotation[0], rotation[1], rotation[2], rotation[3])
    const lossyScale = this.transform.lossyScale
    if (!vec3.equals(lossyScale, this._scale.current)) this._scale.update(vec3.clone(lossyScale))
  }

  private _updateMass () {
    if (!this._body) return
    this._body.mass = this._mass
    this._body.type = (this._mass === 0) ? Body.STATIC : Body.DYNAMIC
    this._body.updateMassProperties()
  }
}
registerComponentType("rigidBody", CannonRigidBody)
