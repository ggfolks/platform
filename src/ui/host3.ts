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

  constructor () {
    super()
    this.roots.onChange(ev => {
      if (ev.type === "added") this.rootAdded(ev.elem, ev.index)
    })
  }

  private rootAdded (root :Root, index :number) {
    const texture = new CanvasTexture(root.canvasElem)
    texture.minFilter = LinearFilter
    const mesh = new Mesh(DefaultPlaneBufferGeometry, new MeshBasicMaterial({
      map: texture,
      depthTest: false,
      transparent: true,
    }))
    mesh.frustumCulled = false
    const rendererSize = new Vector2()
    mesh.onBeforeRender = (renderer :WebGLRenderer, scene :Scene, camera :Camera) => {
      if (camera instanceof PerspectiveCamera) {
        const distance = (camera.near + camera.far) / 2
        const height = 2 * distance * Math.tan(ThreeMath.degToRad(camera.fov) / 2)
        const width = camera.aspect * height
        renderer.getSize(rendererSize)
        if (root.width === 0 || root.height === 0) {
          // nothing to see; put it behind the camera
          mesh.matrixWorld.makeScale(1, 1, 1).setPosition(0, 0, 1)
        } else {
          const sx = root.width * width / rendererSize.x
          const sy = root.height * height / rendererSize.y
          mesh.matrixWorld.makeScale(sx, sy, 1).setPosition(
            (root.origin[0] + root.width / 2) * width / rendererSize.x - width / 2,
            height / 2 - (root.origin[1] + root.height / 2) * height / rendererSize.y,
            -distance,
          )
        }
        mesh.matrixWorld.premultiply(camera.matrixWorld)
      }
    }
    this.group.add(mesh)

    const unviz = root.visible.onValue(viz => mesh.visible = viz)
    const unroot = root.events.onEmit(e => {
      if (e === "rendered") {
        const material = mesh.material as MeshBasicMaterial
        (material.map as CanvasTexture).needsUpdate = true
      } else if (e === "removed") {
        this.group.remove(mesh)
        const material = mesh.material as MeshBasicMaterial
        (material.map as CanvasTexture).dispose()
        material.dispose()
        unviz()
        unroot()
      }
    })
  }
}
