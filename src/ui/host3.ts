import {vec2} from "gl-matrix"

import {
  Camera,
  CanvasTexture,
  Group,
  LinearFilter,
  Math as ThreeMath,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneBufferGeometry,
  Scene,
  Vector2,
  WebGLRenderer,
} from "three"

import {Host, Root} from "./element"

const DefaultPlaneBufferGeometry = new PlaneBufferGeometry()

export class Host3 extends Host {
  readonly group = new Group()

  private _meshes :Mesh[] = []

  protected rootAdded (root :Root, origin :vec2, index :number) {
    const texture = new CanvasTexture(root.canvasElem)
    texture.minFilter = LinearFilter
    const mesh = this._meshes[index] = new Mesh(DefaultPlaneBufferGeometry, new MeshBasicMaterial({
      map: texture,
      depthTest: false,
      transparent: true,
    }))
    const rendererSize = new Vector2()
    mesh.onBeforeRender = (renderer :WebGLRenderer, scene :Scene, camera :Camera) => {
      if (camera instanceof PerspectiveCamera) {
        const distance = (camera.near + camera.far) / 2
        const height = 2 * distance * Math.tan(ThreeMath.degToRad(camera.fov) / 2)
        const width = camera.aspect * height
        renderer.getSize(rendererSize)
        mesh.matrixWorld
          .makeScale(root.width * width / rendererSize.x, root.height * height / rendererSize.y, 1)
          .setPosition(
            (origin[0] + root.width / 2) * width / rendererSize.x - width / 2,
            height / 2 - (origin[1] + root.height / 2) * height / rendererSize.y,
            -distance,
          )
          .premultiply(camera.matrixWorld)
      }
    }
    this.group.add(mesh)
  }

  protected rootUpdated (root :Root, origin :vec2, index :number) {
    const material = this._meshes[index].material as MeshBasicMaterial
    (material.map as CanvasTexture).needsUpdate = true
  }

  protected rootRemoved (root :Root, origin :vec2, index :number) {
    const mesh = this._meshes[index]
    this._meshes.splice(index, 1)
    this.group.remove(mesh)
    const material = mesh.material as MeshBasicMaterial
    material.dispose();
    (material.map as CanvasTexture).dispose()
  }
}
