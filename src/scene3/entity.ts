import {BufferGeometry, Group, Material, Mesh} from "three"

import {Component, Domain, EntityConfig, ID, Matcher, System} from "../entity/entity"
import {TransformComponent} from "../space/entity"

/** Manages a group of meshes based on [[TransformComponent]] for 3D transform, a
 * geometry component, and an optional material component. Users of this system must call
 * [[MeshSystem.update]] on every frame. */
export class MeshSystem extends System {
  readonly group :Group = new Group()

  private _meshes :Map<ID, Mesh> = new Map()

  constructor (domain :Domain,
               readonly trans :TransformComponent,
               readonly geom :Component<BufferGeometry>,
               readonly mat? :Component<Material>) {
    super(domain, mat ? Matcher.hasAllC(trans.id, geom.id, mat.id) :
      Matcher.hasAllC(trans.id, geom.id))
  }

  update () {
    this.onEntities(id => {
      const mesh = this._requireMesh(id)
      mesh.geometry = this.geom.read(id)
      this.mat && (mesh.material = this.mat.read(id))
      this.trans.readPosition(id, mesh.position)
      this.trans.readQuaternion(id, mesh.quaternion)
      this.trans.readScale(id, mesh.scale)
    })
  }

  protected added (id :ID, config :EntityConfig) {
    super.added(id, config)
    const mesh = new Mesh()
    this._meshes.set(id, mesh)
    this.group.add(mesh)
  }

  protected deleted (id :ID) {
    super.deleted(id)
    this.group.remove(this._requireMesh(id))
    this._meshes.delete(id)
  }

  private _requireMesh (id :ID) {
    const mesh = this._meshes.get(id)
    if (!mesh) {
      throw new Error(`Missing mesh for entity ${id}`)
    }
    return mesh;
  }
}
