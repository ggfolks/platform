import {Body, Shape, World} from "cannon"

import {Clock} from "../core/clock"
import {arrayContentsRefEquals} from "../core/data"
import {Component, Domain, ID, Matcher, System} from "../entity/entity"
import {TransformComponent} from "../space/entity"

/** Manages a group of physical bodies. Users of this system must call [[PhysicsSystem.update]] on
 * every frame. */
export class PhysicsSystem extends System {
  readonly world :World = new World()

  private _bodies :Map<ID, Body> = new Map()

  constructor (domain :Domain,
               readonly trans :TransformComponent,
               readonly shapes :Component<Shape[]>,
               readonly mass :Component<number>) {
    super(domain, Matcher.hasAllC(trans.id, shapes.id, mass.id))
  }

  update (clock :Clock) {
    this.onEntities(id => {
      const shapes = this.shapes.read(id)
      let body = this._bodies.get(id)
      if (!(body && arrayContentsRefEquals(shapes, body.shapes))) {
        body && this.world.remove(body)
        this.world.addBody(body = new Body({mass: 1}))
        this._bodies.set(id, body)
        for (let shape of shapes) {
          body.addShape(shape)
        }
      }
      const mass = this.mass.read(id)
      if (mass !== body.mass) {
        body.mass = mass
        body.updateMassProperties()
      }
      // Cannon vectors/quaternions have same fields as Three.js ones
      this.trans.readPosition(id, body.position as any)
      this.trans.readQuaternion(id, body.quaternion as any)
    })
    this.world.step(clock.dt)
    this.onEntities(id => {
      const body = this._requireBody(id)
      this.trans.updatePosition(id, body.position as any)
      this.trans.updateQuaternion(id, body.quaternion as any)
    })
  }

  protected deleted (id :ID) {
    super.deleted(id)
    const body = this._bodies.get(id)
    if (body) {
      this.world.remove(body)
      this._bodies.delete(id)
    }
  }

  private _requireBody (id :ID) {
    const body = this._bodies.get(id)
    if (!body) {
      throw new Error(`Missing body for entity ${id}`)
    }
    return body;
  }
}
