import {Body, Box, IBodyOptions, NaiveBroadphase, Plane, Sphere, Vec3, World} from "cannon"

import {Clock} from "../core/clock"
import {Component, Domain, EntityConfig, ID, Matcher, System} from "../entity/entity"
import {TransformComponent} from "../space/entity"

/** Configures the shapes and mass of a physical body. */
export interface BodyConfig {
  shapes :ShapeConfig[]
  mass? :number
}

/** Base class for shape configs. */
export interface ShapeConfig {
  type :string
}

/** A configuration for a sphere shape. */
export interface SphereConfig {
  type :"sphere"
}

/** A configuration for a box shape. */
export interface BoxConfig {
  type :"box"
}

/** A configuration for a plane shape. */
export interface PlaneConfig {
  type :"plane"
}

/** Extends body with some Three.js-style user data. */
export class UserDataBody extends Body {
  userData :{id :number}

  constructor(options :IBodyOptions, id :number) {
    super(options)
    this.userData = {id}
  }
}

/** Extends the normal broadphase to report collisions between static and kinematric bodes.  I would
 * love to use SAPBroadphase as a base, instead, but its results seem inconsistent.  Must
 * investigate further. */
class BroaderBroadphase extends NaiveBroadphase {

  needBroadphaseCollision (bodyA :Body, bodyB :Body) {
    // adapted from the Cannon.js source:
    // https://github.com/schteppe/cannon.js/blob/master/src/collision/Broadphase.js#L55

    // Check collision filter masks
    if (
      (bodyA.collisionFilterGroup & bodyB.collisionFilterMask) === 0 ||
      (bodyB.collisionFilterGroup & bodyA.collisionFilterMask) === 0
    ) {
      return false
    }

    // Check types
    if (bodyA.sleepState === Body.SLEEPING && bodyB.sleepState === Body.SLEEPING) {
      // Both bodies are sleeping. Skip.
      return false
    }
    return true
  }
}

/** The canonical id of the Body component. */
export const CanonicalBodyId = "body"

/** Manages a group of physical bodies. Users of this system must call [[PhysicsSystem.update]] on
 * every frame. */
export class PhysicsSystem extends System {
  readonly world :World = new World()

  constructor (domain :Domain,
               readonly trans :TransformComponent,
               readonly body :Component<Body>) {
    super(domain, Matcher.hasAllC(trans.id, body.id))

    // use a broadphase that will report collisions between static/kinematic bodies
    this.world.broadphase = new BroaderBroadphase()
  }

  update (clock :Clock) {
    this.onEntities(id => {
      // Cannon vectors/quaternions have same fields as Three.js ones
      const body = this.body.read(id)
      this.trans.readPosition(id, body.position as any)
      this.trans.readQuaternion(id, body.quaternion as any)
    })
    this.world.step(clock.dt)
    this.onEntities(id => {
      const body = this.body.read(id)
      this.trans.updatePosition(id, body.position as any)
      this.trans.updateQuaternion(id, body.quaternion as any)
    })
  }

  protected added (id :ID, config :EntityConfig) {
    super.added(id, config)
    const bodyConfig :BodyConfig = config.components[this.body.id]
    const body = new UserDataBody({mass: bodyConfig.mass || 0}, id)
    for (const shape of bodyConfig.shapes) {
      body.addShape(createShape(shape))
    }
    this.body.update(id, body)
    this.world.addBody(body)
  }

  protected deleted (id :ID) {
    this.world.remove(this.body.read(id))
    super.deleted(id)
  }
}

function createShape (config :ShapeConfig) {
  switch (config.type) {
    case "sphere":
      return new Sphere(1)
    case "box":
      return new Box(new Vec3(0.5, 0.5, 0.5))
    case "plane":
      return new Plane()
    default:
      throw new Error("Unknown shape type: " + config.type)
  }
}
